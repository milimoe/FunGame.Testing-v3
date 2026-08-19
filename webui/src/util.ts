import type { CharacterRef, CharacterStateSnapshot } from './types'

// ===== 数值格式化 =====
export function fmt(n: number, digits = 0): string {
  if (n === undefined || n === null || !isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function fmtTime(totalSeconds: number): string {
  if (!isFinite(totalSeconds)) return '—'
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}时${m}分${sec}秒`
  if (m > 0) return `${m}分${sec}秒`
  return `${sec}秒`
}

// ===== 角色名称 =====
// 兼容两种引用格式：存档 JSON 的 PascalCase（CharacterRef）与 API DTO 的 camelCase（CharacterRefDto）
export interface CharLike {
  Guid?: string
  guid?: string
  Name?: string
  name?: string
  FirstName?: string
  firstName?: string
  NickName?: string
  nickName?: string
  UserName?: string
  userName?: string
}

export const charName = (c?: CharLike | null): string =>
  c?.NickName || c?.Name || c?.FirstName || c?.nickName || c?.name || '未知角色'

// ===== 枚举映射（CharacterActionType / SkillType / EffectType / EquipSlotType）=====
export const ACTION_TYPE_NAMES: Record<number, string> = {
  0: '无', 1: '移动', 2: '普通攻击', 3: '施法前摇', 4: '施放技能', 5: '施放爆发技', 6: '使用物品', 7: '结束回合',
}

export const ACTION_TYPE_ICONS: Record<number, string> = {
  0: '·', 1: '🚶', 2: '⚔️', 3: '🪄', 4: '✨', 5: '💥', 6: '🎒', 7: '⏹️',
}

export const SKILL_TYPE_NAMES: Record<number, string> = {
  0: '魔法', 1: '战技', 2: '爆发技', 3: '被动', 4: '物品',
}

export const EFFECT_TYPE_NAMES: Record<number, string> = {
  0: '被动', 1: '装备', 2: '标记', 3: '眩晕', 4: '冰冻', 5: '沉默', 6: '定身', 7: '恐惧', 8: '睡眠',
  9: '击退', 10: '击倒', 11: '嘲讽', 12: '减速', 13: '衰弱', 14: '中毒', 15: '燃烧', 16: '流血',
  17: '致盲', 18: '致残', 19: '护盾', 20: '持续治疗', 21: '加速', 22: '无敌', 23: '不可选中',
  24: '伤害提升', 25: '防御提升', 26: '暴击提升', 27: '魔法恢复', 28: '破甲', 29: '降低魔法抗性',
  30: '诅咒', 31: '疲劳', 32: '魔力燃烧', 33: '魅惑', 34: '缴械', 35: '混乱', 36: '石化',
  37: '法术沉默', 38: '放逐', 39: '毁灭', 40: '物理免疫', 41: '魔法免疫', 42: '技能免疫',
  43: '完全免疫', 44: '闪避提升', 45: '生命偷取', 46: '重伤', 47: '持续弱驱散', 48: '持续强驱散',
  49: '恢复', 50: '易伤', 51: '迟滞', 52: '专注', 53: '打断施法',
}

export const EQUIP_SLOT_NAMES: Record<number, string> = {
  1: '魔法卡包', 2: '武器', 3: '护甲', 4: '鞋子', 5: '饰品1', 6: '饰品2',
}

export const skillTypeName = (t: number) => SKILL_TYPE_NAMES[t] ?? `类型${t}`
export const actionTypeName = (t: number) => ACTION_TYPE_NAMES[t] ?? `行动${t}`
export const effectTypeName = (t: number) => EFFECT_TYPE_NAMES[t] ?? `特效${t}`
export const equipSlotName = (t: number) => EQUIP_SLOT_NAMES[t] ?? `槽位${t}`

// ===== 角色稳定配色（按 Guid 哈希取色板）=====
const PALETTE = [
  '#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa',
  '#f87171', '#2dd4bf', '#fb923c', '#c084fc', '#4ade80',
]

export function charColor(guid: string): string {
  let hash = 0
  for (let i = 0; i < guid.length; i++) hash = (hash * 31 + guid.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

// ===== 对象（Record<string, T>）转条目数组 =====
export function keyedToEntries<T>(map: Record<string, T> | null | undefined): [string, T][] {
  return Object.entries(map ?? {})
}

// ===== 按 Guid 建角色索引 =====
export function charIndex(chars: CharacterRef[] | null | undefined): Map<string, CharacterRef> {
  const map = new Map<string, CharacterRef>()
  for (const c of chars ?? []) {
    if (c.Guid && !map.has(c.Guid)) map.set(c.Guid, c)
  }
  return map
}

// ===== 检查点描述索引（id -> 描述），直接从检查点快照构建，不再依赖 /api/gamedata =====
export interface CheckpointDescMaps {
  skillDesc: Map<number, string>
  itemDesc: Map<number, string>
  effectDesc: Map<number, string>
}

export function buildCheckpointDescMaps(checkpoint: CharacterStateSnapshot[] | null | undefined): CheckpointDescMaps {
  const skillDesc = new Map<number, string>()
  const itemDesc = new Map<number, string>()
  const effectDesc = new Map<number, string>()
  for (const state of checkpoint ?? []) {
    for (const s of state.Skills ?? []) if (s.Description) skillDesc.set(s.SkillId, s.Description)
    for (const it of state.Items ?? []) if (it.Description) itemDesc.set(it.ItemId, it.Description)
    for (const ef of state.Effects ?? []) if (ef.Description) effectDesc.set(ef.EffectId, ef.Description)
  }
  return { skillDesc, itemDesc, effectDesc }
}
