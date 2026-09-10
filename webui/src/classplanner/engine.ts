// 职业规划模拟器 —— 规则引擎（纯函数 reducer，复刻内核 ClassPlanner 语义）
// 小字注：所有拦截/点数/上限逻辑与 Model/Framework/ClassPlanner.cs 一一对应。
import { SKILLS, classById, subById, talentById } from './content'
import { allLearnedTalents, candidatesOf, talentRoleOf } from './content'
import { CLASSES, REWARD_TABLE, SKILL_CAP } from './content'
import {
  addAllocation,
  allocationGrowth,
  allocationPoints,
  checkAllocation,
  classPointsForLevel,
  draftOccupied,
  emptyAllocation,
  emptyPlan,
  intersectLimit,
  isUnconfirmed,
  levelFloor,
  RULES,
  settleDebt,
  COMMITTED_NONE,
  type AttributeAllocation,
  type AttributeBudget,
  type AttributeLimit,
  type PlanState,
  type RoleType,
  type SkillType,
  type SubClassDef,
} from './types'

export interface PlanAction {
  ok: boolean
  msg: string
  state: PlanState
}

function okState(state: PlanState, msg: string): PlanAction {
  return { ok: true, msg, state }
}
function fail(state: PlanState, msg: string): PlanAction {
  return { ok: false, msg, state }
}

function roleName(r: RoleType): string {
  return { Core: '核心', Vanguard: '先锋', Guardian: '近卫', Support: '支援', Medic: '治疗', None: '未定' }[r]
}

const clone = (s: PlanState): PlanState => ({
  ...s,
  classes: { ...s.classes },
  subClasses: [...s.subClasses],
  learnedSkillIds: [...s.learnedSkillIds],
  secondaryRoleTypes: [...s.secondaryRoleTypes],
  learnedTalents: Object.fromEntries(Object.entries(s.learnedTalents).map(([role, ids]) => [role, [...(ids ?? [])]])) as PlanState['learnedTalents'],
  defaultClasses: [...s.defaultClasses],
  defaultSubClasses: [...s.defaultSubClasses],
  appliedAttribute: { ...s.appliedAttribute },
  committedLevels: { ...s.committedLevels },
  numericBoostBudget: s.numericBoostBudget ? { ...s.numericBoostBudget } : null,
})

/**
 * 按职业等级累计路线图应发放的配额
 * （对齐内核 DefaultClassRewardSettler.Settle 的发放口径）
 */
export function rewardsFor(classLevel: number): { active: number; passive: number; numeric: number; inherent: number } {
  let active = 0
  let passive = 0
  let numeric = 0
  let inherent = 0
  for (let lv = 1; lv <= classLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (!r) continue
    active += r.activeChoices
    passive += r.passiveChoices
    numeric += r.numericBoost ? Math.max(r.passiveChoices, 1) : 0
    inherent += r.inherentPassive
  }
  return { active, passive, numeric, inherent }
}

/**
 * 汇总 (fromLevel, toLevel] 区间内路线图将要发放 / 回收的配额总数
 * （对齐内核 DefaultClassRewardSettler.SumGrants）
 */
function sumGrants(fromLevel: number, toLevel: number): { active: number; passive: number; numeric: number } {
  let active = 0
  let passive = 0
  let numeric = 0
  for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (!r) continue
    active += r.activeChoices
    passive += r.passiveChoices
    numeric += r.numericBoost ? Math.max(r.passiveChoices, 1) : 0
  }
  return { active, passive, numeric }
}

/**
 * 职业技能选择权总额（对齐内核路线图：2 / 5 / 8 / 10 级各 2 点）
 */
export function activeSkillQuota(): { total: number; tiers: Array<{ level: number; count: number }> } {
  let total = 0
  const tiers: Array<{ level: number; count: number }> = []
  for (const r of REWARD_TABLE) {
    if (r.activeChoices > 0) {
      total += r.activeChoices
      tiers.push({ level: r.level, count: r.activeChoices })
    }
  }
  return { total, tiers }
}

/**
 * 「被动 / 数值提升」共享份额：4 / 9 级档位按 max(PassiveChoices, 1) 发放，二者**互斥（取其一）**
 * <para/>对齐内核：数值提升次数按 max(该档 PassiveChoices, 1) 发放，且领取时会同步抵扣一次被动选择权，
 * 因此同一份额不能既学被动又兑换数值提升
 */
export function passiveOrBoostQuota(): { passive: number; boost: number; tiers: Array<{ level: number; count: number }> } {
  let passive = 0
  let boost = 0
  const tiers: Array<{ level: number; count: number }> = []
  for (const r of REWARD_TABLE) {
    passive += r.passiveChoices
    if (r.numericBoost) {
      const count = Math.max(r.passiveChoices, 1)
      boost += count
      tiers.push({ level: r.level, count })
    }
  }
  return { passive, boost, tiers }
}

/**
 * 数值提升额度覆盖：取「该等级区间内最高一档」的路线图自带额度；null 表示回落 RULES.numericBoostBudget
 * （对齐内核 DefaultClassRewardSettler.ResolveNumericBoostBudget 的单职业口径）
 */
export function numericBoostBudgetForLevel(classLevel: number): AttributeBudget | null {
  let budget: AttributeBudget | null = null
  for (let lv = 1; lv <= classLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (r?.numericBoostBudget) budget = r.numericBoostBudget
  }
  return budget
}

/** 计划整体的数值提升额度覆盖：按最高职业等级取（面板与导出共用） */
export function resolvedNumericBoostBudget(plan: PlanState): AttributeBudget | null {
  const levels = Object.values(plan.classes)
  return levels.length === 0 ? null : numericBoostBudgetForLevel(Math.max(...levels))
}

/**
 * 把某职业的等级「绝对对齐」到 targetLevel（可升可降），并同步账本配额与额度覆盖。
 * 对齐内核 DefaultClassRewardSettler.Reconcile：下调要回收的配额若已被使用则整体失败，不做部分回退
 * @returns 失败原因；null 表示成功
 */
function reconcile(base: PlanState, classId: number, targetLevel: number): string | null {
  const from = base.classes[classId]
  if (from === undefined) return '该职业不在当前计划中。'
  if (from === targetLevel) {
    base.numericBoostBudget = resolvedNumericBoostBudget(base)
    return null
  }
  const sign = targetLevel > from ? 1 : -1
  const delta = sumGrants(Math.min(from, targetLevel), Math.max(from, targetLevel))
  if (sign < 0 && (base.pendingActiveChoices < delta.active
    || base.pendingPassiveChoices < delta.passive
    || base.numericBoosts < delta.numeric)) {
    return `从 ${from} 级下调到 ${targetLevel} 级需回收 职业技能选择权 ×${delta.active} / 被动选择权 ×${delta.passive} / 数值提升 ×${delta.numeric}，`
      + '但其中一部分已被使用（已学技能与已分配属性无法自动追回）。请改用洗点。'
  }
  base.pendingActiveChoices += sign * delta.active
  base.pendingPassiveChoices += sign * delta.passive
  base.numericBoosts += sign * delta.numeric
  base.classes[classId] = targetLevel
  base.numericBoostBudget = resolvedNumericBoostBudget(base)
  return null
}

/**
 * 按路线图推算某技能应达到的等级水位：习得基础 1 级 + (1, classLevel] 的提级累计，魔法额外 +1，末尾按类型上限钳制
 * <para/>对齐内核 DefaultClassRewardSettler.RoadmapSkillLevel —— 作用范围是整个职业池（未习得的同样提升），
 * 职业被动按设定恒为 1 级、不参与提级
 */
export function roadmapSkillLevel(classLevel: number, skillType: SkillType): number {
  if (skillType === 'Passive') return 1
  let level = 1
  for (let lv = 1; lv <= classLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (!r) continue
    level += r.skillLevelUp + (skillType === 'Magic' ? r.magicExtra : 0)
  }
  const cap = SKILL_CAP[skillType as keyof typeof SKILL_CAP]
  return cap ? Math.min(level, cap) : level
}

/** 初始分配的模板限值：已选职业限值的交集（对齐内核 ResolveInitialLimit） */
export function initialLimitOf(state: PlanState): AttributeLimit | null {
  let limit: AttributeLimit | null = null
  for (const id of Object.keys(state.classes).map(Number)) {
    const cls = CLASSES.find(c => c.id === id)
    limit = intersectLimit(limit, cls?.attributeLimit ?? null)
  }
  return limit
}

/** 人类可读的分配描述 */
export function describeAllocation(a: AttributeAllocation): string {
  const parts: string[] = []
  const push = (name: string, v: number) => { if (v !== 0) parts.push(`${name}${v > 0 ? '+' : '-'}${Math.abs(v)}`) }
  push('力量', a.STR)
  push('敏捷', a.AGI)
  push('智力', a.INT)
  push('力量成长', a.STRGrowth)
  push('敏捷成长', a.AGIGrowth)
  push('智力成长', a.INTGrowth)
  return parts.length ? parts.join(' ') : '无属性分配'
}

/** 设置角色等级（模拟升级，点数按等级档重算；仅供演示面板） */
export function changeLevel(state: PlanState, level: number): PlanAction {
  const next = clone(state)
  next.level = level
  next.classPoints = classPointsForLevel(level)
  return okState(next, `角色升至 ${level} 级，职业点数按等级档重算。`)
}

/** 选择职业与流派（新职业条目，含首职业与兼职），消耗 1 点职业点数 */
export function selectClass(state: PlanState, classId: number, subClassId: number): PlanAction {
  const cls = classById(classId)
  const sub = subById(subClassId)
  const base = clone(state)
  if (!cls || !sub) return fail(base, '职业或流派不存在。')
  if (sub.classId !== classId) return fail(base, `流派【${sub.name}】不属于职业【${cls.name}】，请重新选择。`)
  if (base.classes[classId] !== undefined) return fail(base, `已选择职业【${cls.name}】，不允许重复职业（含同职业的其他流派）。`)
  if (base.classPoints < 1) return fail(base, `职业点数不足，选择新职业需消耗 1 点（当前 ${base.classPoints} 点）。`)
  base.classPoints -= 1
  base.classes[classId] = 1 // 职业记录从 1 级起步
  base.committedLevels[classId] = COMMITTED_NONE // 新职业处于草稿态（未确认）
  base.subClasses.push(subClassId)
  // 1 级首职业自动记为默认（洗点恢复用）
  if (base.level <= 1 && base.defaultClasses.length === 0) {
    base.defaultClasses.push(classId)
    base.defaultSubClasses.push(subClassId)
  }
  // 首职业在 1 级发放初始分配权（兼职职业不重复发放，避免属性叠加膨胀）
  if (Object.keys(base.classes).length === 1) {
    base.initialAllocationAvailable = true
  }
  // 新流派带来的候选定位立即可用于次要定位
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  base.phase = '天赋抉择'
  return okState(base, `已选择职业【${cls.name}】流派【${sub.name}】。1 级奖励：获得初始分配权（${RULES.initialBudget.attributePoints} 点属性 + ${RULES.initialBudget.growthPoints} 成长）。`)
}

/**
 * 设定职业等级（可升可降）：**草稿态调整，不结算职业点数**，但会做**即时点数校验** ——
 * 全部职业的「未结算等级占用」不得超过账本余额，因此刷不出超出点数预算的等级组合。
 * <para/>已确认等级（CommittedLevel）是下限：不能降到已确认等级以下（回退只能洗点）
 * <para/>路线图配额按目标等级「绝对对齐」（对齐内核 Reconcile）：下调要回收的配额若已被使用则整体失败
 * <para/>真正的扣点发生在 `commitClass` / `commitAllClasses` / `applyPlan`（提交结算）
 */
export function setClassLevel(state: PlanState, classId: number, level: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const current = base.classes[classId]
  if (!cls || current === undefined) return fail(base, '该职业不在当前计划中。')
  if (level < 1 || level > RULES.maxClassLevel) {
    return fail(base, `职业等级必须在 1–${RULES.maxClassLevel} 之间（当前 ${level}）。`)
  }
  const floor = levelFloor(base, classId)
  if (level < floor) {
    return fail(base, `职业【${cls.name}】已确认到 ${floor} 级，等级不能低于已确认等级；如需回退请使用洗点。`)
  }
  const delta = level - current
  if (delta === 0) return okState(base, `职业【${cls.name}】等级未变化（${level} 级）。`)
  // 即时点数校验：占用 = Σ(当前等级 − 结算基准)，不得超过账本余额
  const occupiedAfter = draftOccupied(base) + delta
  if (occupiedAfter > base.classPoints) {
    const over = occupiedAfter - base.classPoints
    return fail(base, `职业点数不足：该调整需要 ${occupiedAfter} 点未结算占用，超出账本余额 ${base.classPoints} 点（还差 ${over} 点，可用 ${base.classPoints - draftOccupied(base)} 点）。`)
  }
  const error = reconcile(base, classId, level)
  if (error) return fail(base, error)
  // 职业等级变化会影响次要定位的展开顺序
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  const occupied = draftOccupied(base)
  return okState(base, `职业【${cls.name}】${delta > 0 ? `升至 ${level} 级` : `降至 ${level} 级`}`
    + `（草稿态：未结算占用 ${occupied} 点，提交时结算）。`)
}

/** 职业降级（−1）：只改变未结算占用，不能低于已确认等级（下限） */
export function downgradeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const level = base.classes[classId]
  if (!cls || level === undefined) return fail(base, '该职业不在当前计划中。')
  if (level <= 1) return fail(base, `职业【${cls.name}】已是最低 1 级，无法继续降级。`)
  return setClassLevel(base, classId, level - 1)
}

/**
 * 提交 / 确认该职业的当前等级：**此处才真正结算职业点数**
 * （扣掉该职业的未结算占用 = 当前等级 − 结算基准；1 级由「选择职业」的消耗覆盖）
 * <para/>并把当前等级登记为不可下调的下限；对齐内核 ClassPlanner.CommitClassLevel
 */
export function commitClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const level = base.classes[classId]
  if (!cls || level === undefined) return fail(base, '该职业不在当前计划中。')
  const cost = settleDebt(base, classId)
  if (cost > 0 && base.classPoints < cost) {
    return fail(base, `职业点数不足：结算职业【${cls.name}】到 ${level} 级需消耗 ${cost} 点（余额 ${base.classPoints} 点）。`)
  }
  if (cost > 0) base.classPoints -= cost
  base.committedLevels[classId] = level
  return okState(base, `已确认职业【${cls.name}】为 ${level} 级`
    + (cost > 0 ? `（结算职业点数 ${cost} 点）` : '（等级未变化）') + '，此后不可下调。')
}

/**
 * 提交 / 确认全部职业等级：结算全部未结算占用（先整体校验再扣点，避免扣到一半失败）
 * <para/>对齐内核 ClassPlanner.CommitAllClassLevels
 */
export function commitAllClasses(state: PlanState): PlanAction {
  const base = clone(state)
  const total = draftOccupied(base)
  if (total > 0 && base.classPoints < total) {
    return fail(base, `职业点数不足：结算全部职业等级共需 ${total} 点（余额 ${base.classPoints} 点）。`)
  }
  if (total > 0) base.classPoints -= total
  const names: string[] = []
  for (const [id, lv] of Object.entries(base.classes)) {
    base.committedLevels[Number(id)] = lv
    names.push(`${classById(Number(id))?.name} ${lv} 级`)
  }
  return okState(base, names.length === 0
    ? '当前没有职业需要确认。'
    : `已确认职业等级：${names.join('、')}${total > 0 ? `（结算职业点数 ${total} 点）` : ''}，此后不可下调。`)
}

/**
 * 物化到角色：**物化即确认**（对齐内核 ClassPlanner.ApplyToCharacter）
 * <para/>先结算全部职业等级（点数不足则整体失败且不物化），再按计划重挂技能 / 特效 / 天赋
 */
export function applyPlan(state: PlanState): PlanAction {
  const committed = commitAllClasses(state)
  if (!committed.ok) return committed
  return okState(committed.state, `已物化职业计划（职业 ${Object.keys(committed.state.classes).length} 个）。${committed.msg}`)
}

/**
 * 撤销职业（含其流派）：**仅草稿态可用**（已确认的职业请用洗点）
 * <para/>草稿态只退「选择职业」消耗的 1 点（升级点数在草稿态并未扣除），
 * 并收回该职业累计发放且尚未使用的配额；有任何配额已被使用则整体失败
 */
export function removeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const level = base.classes[classId]
  if (!cls || level === undefined) return fail(base, '该职业不在当前计划中。')
  if (!isUnconfirmed(base, classId)) {
    return fail(base, `职业【${cls.name}】已确认过等级，不能撤销；如需重来请使用洗点。`)
  }
  // 预检：该职业累计发放的配额必须仍未被使用，否则不做任何修改
  const granted = rewardsFor(level)
  if (base.pendingActiveChoices < granted.active
    || base.pendingPassiveChoices < granted.passive
    || base.numericBoosts < granted.numeric) {
    return fail(base, `职业【${cls.name}】已发放的选择权 / 数值提升已被使用，无法撤销；请改用洗点。`)
  }
  // 1. 退还「选择职业」已结算的 1 点（未确认职业的升级占用从未结算，无需退还）
  base.classPoints = Math.min(classPointsForLevel(base.level), base.classPoints + 1)
  // 2. 移除职业记录、确认记录与流派
  delete base.classes[classId]
  delete base.committedLevels[classId]
  base.subClasses = base.subClasses.filter(sid => subById(sid)?.classId !== classId)
  // 3. 清理该职业已学技能，并收回该职业累计发放的配额
  base.learnedSkillIds = base.learnedSkillIds.filter(sid => {
    const s = SKILLS.find(x => x.id === sid)
    return !s || s.classId !== classId
  })
  base.pendingActiveChoices -= granted.active
  base.pendingPassiveChoices -= granted.passive
  base.numericBoosts -= granted.numeric
  base.numericBoostBudget = resolvedNumericBoostBudget(base)
  // 4. 天赋：清掉已撤销职业的天赋以及不再被流派候选覆盖的定位；随后重推主要 / 次要定位
  const remaining = candidatesOf(base)
  for (const role of Object.keys(base.learnedTalents) as RoleType[]) {
    const kept = (base.learnedTalents[role] ?? []).filter(id => remaining.includes(role) && talentById(id)?.classId !== classId)
    if (kept.length > 0) base.learnedTalents[role] = kept
    else delete base.learnedTalents[role]
  }
  if (base.activeTalentId !== null && !allLearnedTalents(base).includes(base.activeTalentId)) {
    base.activeTalentId = null
    base.activeTalentRole = null
  }
  base.primaryRoleType = base.activeTalentRole ?? 'None'
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  base.phase = Object.keys(base.classes).length ? '天赋抉择' : '誓约之始'
  return okState(base, `已撤销职业【${cls.name}】与流派，退回 1 点职业点并收回该职业未使用的配额。`)
}

/**
 * 次要定位推导（对齐内核 ClassPlanRoleResolver）：
 * 流派按「所属职业等级降序、同级按选择顺序」展开候选，去重并跳过主要定位，至多 maxSecondaryRoles 个
 */
export function resolveSecondaryRoles(state: PlanState): RoleType[] {
  const ordered = [...state.subClasses]
    .map((id): [number, SubClassDef | undefined] => [id, subById(id)])
    .filter((entry): entry is [number, SubClassDef] => !!entry[1])
    .sort((a, b) => {
      const lvA = state.classes[a[1].classId] ?? 0
      const lvB = state.classes[b[1].classId] ?? 0
      if (lvA !== lvB) return lvB - lvA
      return state.subClasses.indexOf(a[0]) - state.subClasses.indexOf(b[0])
    })
  const result: RoleType[] = []
  for (const [, sub] of ordered) {
    for (const role of sub.roleTypes) {
      if (role === 'None' || role === state.primaryRoleType || result.includes(role)) continue
      result.push(role)
      if (result.length >= RULES.maxSecondaryRoles) return result
    }
  }
  return result
}

/** 重新推导角色定位：主要 = 当前生效战斗天赋的定位（未激活则无）；次要 = 流派展开 */
export function refreshRoleTypes(state: PlanState): PlanAction {
  const base = clone(state)
  const primary: RoleType = base.activeTalentRole && base.learnedTalents[base.activeTalentRole] !== undefined
    ? base.activeTalentRole
    : 'None'
  base.primaryRoleType = primary
  base.secondaryRoleTypes = resolveSecondaryRoles({ ...base, primaryRoleType: primary })
  const secondaryText = base.secondaryRoleTypes.length ? base.secondaryRoleTypes.map(roleName).join(' / ') : '无'
  return okState(base, `已刷新定位：主要 ${roleName(primary)}；次要 ${secondaryText}。`)
}

/** 学习/替换战斗天赋：数量 = 已选定位数；天赋须属对应定位在已选职业中的池 */
export function learnTalent(state: PlanState, roleType: RoleType, talentId: number): PlanAction {
  const base = clone(state)
  const talent = talentById(talentId)
  if (!talent) return fail(base, '天赋不存在。')
  if (talent.roleType !== roleType) return fail(base, '天赋定位不匹配。')
  const candidates = candidatesOf(base)
  if (candidates.length === 0) return fail(base, '尚未选择任何流派，定位候选为空。请先选择职业与流派。')
  if (!candidates.includes(roleType)) return fail(base, `定位（${roleName(roleType)}）不在已选流派提供的候选定位中。`)
  if (base.classes[talent.classId] === undefined) return fail(base, '天赋所属职业尚未选择。')
  if (allLearnedTalents(base).includes(talentId)) return fail(base, `天赋【${talent.name}】已学习，无需重复学习。`)
  if (allLearnedTalents(base).length >= RULES.maxRoleTypes) {
    return fail(base, `已学天赋数量已达上限 ${RULES.maxRoleTypes} 个，无法继续学习。`)
  }
  // 追加进该定位的天赋列表（同一定位可掌握多个；学习不挂载，激活才生效）
  base.learnedTalents[roleType] = [...(base.learnedTalents[roleType] ?? []), talentId]
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  base.phase = '天赋抉择'
  const count = allLearnedTalents(base).length
  return okState(base, `已学习 ${roleName(roleType)} 天赋【${talent.name}】（已学 ${count} / ${RULES.maxRoleTypes}，${base.activeTalentId === null ? '尚未激活任何天赋' : '当前生效中'}）。`)
}

/** 激活/转换战斗天赋：始终至多 1 个生效 */
export function activateTalent(state: PlanState, roleType: RoleType, talentId?: number): PlanAction {
  const base = clone(state)
  const list = base.learnedTalents[roleType] ?? []
  if (list.length === 0) return fail(base, `${roleName(roleType)}天赋尚未学习。`)
  // 未指定天赋时优先切到该定位下尚未激活的那个（同定位多天赋实现循环）
  const targetId = talentId ?? list.find(id => id !== base.activeTalentId) ?? list[0]
  const talent = talentById(targetId)
  if (!talent) return fail(base, '天赋不存在。')
  if (base.activeTalentId === targetId) return okState(base, `${roleName(roleType)}天赋【${talent.name}】已处于激活状态。`)
  base.activeTalentId = targetId
  base.activeTalentRole = roleType
  // 主要定位跟随生效天赋：转换天赋后 MOV 等按定位取值的属性随之变化（同定位转换时不变）
  base.primaryRoleType = roleType
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  base.phase = '誓约达成'
  return okState(base, `已激活 ${roleName(roleType)} 天赋【${talent.name}】${talent.isCoreBuff ? '，自身与职业技能等级 +1 生效' : ''}；主要定位 → ${roleName(roleType)}。`)
}

/**
 * 遗忘已学战斗天赋：释放名额，可再学新天赋完成替换（对齐内核 ForgetCombatTalent）
 * <para/>遗忘不消耗也不退还资源，且不退款；遗忘的是当前生效天赋时自动接续到剩余已学天赋的第一个
 * <para/>已学不足 2 个时【转换战斗天赋】战技自动收回（前端由「已学 ≥ 2」推导，无需额外处理）
 */
export function forgetTalent(state: PlanState, roleType: RoleType, talentId: number): PlanAction {
  const base = clone(state)
  const talent = talentById(talentId)
  if (!talent) return fail(base, '天赋不存在。')
  const list = base.learnedTalents[roleType] ?? []
  if (!list.includes(talentId)) return fail(base, `天赋【${talent.name}】尚未学习，无法遗忘。`)
  const wasActive = base.activeTalentId === talentId
  const kept = list.filter(id => id !== talentId)
  if (kept.length > 0) {
    base.learnedTalents[roleType] = kept
  } else {
    delete base.learnedTalents[roleType]
  }
  if (wasActive) {
    // 遗忘的正是生效天赋：自动接续到剩余已学天赋的第一个，避免「有已学却无生效」的空档
    base.activeTalentId = null
    base.activeTalentRole = null
    const next = talentById(allLearnedTalents(base)[0])
    if (next) {
      base.activeTalentId = next.id
      base.activeTalentRole = next.roleType
    }
  }
  // 主要定位跟随生效天赋，次要定位由流派重新展开
  base.primaryRoleType = base.activeTalentRole ?? 'None'
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  base.phase = '天赋抉择'
  const active = base.activeTalentId === null ? '当前未激活任何天赋' : '已自动接续其余已学天赋'
  return okState(base, `已遗忘天赋【${talent.name}】（已学 ${allLearnedTalents(base).length} / ${RULES.maxRoleTypes}，${active}）。`)
}

/** 学习职业技能 / 被动：按路线图「选择权」配额校验（对齐内核 SpendSkillChoice） */
export function learnSkill(state: PlanState, classId: number, skillId: number): PlanAction {
  const base = clone(state)
  const skill = SKILLS.find(s => s.id === skillId)
  if (!skill) return fail(base, '技能不存在。')
  if (base.classes[classId] === undefined) return fail(base, '请先选择该职业技能所属的职业。')
  if (skill.classId !== classId) return fail(base, `技能【${skill.name}】不属于职业【${classById(classId)?.name ?? classId}】。`)
  if (base.learnedSkillIds.includes(skillId)) return fail(base, `技能【${skill.name}】已习得。`)
  const isPassive = skill.skillType === 'Passive'
  if (isPassive ? base.pendingPassiveChoices < 1 : base.pendingActiveChoices < 1) {
    return fail(base, `剩余${isPassive ? '被动' : '职业技能'}选择权不足（2 级起按路线图发放，当前剩余 主动 ${base.pendingActiveChoices} / 被动 ${base.pendingPassiveChoices}）。`)
  }
  if (isPassive) base.pendingPassiveChoices -= 1
  else base.pendingActiveChoices -= 1
  base.learnedSkillIds.push(skillId)
  return okState(base, `已消耗选择权习得${isPassive ? '被动' : '职业技能'}【${skill.name}】（剩余 主动 ${base.pendingActiveChoices} / 被动 ${base.pendingPassiveChoices}）。`)
}

export function unlearnSkill(state: PlanState, skillId: number): PlanAction {
  const base = clone(state)
  const skill = SKILLS.find(s => s.id === skillId)
  if (!skill) return fail(base, '技能不存在。')
  if (!base.learnedSkillIds.includes(skillId)) return fail(base, `技能【${skill.name}】尚未习得。`)
  // 规则：职业技能 / 被动**提交（确认等级）后便不可遗忘**，回退只能洗点；草稿态仍可自由调整
  if (!isUnconfirmed(base, skill.classId)) {
    return fail(base, `职业【${classById(skill.classId)?.name ?? ''}】已提交确认，已习得的技能不能遗忘；如需重来请使用洗点。`)
  }
  base.learnedSkillIds = base.learnedSkillIds.filter(id => id !== skillId)
  // 遗忘即退回 1 点对应选择权
  if (skill.skillType === 'Passive') base.pendingPassiveChoices += 1
  else base.pendingActiveChoices += 1
  return okState(base, `已遗忘【${skill.name}】并退回 1 点选择权。`)
}

/** 领取 1 级初始分配权：30 点属性 + 3.0 成长，受职业模板上下限约束（对齐内核 SpendInitialAllocation） */
export function allocateInitial(state: PlanState, allocation: AttributeAllocation): PlanAction {
  const base = clone(state)
  if (!base.initialAllocationAvailable) {
    return fail(base, '当前没有可用的 1 级初始分配权（每个职业仅在 1 级发放一次）。')
  }
  const limit = initialLimitOf(base)
  const check = checkAllocation(allocation, RULES.initialBudget, limit)
  if (!check.ok) return fail(base, check.error ?? '初始分配不合法。')
  if (allocationPoints(allocation) <= 0 && allocationGrowth(allocation) <= 0) {
    return fail(base, '请至少分配 1 点属性或成长。')
  }
  base.initialAllocationAvailable = false
  base.appliedAttribute = addAllocation(base.appliedAttribute, allocation)
  return okState(base, `已完成初始分配：${describeAllocation(allocation)}（累计 ${describeAllocation(base.appliedAttribute)}）。`)
}

/**
 * 兑换一次数值提升：额度取账本覆盖（随等级重算），缺省用 RULES.numericBoostBudget；不受模板限值
 * <para/>**与被动严格互斥**：4 / 9 级发放的是同一份「被动或数值提升」份额，
 * 因此要求「数值提升次数 ≥ 1 **且** 被动选择权 ≥ 1」，并同时各扣 1 —— 同一份额不能被取两次
 * （对齐内核 SpendNumericBoost 的口径，但把「同步抵扣被动」收紧为必要条件）
 */
export function takeNumericBoost(state: PlanState, allocation: AttributeAllocation): PlanAction {
  const base = clone(state)
  if (base.numericBoosts < 1) {
    return fail(base, '无可用数值提升份额（仅 4 / 9 级档位按 max(该档被动选择权, 1) 发放）。')
  }
  if (base.pendingPassiveChoices < 1) {
    return fail(base, '被动选择权已用尽：数值提升与被动共用 4 / 9 级同一份份额，二者互斥（取其一），没有份额就不能再兑换数值提升。')
  }
  const budget = base.numericBoostBudget ?? RULES.numericBoostBudget
  const check = checkAllocation(allocation, budget, null)
  if (!check.ok) return fail(base, check.error ?? '数值提升分配不合法。')
  if (allocationPoints(allocation) <= 0 && allocationGrowth(allocation) <= 0) {
    return fail(base, '请至少分配 1 点属性或成长。')
  }
  base.numericBoosts -= 1
  // 与被动严格互斥：同一份额只能取其一
  base.pendingPassiveChoices -= 1
  base.appliedAttribute = addAllocation(base.appliedAttribute, allocation)
  return okState(base, `已获得数值提升：${describeAllocation(allocation)}（额度 ${budget.attributePoints} 点 + ${budget.growthPoints} 成长，剩余份额 ${base.pendingPassiveChoices}）。`)
}

/** 洗点：<20 级只恢复到 1 级默认职业流派并重算点数；≥20 级清空 */
export function resetPlan(state: PlanState): PlanAction {
  const base = clone(state)
  base.classes = {}
  base.subClasses = []
  base.learnedSkillIds = []
  base.primaryRoleType = 'None'
  base.secondaryRoleTypes = []
  base.learnedTalents = {}
  base.activeTalentId = null
  base.activeTalentRole = null
  base.classPoints = classPointsForLevel(base.level)
  base.phase = '誓约之始'
  // 撤销全部属性分配与路线图配额（对齐内核 Revoke + 账本清空）
  base.pendingActiveChoices = 0
  base.pendingPassiveChoices = 0
  base.numericBoosts = 0
  base.initialAllocationAvailable = false
  base.appliedAttribute = emptyAllocation()
  base.committedLevels = {}
  base.numericBoostBudget = null
  if (base.level < RULES.minLevelCanModifyDefault) {
    if (base.defaultClasses.length === 0) return fail(base, '无默认职业可恢复（洗点前请先完成 1 级职业选择）。')
    base.defaultClasses.forEach(id => { base.classes[id] = 1 })
    base.subClasses.push(...base.defaultSubClasses)
    // 恢复的 1 级默认职业同样获得初始分配权
    base.initialAllocationAvailable = true
    return okState(base, `已恢复 1 级默认职业并撤销全部属性分配（角色未满 ${RULES.minLevelCanModifyDefault} 级，点数已重算）。`)
  }
  return okState(base, `已清空职业规划并撤销全部属性分配（角色已满 ${RULES.minLevelCanModifyDefault} 级，可重新选择）。`)
}

/** 一致性校验（对齐 ValidateState） */
export function validate(state: PlanState): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const classIds = Object.keys(state.classes).map(Number)
  if (new Set(classIds).size !== classIds.length) errors.push('计划中存在重复职业。')
  if (classIds.some(id => (state.classes[id] ?? 0) > RULES.maxClassLevel)) errors.push('职业等级超过上限。')
  // 职业等级只升不降：已确认等级不得高于当前等级（对齐 ValidateState / SyncRewards 的一致性检查）
  for (const [id, level] of Object.entries(state.classes)) {
    const committed = state.committedLevels[Number(id)]
    if (committed !== undefined && committed >= 0 && level < committed) {
      errors.push(`职业【${classById(Number(id))?.name ?? id}】已确认到 ${committed} 级，但当前只有 ${level} 级（等级只升不降）。`)
    }
  }
  if (state.pendingActiveChoices < 0 || state.pendingPassiveChoices < 0 || state.numericBoosts < 0) {
    errors.push('待选配额为负（账本与职业等级不一致）。')
  }
  for (const sid of state.subClasses) {
    const sub = subById(sid)
    if (sub && state.classes[sub.classId] === undefined) errors.push(`流派【${sub.name}】未绑定到计划中的职业。`)
  }
  const learnedIds = allLearnedTalents(state)
  const candidates = candidatesOf(state)
  for (const [role, ids] of Object.entries(state.learnedTalents)) {
    if (!candidates.includes(role as RoleType)) errors.push(`${roleName(role as RoleType)}天赋的定位不在流派候选中。`)
    for (const id of ids ?? []) {
      if (!talentById(id)) errors.push(`已学天赋不存在：${id}。`)
    }
  }
  if (learnedIds.length > RULES.maxRoleTypes) errors.push('已学天赋数量超过上限。')
  if (state.activeTalentId !== null) {
    if (!learnedIds.includes(state.activeTalentId)) errors.push('激活的天赋不在已学列表中。')
    else if (state.activeTalentRole !== talentRoleOf(state, state.activeTalentId)) errors.push('生效天赋与主要定位不一致。')
  }
  if (state.primaryRoleType !== 'None' && state.primaryRoleType !== state.activeTalentRole) errors.push('主要定位与生效天赋不一致。')
  if (state.primaryRoleType !== 'None' && !candidates.includes(state.primaryRoleType)) errors.push('主要定位不在流派候选中。')
  return { ok: errors.length === 0, errors }
}

export { emptyPlan }
