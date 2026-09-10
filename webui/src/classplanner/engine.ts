// 职业规划模拟器 —— 规则引擎（纯函数 reducer，复刻内核 ClassPlanner 语义）
// 小字注：所有拦截/点数/上限逻辑与 Model/Framework/ClassPlanner.cs 一一对应。
import { SKILLS, classById, subById, talentById } from './content'
import { allLearnedTalents, candidatesOf, talentRoleOf } from './content'
import { CLASSES, REWARD_TABLE } from './content'
import {
  addAllocation,
  allocationGrowth,
  allocationPoints,
  checkAllocation,
  classPointsForLevel,
  emptyAllocation,
  emptyPlan,
  intersectLimit,
  RULES,
  type AttributeAllocation,
  type AttributeLimit,
  type PlanState,
  type RoleType,
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
})

/**
 * 按职业等级重放路线图，得到该等级累计应发放的配额
 * （对齐内核 DefaultClassRewardSettler.Settle 的 selection / numericBoost 发放口径）
 */
function rewardsFor(classLevel: number): { active: number; passive: number; numeric: number } {
  let active = 0
  let passive = 0
  let numeric = 0
  for (let lv = 1; lv <= classLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (!r) continue
    active += r.activeChoices
    passive += r.passiveChoices
    if (r.numericBoost) numeric += Math.max(r.passiveChoices, 1)
  }
  return { active, passive, numeric }
}

/** 差额发放 / 扣回配额（升级为发放，降级与撤销为扣回），并清理超过配额的已学技能 */
function applyChoiceDelta(base: PlanState, classId: number, fromLevel: number, toLevel: number): void {
  const before = rewardsFor(Math.max(0, fromLevel))
  const after = rewardsFor(Math.max(0, toLevel))
  base.pendingActiveChoices += after.active - before.active
  base.pendingPassiveChoices += after.passive - before.passive
  base.numericBoosts = Math.max(0, base.numericBoosts + (after.numeric - before.numeric))
  // 负份额说明已学技能超出新配额：先遗忘技能，再把份额收敛回 0
  trimOverflow(base, classId)
  base.pendingActiveChoices = Math.max(0, base.pendingActiveChoices)
  base.pendingPassiveChoices = Math.max(0, base.pendingPassiveChoices)
}

/** 若该职业的已学技能数超过剩余配额，从后往前遗忘（等级回退时的必然结果） */
function trimOverflow(base: PlanState, classId: number): void {
  const owned = base.learnedSkillIds
    .map(id => SKILLS.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.classId === classId)
  const actives = owned.filter(s => s.skillType !== 'Passive')
  const passives = owned.filter(s => s.skillType === 'Passive')
  while (actives.length > 0 && base.pendingActiveChoices < 0) {
    base.pendingActiveChoices++
    base.learnedSkillIds = base.learnedSkillIds.filter(id => id !== actives.pop()!.id)
  }
  while (passives.length > 0 && base.pendingPassiveChoices < 0) {
    base.pendingPassiveChoices++
    base.learnedSkillIds = base.learnedSkillIds.filter(id => id !== passives.pop()!.id)
  }
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

/** 职业升级（+1，不超过 10），消耗 1 点 */
export function upgradeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  if (!cls || base.classes[classId] === undefined) return fail(base, '该职业不在当前计划中。')
  if ((base.classes[classId] ?? 0) >= RULES.maxClassLevel) return fail(base, `职业【${cls.name}】已达等级上限 ${RULES.maxClassLevel} 级。`)
  if (base.classPoints < 1) return fail(base, `职业点数不足，职业升级需消耗 1 点（当前 ${base.classPoints} 点）。`)
  base.classPoints -= 1
  const fromLevel = base.classes[classId] ?? 1
  base.classes[classId] = fromLevel + 1
  // 结算该档路线图奖励：选择权 / 数值提升（技能等级提升在卷宗里按等级推演）
  applyChoiceDelta(base, classId, fromLevel, fromLevel + 1)
  const r = REWARD_TABLE.find(x => x.level === fromLevel + 1)
  // 职业等级变化会影响次要定位的展开顺序
  base.secondaryRoleTypes = resolveSecondaryRoles(base)
  const gained: string[] = []
  if (r?.activeChoices) gained.push(`职业技能选择权 +${r.activeChoices}`)
  if (r?.passiveChoices) gained.push(`被动选择权 +${r.passiveChoices}`)
  if (r?.numericBoost) gained.push(`可用数值提升 ×${Math.max(r.passiveChoices, 1)}`)
  if (r?.inherentPassive) gained.push(`流派固有被动 ×${r.inherentPassive}`)
  return okState(base, `职业【${cls.name}】升至 ${base.classes[classId]} 级。${gained.length ? `奖励：${gained.join('；')}。` : ''}`)
}

/** 职业降级（−1，最低回到 1 级），退回 1 点 */
export function downgradeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const level = base.classes[classId]
  if (!cls || level === undefined) return fail(base, '该职业不在当前计划中。')
  if (level <= 1) return fail(base, `职业【${cls.name}】已是最低 1 级，无法继续降级。`)
  base.classes[classId] = level - 1
  base.classPoints = Math.min(classPointsForLevel(base.level), base.classPoints + 1)
  // 收回该档路线图配额；若已学技能超出新配额则一并遗忘
  applyChoiceDelta(base, classId, level, level - 1)
  return okState(base, `职业【${cls.name}】降至 ${base.classes[classId]} 级，退回 1 点职业点并收回对应档位奖励。`)
}

/** 撤销职业（含其流派）：退回该职业的全部投入（选择 + 升级 = 等级数），并清理相关技能与失效定位/天赋 */
export function removeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  const level = base.classes[classId]
  if (!cls || level === undefined) return fail(base, '该职业不在当前计划中。')
  // 1. 退还点数（1 次选择 + 每级 1 次升级 = 等级数），不超过该角色等级可获总额
  base.classPoints = Math.min(classPointsForLevel(base.level), base.classPoints + level)
  // 2. 移除职业记录与流派
  delete base.classes[classId]
  base.subClasses = base.subClasses.filter(sid => subById(sid)?.classId !== classId)
  // 3. 清理该职业已学技能，并收回该职业累计发放的配额
  base.learnedSkillIds = base.learnedSkillIds.filter(sid => {
    const s = SKILLS.find(x => x.id === sid)
    return !s || s.classId !== classId
  })
  applyChoiceDelta(base, classId, level, 0)
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
  return okState(base, `已撤销职业【${cls.name}】与流派，退回 ${level} 点职业点。`)
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

/** 兑换一次数值提升：9 点属性 + 0.9 成长，可任意分配、不受模板限值（对齐内核 SpendNumericBoost） */
export function takeNumericBoost(state: PlanState, allocation: AttributeAllocation): PlanAction {
  const base = clone(state)
  if (base.numericBoosts < 1) {
    return fail(base, '无可用数值提升（仅 4 / 9 级档位提供，且可被被动选择替代）。')
  }
  const check = checkAllocation(allocation, RULES.numericBoostBudget, null)
  if (!check.ok) return fail(base, check.error ?? '数值提升分配不合法。')
  if (allocationPoints(allocation) <= 0 && allocationGrowth(allocation) <= 0) {
    return fail(base, '请至少分配 1 点属性或成长。')
  }
  base.numericBoosts -= 1
  // 数值提升替代被动选择：同步抵扣一次被动选择权（若还有）
  if (base.pendingPassiveChoices > 0) base.pendingPassiveChoices -= 1
  base.appliedAttribute = addAllocation(base.appliedAttribute, allocation)
  return okState(base, `已获得数值提升：${describeAllocation(allocation)}（剩余次数 ${base.numericBoosts}）。`)
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
