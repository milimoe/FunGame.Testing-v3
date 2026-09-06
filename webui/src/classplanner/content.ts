// 幻想风内容数据（mock）+ 示例角色。小字注：此处即内核「模组注册侧」的前端替身。
import type { ClassDef, ClassLevelReward, PlanState, SubClassDef, TalentDef, RoleType } from './types'

// —— 职业 ——
export const CLASSES: ClassDef[] = [
  { id: 1, name: '誓剑士', epithet: '誓约之锋', hue: '#c94f3d', desc: '以血为誓的近战者，剑锋所至即契约所成。' },
  { id: 2, name: '奥术师', epithet: '秘律织者', hue: '#4f6fc9', desc: '拨动世界法则的织法者，用咒语重写战场。' },
  { id: 3, name: '影行者', epithet: '暮影猎手', hue: '#3f9c6a', desc: '生于暗影的猎手，先于敌意抵达。' },
]

// —— 流派（SubClass：提供定位候选 + 固有被动门槛）——
export const SUBCLASSES: SubClassDef[] = [
  { id: 11, classId: 1, name: '圣焰骑士', roleTypes: ['Core', 'Vanguard'], desc: '背负圣焰的骑士，冲锋即祝福。', inherent: { 1: ['誓约护体'], 6: ['圣焰之心'] } },
  { id: 12, classId: 1, name: '磐岩卫', roleTypes: ['Guardian', 'Support'], desc: '以身躯为城墙的卫者。', inherent: { 1: ['磐石之躯'], 6: ['大地共鸣'] } },
  { id: 21, classId: 2, name: '星辉咏者', roleTypes: ['Core', 'Support'], desc: '吟唱群星之名的咏者。', inherent: { 1: ['星语低语'], 6: ['苍穹和弦'] } },
  { id: 22, classId: 2, name: '时序贤者', roleTypes: ['Medic', 'Support'], desc: '行走于时间缝隙的贤者。', inherent: { 1: ['时光微澜'], 6: ['命运编织'] } },
  { id: 31, classId: 3, name: '暗影刺客', roleTypes: ['Core', 'Vanguard'], desc: '刀尖先于影子抵达。', inherent: { 1: ['背刺本能'], 6: ['影分身'] } },
  { id: 32, classId: 3, name: '迷雾猎手', roleTypes: ['Vanguard', 'Support'], desc: '以雾为弓，以静为矢。', inherent: { 1: ['雾隐'], 6: ['猎杀标记'] } },
]

// —— 技能池（职业共享；仅示意少量，Level>0 视为已学）——
export const SKILLS: { id: number; classId: number; name: string; skillType: 'Skill' | 'Magic' | 'SuperSkill' | 'Passive'; desc: string }[] = [
  { id: 101, classId: 1, name: '断罪斩', skillType: 'Skill', desc: '对单体造成高额物理伤害。' },
  { id: 102, classId: 1, name: '圣焰审判', skillType: 'Magic', desc: '圣焰属性魔法伤害。' },
  { id: 103, classId: 1, name: '誓约庇护', skillType: 'Passive', desc: '每层圣焰减伤。' },
  { id: 201, classId: 2, name: '奥术飞弹', skillType: 'Magic', desc: '追踪魔法飞弹。' },
  { id: 202, classId: 2, name: '星坠', skillType: 'SuperSkill', desc: '召唤流星坠落。' },
  { id: 203, classId: 2, name: '法力潮汐', skillType: 'Passive', desc: '回复法力。' },
  { id: 301, classId: 3, name: '影袭', skillType: 'Skill', desc: '背身突袭。' },
  { id: 302, classId: 3, name: '致盲粉', skillType: 'Magic', desc: '削弱视野。' },
  { id: 303, classId: 3, name: '掠影', skillType: 'Passive', desc: '提速。' },
]

// —— 战斗天赋池（绑定职业、按定位分组；核心天赋自带 isCoreBuff）——
export const TALENTS: TalentDef[] = [
  { id: 1101, classId: 1, roleType: 'Core', name: '圣剑祈愿', desc: '激活：自身与职业技能等级 +1（普攻/魔法 9、战技/爆发 7 上限）', isCoreBuff: true },
  { id: 1102, classId: 1, roleType: 'Core', name: '处刑者誓约', desc: '对低生命敌人的伤害提升。' },
  { id: 1111, classId: 1, roleType: 'Vanguard', name: '冲锋号角', desc: '先手行动值提升。' },
  { id: 1112, classId: 1, roleType: 'Vanguard', name: '铁壁突进', desc: '冲锋后获得护盾。' },
  { id: 1121, classId: 1, roleType: 'Guardian', name: '不屈壁垒', desc: '濒死时获得减伤。' },
  { id: 1211, classId: 1, roleType: 'Support', name: '誓言守护', desc: '为队友分担伤害。' },
  { id: 2101, classId: 2, roleType: 'Core', name: '大魔导师', desc: '激活：自身与职业技能等级 +1', isCoreBuff: true },
  { id: 2102, classId: 2, roleType: 'Core', name: '魔力过载', desc: '法术伤害提升。' },
  { id: 2211, classId: 2, roleType: 'Medic', name: '生命织法', desc: '治疗量提升。' },
  { id: 2212, classId: 2, roleType: 'Medic', name: '时光回溯', desc: '治疗可清除减益。' },
  { id: 2201, classId: 2, roleType: 'Support', name: '星辉增幅', desc: '增益效果增强。' },
  { id: 3101, classId: 3, roleType: 'Core', name: '暗影主宰', desc: '激活：自身与职业技能等级 +1', isCoreBuff: true },
  { id: 3102, classId: 3, roleType: 'Core', name: '终结标记', desc: '对受控目标伤害提升。' },
  { id: 3111, classId: 3, roleType: 'Vanguard', name: '先手阴影', desc: '行动值提升。' },
  { id: 3211, classId: 3, roleType: 'Support', name: '迷雾笼罩', desc: '削弱敌方命中。' },
]

// —— 默认路线图（对齐内核 ClassLevelUpReward.BuildDefaultTable）——
export const REWARD_TABLE: ClassLevelReward[] = [
  { level: 1, inherentPassive: 1, activeChoices: 0, passiveChoices: 0, numericBoost: false, skillLevelUp: 0, magicExtra: 0 },
  { level: 2, inherentPassive: 0, activeChoices: 2, passiveChoices: 0, numericBoost: false, skillLevelUp: 0, magicExtra: 0 },
  { level: 3, inherentPassive: 0, activeChoices: 0, passiveChoices: 0, numericBoost: false, skillLevelUp: 1, magicExtra: 1 },
  { level: 4, inherentPassive: 0, activeChoices: 0, passiveChoices: 1, numericBoost: true, skillLevelUp: 0, magicExtra: 0 },
  { level: 5, inherentPassive: 0, activeChoices: 2, passiveChoices: 0, numericBoost: false, skillLevelUp: 1, magicExtra: 1 },
  { level: 6, inherentPassive: 1, activeChoices: 0, passiveChoices: 0, numericBoost: false, skillLevelUp: 0, magicExtra: 0 },
  { level: 7, inherentPassive: 0, activeChoices: 0, passiveChoices: 0, numericBoost: false, skillLevelUp: 1, magicExtra: 1 },
  { level: 8, inherentPassive: 0, activeChoices: 2, passiveChoices: 0, numericBoost: false, skillLevelUp: 1, magicExtra: 1 },
  { level: 9, inherentPassive: 0, activeChoices: 0, passiveChoices: 2, numericBoost: true, skillLevelUp: 0, magicExtra: 0 },
  { level: 10, inherentPassive: 0, activeChoices: 2, passiveChoices: 0, numericBoost: false, skillLevelUp: 1, magicExtra: 1 },
]

// —— 技能等级上限（对齐 SkillSet.GetSkillMaxLevel）——
export const SKILL_CAP: Record<'Skill' | 'Magic' | 'SuperSkill', number> = { Skill: 6, Magic: 8, SuperSkill: 6 }

// —— 示例角色：60 级誓剑士（主 圣焰骑士 10 级，兼职 时序贤者 1 级）——
export function samplePlan(): PlanState {
  return {
    level: 60,
    classPoints: 0, // 12 点已花完（主职 10 + 兼职 1 + 升级 9 …见下注）
    classes: { 1: 10, 2: 1 },
    subClasses: [11, 22],
    learnedSkillIds: [101, 102, 103, 201],
    firstRoleType: 'Core',
    secondRoleType: 'Vanguard',
    thirdRoleType: 'Medic',
    learnedTalents: { Core: 1101, Vanguard: 1111, Medic: 2211 },
    activeTalentRole: 'Core',
    defaultClasses: [1],
    defaultSubClasses: [11],
    phase: '誓约达成',
  }
}

export const SAMPLE_NOTE =
  '示例 · 誓剑士 60 级：圣焰骑士 10 级(满) + 兼职 时序贤者 1 级；定位 核心/先锋/治疗；已学三天赋，激活核心天赋「圣剑祈愿」。'

// 帮助函数
export function classById(id: number): ClassDef | undefined {
  return CLASSES.find(c => c.id === id)
}
export function subById(id: number): SubClassDef | undefined {
  return SUBCLASSES.find(s => s.id === id)
}
export function talentById(id?: number | null): TalentDef | undefined {
  return id ? TALENTS.find(t => t.id === id) : undefined
}
export function roleTypesOfPlan(plan: PlanState): RoleType[] {
  return [plan.firstRoleType, plan.secondRoleType, plan.thirdRoleType].filter(r => r !== 'None')
}
export function candidatesOf(plan: PlanState): RoleType[] {
  const set = new Set<RoleType>()
  plan.subClasses.forEach(sid => subById(sid)?.roleTypes.forEach(r => set.add(r)))
  return [...set]
}
