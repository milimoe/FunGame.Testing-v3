// 职业规划导出：把前端 PlanState 映射为内核 ClassPlanSnapshot 的形状
// 小字注：形状严格对齐 FunGame.Core/Model/Framework/ClassPlanSnapshot.cs 及其嵌套类型，
// 序列化选项为 JsonService.GeneralOptions（JsonTool.JsonSerializerOptions）——
// 因此导出的 JSON 可直接被 JsonSerializer.Deserialize<ClassPlanSnapshot>(json, JsonTool.JsonSerializerOptions) 解析，
// 再交由 ClassPlanSnapshot.ApplyTo(plan, character) 经 ClassDefinitionRegistry 重建。
import { SKILLS, classById, subById, talentById } from './content'
import { numericBoostBudgetForLevel, rewardsFor, roadmapSkillLevel } from './engine'
import type { AttributeAllocation, AttributeBudget, PlanState, RoleType } from './types'

/** IdName（"7101.导械师"）→ 数字 id；解析失败返回 null */
const idFrom = (idName: string | null | undefined): number | null => {
  if (!idName) return null
  const n = Number(idName.split('.')[0])
  return Number.isFinite(n) ? n : null
}

/** IdName 约定：与内核 BaseEntity.GetIdName() 一致（Id + "." + Name） */
export const idNameOf = (id: number, name: string): string => `${id}.${name}`

/** 对齐内核 ClassAttributeAllocation */
export interface SnapshotAllocation {
  STR: number
  AGI: number
  INT: number
  STRGrowth: number
  AGIGrowth: number
  INTGrowth: number
}

/** 对齐内核 ClassAttributeBudget */
export interface SnapshotBudget {
  AttributePoints: number
  GrowthPoints: number
  Limited: boolean
}

/** 对齐内核 ClassSkillStateSnapshot */
export interface SnapshotSkillState {
  Id: number
  Name: string
  SkillType: string
  Level: number
  ExLevel: number
}

/** 对齐内核 ClassRecordSnapshot */
export interface SnapshotClassRecord {
  IdName: string
  Id: number
  Name: string
  Level: number
  Skills: SnapshotSkillState[]
}

/** 对齐内核 SubClassRecordSnapshot */
export interface SnapshotSubClassRecord {
  IdName: string
  Id: number
  Name: string
  OwnerClassIdName: string
}

/** 对齐内核 ClassRewardLedger */
export interface SnapshotLedger {
  SettledToLevel: number
  CommittedLevel: number
  PendingActiveSkillChoices: number
  PendingPassiveChoices: number
  PendingNumericBoosts: number
  InitialAllocationAvailable: boolean
  LearnedSkillIds: string[]
  AppliedAttribute: SnapshotAllocation
  GrantedInherentPassiveCount: number
  NumericBoostBudget: SnapshotBudget | null
}

/** 对齐内核 ClassPlanSnapshot */
export interface ClassPlanSnapshotJson {
  SkillSelectionEnabled: boolean
  ClassPoints: number
  PrimaryRoleType: string
  SecondaryRoleTypes: string[]
  SubClassOrder: string[]
  Classes: SnapshotClassRecord[]
  SubClasses: SnapshotSubClassRecord[]
  RewardLedgers: Record<string, SnapshotLedger>
  LearnedTalents: Record<string, string[]>
  ActiveTalentId: string | null
  CombatTalentSwitchSkillId: string | null
  DefaultClassIds: string[]
  DefaultSubClassIds: string[]
}

const toSnapshotBudget = (b: AttributeBudget | null): SnapshotBudget | null =>
  b ? { AttributePoints: b.attributePoints, GrowthPoints: b.growthPoints, Limited: b.limited } : null

const toSnapshotAllocation = (a: AttributeAllocation): SnapshotAllocation => ({
  STR: a.STR, AGI: a.AGI, INT: a.INT,
  STRGrowth: a.STRGrowth, AGIGrowth: a.AGIGrowth, INTGrowth: a.INTGrowth,
})

const ZERO_ALLOCATION: SnapshotAllocation = { STR: 0, AGI: 0, INT: 0, STRGrowth: 0, AGIGrowth: 0, INTGrowth: 0 }

/**
 * 当前生效的战斗天赋是否为核心定位的「全等级 +1」天赋
 * （对齐内核 CharacterClass.IsCombatTalentCore + SetCoreTalentLevelBonus；作用对象为全部主动技能）
 */
function coreLevelBonusActive(plan: PlanState): boolean {
  return plan.activeTalentRole === 'Core' && talentById(plan.activeTalentId)?.isCoreBuff === true
}

/**
 * 把前端计划映射为内核 ClassPlanSnapshot
 * <para/>· 职业等级、已学技能、确认等级（CommittedLevel）、各职业技能等级均为精确值
 * （技能等级按 RoadmapSkillLevel 绝对水位重算：1 + 提级累计，魔法额外 +1，末尾按类型上限钳制）
 * <para/>· 计划整体的配额（数值提升次数、初始分配权、已施加属性）挂在**主职业**（等级最高者，同高取 Id 最小）的账本上，
 * 其余职业账本只带该职业可精确推导的部分；职业份选的剩余配额由「累计发放 − 该职业已学」得到，逐职业之和与计划总量一致
 * <para/>· 职业池中的流派固有被动（SubClass.InherentPassives）与【转换战斗天赋】战技在前端没有独立 Id，故不写入快照
 */
export function toClassPlanSnapshot(plan: PlanState): ClassPlanSnapshotJson {
  const classIds = Object.keys(plan.classes).map(Number).sort((a, b) => a - b)
  const mainClassId = classIds.length === 0
    ? null
    : classIds.reduce((best, id) => ((plan.classes[id] ?? 0) > (plan.classes[best] ?? 0) ? id : best), classIds[0])
  const coreBuff = coreLevelBonusActive(plan)

  const classes: SnapshotClassRecord[] = []
  const rewardLedgers: Record<string, SnapshotLedger> = {}

  // —— 每个职业可精确推导的账本字段 ——
  const derived = classIds.map(classId => {
    const level = plan.classes[classId] ?? 1
    const granted = rewardsFor(level)
    const learned = SKILLS.filter(s => s.classId === classId && plan.learnedSkillIds.includes(s.id))
    const learnedActives = learned.filter(s => s.skillType !== 'Passive').length
    const learnedPassives = learned.filter(s => s.skillType === 'Passive').length
    return {
      classId,
      level,
      granted,
      learned,
      pendingActive: Math.max(0, granted.active - learnedActives),
      pendingPassive: Math.max(0, granted.passive - learnedPassives),
    }
  })
  // 「数值提升替代被动选择」会额外抵扣被动配额：差额统一由主职业账本吸收，保证逐职业之和与计划总量一致
  const passiveSum = derived.reduce((n, d) => n + d.pendingPassive, 0)
  const passiveDeficit = Math.max(0, passiveSum - plan.pendingPassiveChoices)

  for (const d of derived) {
    const cls = classById(d.classId)
    if (!cls) continue
    const classIdName = idNameOf(cls.id, cls.name)
    classes.push({
      IdName: classIdName,
      Id: cls.id,
      Name: cls.name,
      Level: d.level,
      Skills: SKILLS.filter(s => s.classId === d.classId).map(s => ({
        Id: s.id,
        Name: s.name,
        SkillType: s.skillType,
        Level: roadmapSkillLevel(d.level, s.skillType),
        // 核心定位天赋的全等级 +1 作用于全部主动技能（职业被动不参与提级）
        ExLevel: coreBuff && s.skillType !== 'Passive' ? 1 : 0,
      })),
    })
    const isMain = d.classId === mainClassId
    rewardLedgers[classIdName] = {
      SettledToLevel: d.level,
      CommittedLevel: plan.committedLevels[d.classId] ?? -1,
      PendingActiveSkillChoices: d.pendingActive,
      PendingPassiveChoices: Math.max(0, d.pendingPassive - (isMain ? passiveDeficit : 0)),
      PendingNumericBoosts: isMain ? plan.numericBoosts : 0,
      InitialAllocationAvailable: isMain ? plan.initialAllocationAvailable : false,
      LearnedSkillIds: d.learned.map(s => idNameOf(s.id, s.name)),
      AppliedAttribute: isMain ? toSnapshotAllocation(plan.appliedAttribute) : { ...ZERO_ALLOCATION },
      GrantedInherentPassiveCount: d.granted.inherent,
      NumericBoostBudget: toSnapshotBudget(numericBoostBudgetForLevel(d.level)),
    }
  }

  const subClasses: SnapshotSubClassRecord[] = plan.subClasses
    .map(sid => subById(sid))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map(s => {
      const owner = classById(s.classId)
      return {
        IdName: idNameOf(s.id, s.name),
        Id: s.id,
        Name: s.name,
        OwnerClassIdName: owner ? idNameOf(owner.id, owner.name) : '',
      }
    })

  const learnedTalents: Record<string, string[]> = {}
  for (const [role, ids] of Object.entries(plan.learnedTalents) as [RoleType, number[] | undefined][]) {
    const names = (ids ?? [])
      .map(id => talentById(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => idNameOf(t.id, t.name))
    if (names.length > 0) learnedTalents[role] = names
  }

  const activeTalent = talentById(plan.activeTalentId)
  return {
    SkillSelectionEnabled: true,
    ClassPoints: plan.classPoints,
    PrimaryRoleType: plan.primaryRoleType,
    SecondaryRoleTypes: [...plan.secondaryRoleTypes],
    SubClassOrder: subClasses.map(s => s.IdName),
    Classes: classes,
    SubClasses: subClasses,
    RewardLedgers: rewardLedgers,
    LearnedTalents: learnedTalents,
    ActiveTalentId: activeTalent ? idNameOf(activeTalent.id, activeTalent.name) : null,
    // 已学天赋 ≥ 2 时内核会挂载【转换战斗天赋】战技，但前端没有该战技的独立 Id
    CombatTalentSwitchSkillId: null,
    DefaultClassIds: plan.defaultClasses
      .map(id => classById(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => idNameOf(c.id, c.name)),
    DefaultSubClassIds: plan.defaultSubClasses
      .map(id => subById(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map(s => idNameOf(s.id, s.name)),
  }
}

/**
 * 内核 ClassPlanSnapshot → 前端 PlanState（<see cref="toClassPlanSnapshot"/> 的逆运算）
 * <para/>服务端权威模式下，每个动作执行后用它把返回的快照回写为本地状态
 * <para/>· 逐职业可精确推导的部分（等级、确认等级、已学技能）直接读取
 * <para/>· 计划整体的配额（主动 / 被动选择权、数值提升次数、初始分配权、已施加属性）在正向时挂在**主职业**账本上，
 *   故此处按「逐职业求和」还原（非主职业对应字段为 0 / false / 零分配，求和即等于计划总量）
 * <para/>· 角色等级（Level）不在快照里，沿用 base；phase 为展示用标签，同样沿用 base
 */
/**
 * 内核 ClassPlanSnapshot → 前端 PlanState（toClassPlanSnapshot 的逆运算）
 * <para/>服务端权威模式下，每个动作执行后用它把返回的快照回写为本地状态
 * <para/>**键名兼容**：WebAPI 的 REST 响应走 camelCase（classes / rewardLedgers / pendingActiveSkillChoices…），
 * 而存档与导出走 PascalCase（Classes / RewardLedgers…），故全部字段按「首字母小写」做双取
 * <para/>· 逐职业可精确推导的部分（等级、确认等级、已学技能）直接读取
 * <para/>· 计划整体的配额在正向时挂在**主职业**账本上，故此处按「逐职业求和」还原
 * <para/>· 角色等级（Level）不在快照里，沿用 base；phase 为展示标签，同样沿用 base
 */
type Loose = Record<string, unknown>

const pick = <T>(o: unknown, pascal: string): T | undefined => {
  if (!o || typeof o !== 'object') return undefined
  const r = o as Loose
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)
  return (r[pascal] ?? r[camel]) as T | undefined
}
const numOf = (o: unknown, key: string, fallback = 0): number => {
  const v = pick<number>(o, key)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
const boolOf = (o: unknown, key: string): boolean => pick<boolean>(o, key) === true
const arrOf = (o: unknown, key: string): unknown[] => {
  const v = pick<unknown>(o, key)
  return Array.isArray(v) ? v : []
}
const objOf = (o: unknown, key: string): Loose => {
  const v = pick<unknown>(o, key)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {}
}
/** 属性字段在 camelCase 下会全小写（STR → str），故依次尝试 */
const attrOf = (o: unknown, ...keys: string[]): number => {
  if (!o || typeof o !== 'object') return 0
  const r = o as Loose
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return 0
}

export function planFromSnapshot(snap: unknown, base: PlanState): PlanState {
  const classes: Record<number, number> = {}
  const committedLevels: Record<number, number> = {}
  const learnedSkillIds: number[] = []
  let pendingActive = 0
  let pendingPassive = 0
  let numericBoosts = 0
  let initialAllocationAvailable = false
  let numericBoostBudget: AttributeBudget | null = null
  const applied: AttributeAllocation = { STR: 0, AGI: 0, INT: 0, STRGrowth: 0, AGIGrowth: 0, INTGrowth: 0 }
  const ledgers = objOf(snap, 'RewardLedgers')

  for (const raw of arrOf(snap, 'Classes')) {
    const idName = pick<string>(raw, 'IdName') ?? ''
    const id = idFrom(idName) ?? numOf(raw, 'Id', Number.NaN)
    if (!Number.isFinite(id)) continue
    classes[id] = numOf(raw, 'Level', 1)

    const ledger = ledgers[idName]
    if (!ledger) continue
    committedLevels[id] = numOf(ledger, 'CommittedLevel', -1)
    pendingActive += numOf(ledger, 'PendingActiveSkillChoices')
    pendingPassive += numOf(ledger, 'PendingPassiveChoices')
    numericBoosts += numOf(ledger, 'PendingNumericBoosts')
    if (boolOf(ledger, 'InitialAllocationAvailable')) initialAllocationAvailable = true

    const budget = pick<unknown>(ledger, 'NumericBoostBudget')
    if (budget && typeof budget === 'object') {
      numericBoostBudget = {
        attributePoints: numOf(budget, 'AttributePoints'),
        growthPoints: numOf(budget, 'GrowthPoints'),
        limited: boolOf(budget, 'Limited'),
      }
    }

    const a = pick<unknown>(ledger, 'AppliedAttribute')
    applied.STR += attrOf(a, 'STR', 'str')
    applied.AGI += attrOf(a, 'AGI', 'agi')
    applied.INT += attrOf(a, 'INT', 'int')
    applied.STRGrowth += attrOf(a, 'STRGrowth', 'strGrowth')
    applied.AGIGrowth += attrOf(a, 'AGIGrowth', 'agiGrowth')
    applied.INTGrowth += attrOf(a, 'INTGrowth', 'intGrowth')

    for (const sid of arrOf(ledger, 'LearnedSkillIds')) {
      const n = idFrom(typeof sid === 'string' ? sid : null)
      if (n !== null) learnedSkillIds.push(n)
    }
  }

  const order = arrOf(snap, 'SubClassOrder')
  const subNames = order.length > 0
    ? order.map(s => (typeof s === 'string' ? s : pick<string>(s, 'IdName') ?? ''))
    : arrOf(snap, 'SubClasses').map(s => pick<string>(s, 'IdName') ?? '')
  const subClasses = subNames.map(idFrom).filter((n): n is number => n !== null)

  const learnedTalents: Partial<Record<RoleType, number[]>> = {}
  let activeTalentRole: RoleType | null = null
  const activeId = idFrom(pick<string>(snap, 'ActiveTalentId'))
  for (const [role, names] of Object.entries(objOf(snap, 'LearnedTalents'))) {
    const ids = (Array.isArray(names) ? names : [])
      .map(n => idFrom(typeof n === 'string' ? n : null))
      .filter((n): n is number => n !== null)
    if (ids.length === 0) continue
    learnedTalents[role as RoleType] = ids
    if (activeId !== null && ids.includes(activeId)) activeTalentRole = role as RoleType
  }

  return {
    level: base.level,
    classPoints: numOf(snap, 'ClassPoints', base.classPoints),
    classes,
    subClasses,
    learnedSkillIds,
    primaryRoleType: (pick<string>(snap, 'PrimaryRoleType') as RoleType) ?? 'None',
    secondaryRoleTypes: arrOf(snap, 'SecondaryRoleTypes').map(s => String(s) as RoleType),
    learnedTalents,
    activeTalentId: activeId,
    activeTalentRole,
    defaultClasses: arrOf(snap, 'DefaultClassIds').map(s => idFrom(String(s))).filter((n): n is number => n !== null),
    defaultSubClasses: arrOf(snap, 'DefaultSubClassIds').map(s => idFrom(String(s))).filter((n): n is number => n !== null),
    phase: base.phase,
    pendingActiveChoices: pendingActive,
    pendingPassiveChoices: pendingPassive,
    numericBoosts,
    initialAllocationAvailable,
    appliedAttribute: applied,
    committedLevels,
    numericBoostBudget,
  }
}
