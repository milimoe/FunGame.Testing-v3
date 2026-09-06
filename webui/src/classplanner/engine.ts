// 职业规划模拟器 —— 规则引擎（纯函数 reducer，复刻内核 ClassPlanner 语义）
// 小字注：所有拦截/点数/上限逻辑与 Model/Framework/ClassPlanner.cs 一一对应。
import { SKILLS, classById, subById, talentById } from './content'
import { candidatesOf, roleTypesOfPlan } from './content'
import {
  classPointsForLevel,
  emptyPlan,
  RULES,
  type PlanState,
  type RoleType,
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
  learnedTalents: { ...s.learnedTalents },
  defaultClasses: [...s.defaultClasses],
  defaultSubClasses: [...s.defaultSubClasses],
})

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
  base.phase = sub.roleTypes.length >= 2 ? '定位抉择' : '誓约之始'
  return okState(base, `已选择职业【${cls.name}】流派【${sub.name}】。`)
}

/** 职业升级（+1，不超过 10），消耗 1 点 */
export function upgradeClass(state: PlanState, classId: number): PlanAction {
  const base = clone(state)
  const cls = classById(classId)
  if (!cls || base.classes[classId] === undefined) return fail(base, '该职业不在当前计划中。')
  if ((base.classes[classId] ?? 0) >= RULES.maxClassLevel) return fail(base, `职业【${cls.name}】已达等级上限 ${RULES.maxClassLevel} 级。`)
  if (base.classPoints < 1) return fail(base, `职业点数不足，职业升级需消耗 1 点（当前 ${base.classPoints} 点）。`)
  base.classPoints -= 1
  base.classes[classId] = (base.classes[classId] ?? 0) + 1
  return okState(base, `职业【${cls.name}】升至 ${base.classes[classId]} 级。`)
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
  return okState(base, `职业【${cls.name}】降至 ${base.classes[classId]} 级，退回 1 点职业点。`)
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
  // 3. 清理该职业已学技能
  base.learnedSkillIds = base.learnedSkillIds.filter(sid => {
    const s = SKILLS.find(x => x.id === sid)
    return !s || s.classId !== classId
  })
  // 4. 定位与天赋：仅保留仍被剩余流派候选覆盖的定位；其余清除
  const remaining = candidatesOf(base)
  const keep = [base.firstRoleType, base.secondRoleType, base.thirdRoleType].filter(r => r !== 'None' && remaining.includes(r))
  base.firstRoleType = keep[0] ?? 'None'
  base.secondRoleType = keep[1] ?? 'None'
  base.thirdRoleType = keep[2] ?? 'None'
  for (const role of Object.keys(base.learnedTalents)) {
    if (!keep.includes(role as RoleType)) delete base.learnedTalents[role as RoleType]
  }
  if (base.activeTalentRole && !base.learnedTalents[base.activeTalentRole]) base.activeTalentRole = null
  base.phase = Object.keys(base.classes).length ? '定位抉择' : '誓约之始'
  return okState(base, `已撤销职业【${cls.name}】与流派，退回 ${level} 点职业点。`)
}

/** 选择角色定位（≤3 且必须来自已选流派候选并集）；定位变动清空旧天赋 */
export function selectRoleTypes(state: PlanState, roles: RoleType[]): PlanAction {
  const base = clone(state)
  const selected = [...new Set(roles.filter(r => r !== 'None'))]
  if (selected.length === 0) return fail(base, '请至少选择一个定位。')
  if (selected.length > RULES.maxRoleTypes) return fail(base, `角色至多拥有 ${RULES.maxRoleTypes} 个定位。`)
  const candidates = candidatesOf(base)
  if (candidates.length === 0) return fail(base, '尚未选择任何流派，定位候选为空。请先选择职业与流派。')
  if (selected.some(r => !candidates.includes(r))) return fail(base, '所选定位必须来自已选流派提供的候选定位。')
  // 清空天赋（与定位绑定）
  base.learnedTalents = {}
  base.activeTalentRole = null
  base.firstRoleType = selected[0] ?? 'None'
  base.secondRoleType = selected[1] ?? 'None'
  base.thirdRoleType = selected[2] ?? 'None'
  base.phase = '天赋抉择'
  return okState(base, `已选择定位：${selected.map(roleName).join(' / ')}。`)
}

/** 撤销已确认的定位选择：清空三定位与天赋，回到可重选状态 */
export function clearRoleTypes(state: PlanState): PlanAction {
  const base = clone(state)
  if (roleTypesOfPlan(base).length === 0) return fail(base, '尚未选择定位。')
  base.firstRoleType = 'None'
  base.secondRoleType = 'None'
  base.thirdRoleType = 'None'
  base.learnedTalents = {}
  base.activeTalentRole = null
  base.phase = '定位抉择'
  return okState(base, '已撤销定位选择，可重新排列。')
}

/** 学习/替换战斗天赋：数量 = 已选定位数；天赋须属对应定位在已选职业中的池 */
export function learnTalent(state: PlanState, roleType: RoleType, talentId: number): PlanAction {
  const base = clone(state)
  const talent = talentById(talentId)
  if (!talent) return fail(base, '天赋不存在。')
  if (talent.roleType !== roleType) return fail(base, '天赋定位不匹配。')
  if (!roleTypesOfPlan(base).includes(roleType)) return fail(base, `天赋对应的定位（${roleName(roleType)}）不在角色已选定位中。`)
  if (base.classes[talent.classId] === undefined) return fail(base, '天赋所属职业尚未选择。')
  const roleCount = roleTypesOfPlan(base).length
  if (base.learnedTalents[roleType] === undefined && Object.keys(base.learnedTalents).length >= roleCount) {
    return fail(base, '已学天赋数量与定位数量一致，无法继续学习（先修改定位或替换同定位天赋）。')
  }
  base.learnedTalents[roleType] = talentId
  base.phase = '天赋抉择'
  return okState(base, `已学习 ${roleName(roleType)} 天赋【${talent.name}】。`)
}

/** 激活/转换战斗天赋：始终至多 1 个生效 */
export function activateTalent(state: PlanState, roleType: RoleType): PlanAction {
  const base = clone(state)
  const talentId = base.learnedTalents[roleType]
  const talent = talentById(talentId)
  if (!talent) return fail(base, `${roleName(roleType)}天赋尚未学习。`)
  if (base.activeTalentRole === roleType) return okState(base, `${roleName(roleType)}天赋已处于激活状态。`)
  base.activeTalentRole = roleType
  base.phase = '誓约达成'
  return okState(base, `已激活 ${roleName(roleType)} 天赋【${talent.name}】${talent.isCoreBuff ? '，自身与职业技能等级 +1 生效' : ''}。`)
}

/** 学习职业技能（原型注：真实流程按路线图「选择权」配额校验，此处演示简化） */
export function learnSkill(state: PlanState, classId: number, skillId: number): PlanAction {
  const base = clone(state)
  if (base.classes[classId] === undefined) return fail(base, '请先选择该职业技能所属的职业。')
  if (!base.learnedSkillIds.includes(skillId)) base.learnedSkillIds.push(skillId)
  return okState(base, '已习得职业技能。')
}

export function unlearnSkill(state: PlanState, skillId: number): PlanAction {
  const base = clone(state)
  base.learnedSkillIds = base.learnedSkillIds.filter(id => id !== skillId)
  return okState(base, '已遗忘该技能。')
}

/** 洗点：<20 级只恢复到 1 级默认职业流派并重算点数；≥20 级清空 */
export function resetPlan(state: PlanState): PlanAction {
  const base = clone(state)
  base.classes = {}
  base.subClasses = []
  base.learnedSkillIds = []
  base.firstRoleType = 'None'
  base.secondRoleType = 'None'
  base.thirdRoleType = 'None'
  base.learnedTalents = {}
  base.activeTalentRole = null
  base.classPoints = classPointsForLevel(base.level)
  base.phase = '誓约之始'
  if (base.level < RULES.minLevelCanModifyDefault) {
    if (base.defaultClasses.length === 0) return fail(base, '无默认职业可恢复（洗点前请先完成 1 级职业选择）。')
    base.defaultClasses.forEach(id => { base.classes[id] = 1 })
    base.subClasses.push(...base.defaultSubClasses)
    return okState(base, `已恢复 1 级默认职业（角色未满 ${RULES.minLevelCanModifyDefault} 级，点数已重算）。`)
  }
  return okState(base, `已清空职业规划（角色已满 ${RULES.minLevelCanModifyDefault} 级，可重新选择）。`)
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
  const learned = Object.entries(state.learnedTalents)
  const actives = roleTypesOfPlan(state)
  for (const [role] of learned) {
    if (!actives.includes(role as RoleType)) errors.push(`${roleName(role as RoleType)}天赋不在已选定位中。`)
  }
  if (learned.length > actives.length) errors.push('已学天赋数量超过定位数量。')
  if (state.activeTalentRole && state.learnedTalents[state.activeTalentRole] === undefined) errors.push('激活的天赋不在已学列表中。')
  return { ok: errors.length === 0, errors }
}

export { emptyPlan }
