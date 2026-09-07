import { useMemo, useState } from 'react'
import type { SoloCharacterDto, SoloItemDto, SoloSkillDto } from '../../game/soloTypes'

interface SoloRosterProps {
  characters: SoloCharacterDto[]
  playerGuid: string | null
}

function Bar({ value, max, color, bg }: { value: number; max: number; color: string; bg: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="h-[5px] w-full overflow-hidden rounded-full" style={{ backgroundColor: bg }}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function SkillChip({ skill }: { skill: SoloSkillDto }) {
  const tag = skill.isSuperSkill ? '爆发' : skill.isMagic ? '魔法' : '战技'
  const unusable = !skill.usable
  return (
    <div
      title={unusable ? skill.unusableReason : `${skill.name} · ${skill.description || '无描述'}`}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-[2px] text-[10.5px] leading-tight ${
        unusable
          ? 'border-ink-400/20 bg-ink-800/5 text-ink-400 line-through'
          : 'border-gold-500/35 bg-gold-300/10 text-ink-700'
      }`}
    >
      <span className="shrink-0 rounded-sm bg-ink-800/10 px-0.5 text-[9px] text-ink-500">{tag}</span>
      <span className="truncate">{skill.name}</span>
      {skill.currentCD > 0 && <span className="shrink-0 font-mono text-[9px] text-horde-500">CD{skill.currentCD.toFixed(0)}</span>}
      {skill.realMPCost > 0 && <span className="shrink-0 font-mono text-[9px] text-alliance-500">{skill.realMPCost}MP</span>}
      {skill.realEPCost > 0 && <span className="shrink-0 font-mono text-[9px] text-gold-600">{skill.realEPCost}EP</span>}
    </div>
  )
}

function ItemChip({ item }: { item: SoloItemDto }) {
  const unusable = !item.usable
  return (
    <div
      title={unusable ? item.unusableReason : item.description || item.name}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-[2px] text-[10.5px] ${
        unusable ? 'border-ink-400/20 bg-ink-800/5 text-ink-400 line-through' : 'border-parchment-500/50 bg-parchment-200/60 text-ink-700'
      }`}
    >
      <span className="truncate">{item.name}</span>
      {item.remainUseTimes > 0 && <span className="shrink-0 font-mono text-[9px] text-ink-400">×{item.remainUseTimes}</span>}
    </div>
  )
}

export default function SoloRoster({ characters, playerGuid }: SoloRosterProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const sorted = useMemo(() => {
    // 玩家置顶，其余按存活在前排序
    const list = [...characters]
    list.sort((a, b) => {
      const pa = a.guid === playerGuid ? -1 : 0
      const pb = b.guid === playerGuid ? -1 : 0
      if (pa !== pb) return pa - pb
      return Number(b.isEliminated) - Number(a.isEliminated) || a.displayName.localeCompare(b.displayName, 'zh')
    })
    return list
  }, [characters, playerGuid])

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto pr-0.5">
      {sorted.map((c) => {
        const isPlayer = c.guid === playerGuid
        const open = expanded === c.guid
        const dead = c.isEliminated || c.hp <= 0
        return (
          <div
            key={c.guid}
            className={`rounded-xl border px-2.5 py-1.5 transition-all ${
              isPlayer
                ? 'border-gold-500/60 bg-gradient-to-b from-gold-300/20 to-gold-500/5'
                : dead
                  ? 'border-ink-400/20 bg-ink-800/5'
                  : 'border-horde-500/25 bg-parchment-200/40'
            } ${dead ? 'opacity-70' : ''}`}
          >
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded(open ? null : c.guid)}>
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  backgroundColor: dead ? '#6b7280' : isPlayer ? '#d4a838' : '#dc2626',
                  color: dead || isPlayer ? '#2a1f14' : '#fff7ed',
                }}
              >
                {[...(c.nickName || c.name || '?')][0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12px] leading-tight ${isPlayer ? 'font-bold text-gold-700' : 'text-ink-700'}`}>
                  {isPlayer ? '★ ' : ''}
                  {c.displayName}
                </span>
                <span className="block text-[9.5px] text-ink-400">
                  Lv.{c.level} · {dead ? '已阵亡' : c.state === 'Actionable' ? '待行动' : c.state}
                </span>
              </span>
              {c.effects.length > 0 && <span className="shrink-0 text-[11px]" title={c.effects.join('、')}>✨</span>}
            </button>

            {/* 数值条 */}
            <div className="mt-1.5 space-y-0.5">
              <div className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-[8.5px] font-bold text-horde-600">HP</span>
                <Bar value={c.hp} max={c.maxHP} color={dead ? '#9ca3af' : '#dc2626'} bg="rgba(220,38,38,0.12)" />
                <span className="w-12 shrink-0 text-right font-mono text-[9px] text-ink-500">
                  {Math.round(c.hp)}/{Math.round(c.maxHP)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-[8.5px] font-bold text-alliance-600">MP</span>
                <Bar value={c.mp} max={c.maxMP} color={c.maxMP > 0 ? '#2563eb' : '#cbd5e1'} bg="rgba(37,99,235,0.12)" />
                <span className="w-12 shrink-0 text-right font-mono text-[9px] text-ink-500">{Math.round(c.mp)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-[8.5px] font-bold text-gold-600">EP</span>
                <Bar value={c.ep} max={c.maxEP} color="#d4a838" bg="rgba(212,168,56,0.15)" />
                <span className="w-12 shrink-0 text-right font-mono text-[9px] text-ink-500">{Math.round(c.ep)}</span>
              </div>
            </div>

            {/* 展开：技能 / 物品 */}
            {open && (
              <div className="mt-2 border-t border-ink-800/10 pt-1.5">
                <div className="mb-1 text-[10px] font-medium text-ink-500">
                  技能（{c.skills.filter((s) => s.isActive).length} 个可用 / 共 {c.skills.length} 个）
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.skills.length === 0 && <span className="text-[10px] text-ink-400">无</span>}
                  {c.skills.map((s) => (
                    <SkillChip key={s.guid} skill={s} />
                  ))}
                </div>
                <div className="mb-1 mt-2 text-[10px] font-medium text-ink-500">
                  物品（{c.items.filter((i) => i.usable).length} 个可用）
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.items.length === 0 && <span className="text-[10px] text-ink-400">无</span>}
                  {c.items.map((i) => (
                    <ItemChip key={i.guid} item={i} />
                  ))}
                </div>
                {c.effects.length > 0 && (
                  <>
                    <div className="mb-1 mt-2 text-[10px] font-medium text-ink-500">状态</div>
                    <div className="flex flex-wrap gap-1">
                      {c.effects.map((e, i) => (
                        <span key={i} className="rounded-md bg-purple-500/10 px-1.5 py-[2px] text-[10px] text-purple-700">
                          {e}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
