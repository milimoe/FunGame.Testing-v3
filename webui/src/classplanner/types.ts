// 职业规划模拟器 —— 类型定义（形状对齐 FunGame.Core：#153 职业系统）
// 页面内小字「原型注」会提示与内核字段的对应关系。

export type RoleType = 'None' | 'Core' | 'Vanguard' | 'Guardian' | 'Support' | 'Medic'
export type SkillType = 'Magic' | 'Skill' | 'SuperSkill' | 'Passive' | 'Item'
export type SkillSource = 'None' | 'Class' | 'SubClass' | 'CombatTalent' | 'Item' | 'MagicCardPack' | 'Reward'

export const ROLE_ORDER: RoleType[] = ['Core', 'Vanguard', 'Guardian', 'Support', 'Medic']

export const ROLE_META: Record<Exclude<RoleType, 'None'>, { label: string; glyph: string; hue: string; desc: string }> = {
  Core: { label: '核心', glyph: '☀', hue: '#e0523a', desc: '极高输出，身板脆弱' },
  Vanguard: { label: '先锋', glyph: '⚔', hue: '#d9a02c', desc: '先发制人，攻守兼备' },
  Guardian: { label: '近卫', glyph: '⛨', hue: '#3f8f8f', desc: '高生命高护甲，守护队友' },
  Support: { label: '支援', glyph: '✦', hue: '#7a6fd0', desc: '施加增益减益' },
  Medic: { label: '治疗', glyph: '✚', hue: '#4fae7e', desc: '治疗与防御' },
}

export function roleLabel(r: RoleType): string {
  return r === 'None' ? '未定' : ROLE_META[r].label
}

// 职业（Class 定义，对应内核 Entity/Character/Class.cs）
export interface ClassDef {
  id: number
  name: string
  epithet: string // 称号
  hue: string // 职业专属色
  desc: string
  attributeLimit?: AttributeLimit // 职业模板的核心属性分配上下限（约束 1 级初始分配）
}

// 流派（SubClass 定义：提供定位候选 + 固有被动门槛；构造注入所属职业）
export interface SubClassDef {
  id: number
  classId: number
  name: string
  roleTypes: RoleType[]
  desc: string
  inherent: Record<number, string[]> // 职业等级门槛 -> 固有被动名（1 / 6）
}

// 技能（池内共享；Level>0 视为已学；自动授予项自带 Level=1）
export interface SkillDef {
  id: number
  classId: number
  name: string
  skillType: SkillType
  desc: string
}

// 战斗天赋（绑定职业，按定位分组；核心天赋自带「全等级 +1」被动）
export interface TalentDef {
  id: number
  classId: number
  roleType: RoleType
  name: string
  desc: string
  isCoreBuff?: boolean // 核心定位天赋：激活时自身/职业技能 +1（普攻/魔法 9、战技/爆发 7 上限）
}

export interface ClassLevelReward {
  level: number
  inherentPassive: number
  activeChoices: number
  passiveChoices: number
  numericBoost: boolean
  skillLevelUp: number
  magicExtra: number
}

// 核心属性分配（对齐内核 ClassAttributeAllocation）
export interface AttributeAllocation {
  STR: number
  AGI: number
  INT: number
  STRGrowth: number
  AGIGrowth: number
  INTGrowth: number
}

// 分配额度（对齐内核 ClassAttributeBudget：属性点总额 + 成长总额 + 是否受限）
export interface AttributeBudget {
  attributePoints: number
  growthPoints: number
  limited: boolean
}

// 职业 / 角色模板限值（对齐内核 ClassAttributeLimit，null 表示不限）
export interface AttributeLimit {
  STRMin?: number
  STRMax?: number
  AGIMin?: number
  AGIMax?: number
  INTMin?: number
  INTMax?: number
  STRGrowthMin?: number
  STRGrowthMax?: number
  AGIGrowthMin?: number
  AGIGrowthMax?: number
  INTGrowthMin?: number
  INTGrowthMax?: number
}

// 规划快照（映射 Character.Class + 三定位；小字注：导出形状 = 未来真实端点请求体）
export interface PlanState {
  level: number
  classPoints: number
  classes: Record<number, number> // classId -> 职业记录等级（副本语义，定义共享）
  subClasses: number[]
  learnedSkillIds: number[]
  primaryRoleType: RoleType // 主要定位：等于当前生效战斗天赋的定位（未激活为 None）
  secondaryRoleTypes: RoleType[] // 次要定位：由已选流派按职业等级降序自动推导
  learnedTalents: Partial<Record<RoleType, number[]>> // 定位 -> 已学天赋 id 列表（同定位可掌握多个）
  activeTalentId: number | null // 当前生效的战斗天赋 id
  activeTalentRole: RoleType | null // 生效天赋所属定位（= 主要定位）
  defaultClasses: number[]
  defaultSubClasses: number[]
  phase: string // 当前规划阶段标签（供卷宗展示）
  // —— 路线图奖励账本（对齐 ClassRewardLedger）——
  pendingActiveChoices: number // 剩余职业技能选择权
  pendingPassiveChoices: number // 剩余被动选择权
  numericBoosts: number // 剩余数值提升次数（4 / 9 级档位）
  initialAllocationAvailable: boolean // 1 级初始分配权是否可领取
  appliedAttribute: AttributeAllocation // 已施加的属性分配（洗点回退）
}

export const RULES = {
  classPointsAt: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
  maxClassLevel: 10,
  minLevelCanModifyDefault: 20,
  maxRoleTypes: 3, // 定位总数上限（主要 + 次要）
  maxSecondaryRoles: 2, // 次要定位上限
  switchDecisionPoints: 2,
  switchSkillQuota: 1,
  // 1 级初始分配：30 点属性 + 3.0 成长，受职业与角色模板上下限约束
  initialBudget: { attributePoints: 30, growthPoints: 3.0, limited: true } as AttributeBudget,
  // 4 / 9 级数值提升：9 点属性 + 0.9 成长，可任意分配、不受限
  numericBoostBudget: { attributePoints: 9, growthPoints: 0.9, limited: false } as AttributeBudget,
} as const

/** 空分配 */
export function emptyAllocation(): AttributeAllocation {
  return { STR: 0, AGI: 0, INT: 0, STRGrowth: 0, AGIGrowth: 0, INTGrowth: 0 }
}

/** 属性点合计（力量 + 敏捷 + 智力） */
export function allocationPoints(a: AttributeAllocation): number {
  return a.STR + a.AGI + a.INT
}

/** 成长合计 */
export function allocationGrowth(a: AttributeAllocation): number {
  return a.STRGrowth + a.AGIGrowth + a.INTGrowth
}

/** 追加一份分配到累计值上 */
export function addAllocation(base: AttributeAllocation, add: AttributeAllocation): AttributeAllocation {
  return {
    STR: base.STR + add.STR,
    AGI: base.AGI + add.AGI,
    INT: base.INT + add.INT,
    STRGrowth: base.STRGrowth + add.STRGrowth,
    AGIGrowth: base.AGIGrowth + add.AGIGrowth,
    INTGrowth: base.INTGrowth + add.INTGrowth,
  }
}

/** 合并限值：取更紧的一侧（对齐内核 ClassAttributeLimit.Intersect） */
export function intersectLimit(a: AttributeLimit | null, b: AttributeLimit | null): AttributeLimit | null {
  if (!a) return b
  if (!b) return a
  const min = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.max(x, y))
  const max = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.min(x, y))
  return {
    STRMin: min(a.STRMin, b.STRMin), STRMax: max(a.STRMax, b.STRMax),
    AGIMin: min(a.AGIMin, b.AGIMin), AGIMax: max(a.AGIMax, b.AGIMax),
    INTMin: min(a.INTMin, b.INTMin), INTMax: max(a.INTMax, b.INTMax),
    STRGrowthMin: min(a.STRGrowthMin, b.STRGrowthMin), STRGrowthMax: max(a.STRGrowthMax, b.STRGrowthMax),
    AGIGrowthMin: min(a.AGIGrowthMin, b.AGIGrowthMin), AGIGrowthMax: max(a.AGIGrowthMax, b.AGIGrowthMax),
    INTGrowthMin: min(a.INTGrowthMin, b.INTGrowthMin), INTGrowthMax: max(a.INTGrowthMax, b.INTGrowthMax),
  }
}

/** 校验一份分配是否可用额度接受（对齐内核 ClassAttributeBudget.Check） */
export function checkAllocation(
  allocation: AttributeAllocation,
  budget: AttributeBudget,
  limit: AttributeLimit | null,
): { ok: boolean; error?: string } {
  const negative = Object.values(allocation).some(v => v < 0)
  if (negative) return { ok: false, error: '属性与成长分配不能为负数。' }
  if (allocationPoints(allocation) > budget.attributePoints + 1e-9) {
    return { ok: false, error: `属性点超出额度（已分配 ${allocationPoints(allocation)} / 上限 ${budget.attributePoints}）。` }
  }
  if (allocationGrowth(allocation) > budget.growthPoints + 1e-9) {
    return { ok: false, error: `成长超出额度（已分配 ${allocationGrowth(allocation)} / 上限 ${budget.growthPoints}）。` }
  }
  if (budget.limited && limit) {
    const items: Array<[string, number, number | undefined, number | undefined]> = [
      ['力量', allocation.STR, limit.STRMin, limit.STRMax],
      ['敏捷', allocation.AGI, limit.AGIMin, limit.AGIMax],
      ['智力', allocation.INT, limit.INTMin, limit.INTMax],
      ['力量成长', allocation.STRGrowth, limit.STRGrowthMin, limit.STRGrowthMax],
      ['敏捷成长', allocation.AGIGrowth, limit.AGIGrowthMin, limit.AGIGrowthMax],
      ['智力成长', allocation.INTGrowth, limit.INTGrowthMin, limit.INTGrowthMax],
    ]
    for (const [name, value, lo, hi] of items) {
      if (lo !== undefined && value < lo) return { ok: false, error: `${name}分配 ${value} 低于下限 ${lo}。` }
      if (hi !== undefined && value > hi) return { ok: false, error: `${name}分配 ${value} 高于上限 ${hi}。` }
    }
  }
  return { ok: true }
}

// 等级可获得的职业点数（对齐 EquilibriumConstant.ClassPointsGetterList）
export function classPointsForLevel(level: number): number {
  return RULES.classPointsAt.filter(l => level >= l).length
}

export function emptyPlan(level = 1): PlanState {
  return {
    level,
    classPoints: classPointsForLevel(level),
    classes: {},
    subClasses: [],
    learnedSkillIds: [],
    primaryRoleType: 'None',
    secondaryRoleTypes: [],
    learnedTalents: {},
    activeTalentId: null,
    activeTalentRole: null,
    defaultClasses: [],
    defaultSubClasses: [],
    phase: '誓约之始',
    pendingActiveChoices: 0,
    pendingPassiveChoices: 0,
    numericBoosts: 0,
    initialAllocationAvailable: false,
    appliedAttribute: emptyAllocation(),
  }
}

export const initialPlan = (level: number): PlanState => emptyPlan(level)
