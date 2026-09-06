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

// 规划快照（映射 Character.Class + 三定位；小字注：导出形状 = 未来真实端点请求体）
export interface PlanState {
  level: number
  classPoints: number
  classes: Record<number, number> // classId -> 职业记录等级（副本语义，定义共享）
  subClasses: number[]
  learnedSkillIds: number[]
  firstRoleType: RoleType
  secondRoleType: RoleType
  thirdRoleType: RoleType
  learnedTalents: Partial<Record<RoleType, number>>
  activeTalentRole: RoleType | null
  defaultClasses: number[]
  defaultSubClasses: number[]
  phase: string // 当前规划阶段标签（供卷宗展示）
}

export const RULES = {
  classPointsAt: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
  maxClassLevel: 10,
  minLevelCanModifyDefault: 20,
  maxRoleTypes: 3,
  switchDecisionPoints: 2,
  switchSkillQuota: 1,
} as const

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
    firstRoleType: 'None',
    secondRoleType: 'None',
    thirdRoleType: 'None',
    learnedTalents: {},
    activeTalentRole: null,
    defaultClasses: [],
    defaultSubClasses: [],
    phase: '誓约之始',
  }
}

export const initialPlan = (level: number): PlanState => emptyPlan(level)
