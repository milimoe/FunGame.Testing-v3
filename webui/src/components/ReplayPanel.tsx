import { useEffect, useMemo, useState } from 'react'
import { fetchRound, fetchSummary } from '../api'
import type { ActionRecord, CharacterRef, RoundRecord, RoundSummaryDto } from '../types'
import { Badge, CharChip, DescText, ErrorBox, HBar, Section, Spinner } from './ui'
import {
  ACTION_TYPE_ICONS,
  actionTypeName,
  buildCheckpointDescMaps,
  charIndex,
  charName,
  damageTypeName,
  effectTypeName,
  fmt,
  fmtTime,
  keyedToEntries,
  skillTypeName,
} from '../util'

export default function ReplayPanel({ requestedRound, onRoundChange }: { requestedRound?: number; onRoundChange: (round: number) => void }) {
  const [summaries, setSummaries] = useState<RoundSummaryDto[]>([])
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [roundNo, setRoundNo] = useState(1)
  const [record, setRecord] = useState<RoundRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2000)
  // 检查点描述缓存：检查点回合号 -> 描述索引（不再调用 /api/gamedata，改从检查点快照取 desc）
  const [cpDescCache, setCpDescCache] = useState<Map<number, ReturnType<typeof buildCheckpointDescMaps>>>(new Map())

  const totalRounds = summaries.length

  // 加载回合摘要列表
  useEffect(() => {
    fetchSummary()
      .then(list => {
        setSummaries(list)
        if (list.length > 0) {
          const initialRound = requestedRound !== undefined && list.some(s => s.round === requestedRound) ? requestedRound : list[0].round
          setRoundNo(initialRound)
        }
      })
      .catch(e => setSummaryError(e.message))
  }, [requestedRound])

  const changeRound = (round: number) => {
    setRoundNo(round)
    onRoundChange(round)
  }

  // 当前回合之前（含）最近一个检查点回合号，作为描述基准
  const baseCheckpointRound = useMemo(() => {
    let found: number | null = null
    for (const s of summaries) {
      if (!s.hasCheckpoint) continue
      if (s.round > roundNo) break
      found = s.round
    }
    return found
  }, [summaries, roundNo])

  // 按需加载基准检查点，构建 skill/item/effect 描述索引（按检查点回合缓存，跨回合复用）
  useEffect(() => {
    if (baseCheckpointRound === null || cpDescCache.has(baseCheckpointRound)) return
    // 当前回合本身就是检查点：直接复用已加载的 record，避免重复请求
    if (record?.Round === baseCheckpointRound && record.Checkpoint) {
      setCpDescCache(prev =>
        prev.has(baseCheckpointRound) ? prev : new Map(prev).set(baseCheckpointRound, buildCheckpointDescMaps(record.Checkpoint ?? [])),
      )
      return
    }
    let cancelled = false
    fetchRound(baseCheckpointRound)
      .then(r => {
        if (!cancelled) {
          setCpDescCache(prev => new Map(prev).set(baseCheckpointRound, buildCheckpointDescMaps(r.Checkpoint ?? [])))
        }
      })
      .catch(() => {
        /* 检查点加载失败：该段回合无描述展示 */
      })
    return () => {
      cancelled = true
    }
  }, [baseCheckpointRound, cpDescCache, record])

  const { skillDesc, itemDesc } = useMemo(() => {
    if (baseCheckpointRound === null) return { skillDesc: new Map<number, string>(), itemDesc: new Map<number, string>() }
    const maps = cpDescCache.get(baseCheckpointRound)
    return {
      skillDesc: maps?.skillDesc ?? new Map<number, string>(),
      itemDesc: maps?.itemDesc ?? new Map<number, string>(),
    }
  }, [baseCheckpointRound, cpDescCache])

  // 加载单回合
  useEffect(() => {
    if (roundNo < 1) return
    let cancelled = false
    setLoading(true)
    fetchRound(roundNo)
      .then(r => {
        if (!cancelled) {
          setRecord(r)
          setError(null)
        }
      })
      .catch(e => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [roundNo])

  // 自动播放
  useEffect(() => {
    if (!playing) return
    if (roundNo >= totalRounds) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => changeRound(roundNo + 1), speed)
    return () => clearTimeout(timer)
  }, [playing, roundNo, speed, totalRounds])

  const summary = summaries.find(s => s.round === roundNo)

  if (summaryError) return <ErrorBox message={summaryError} />
  if (totalRounds === 0 && !summaryError) return <Spinner />

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-100 bg-white p-3 shadow-sm">
        <button
          onClick={() => changeRound(1)}
          disabled={roundNo <= 1}
          className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
        >
          ⏮ 最早
        </button>
        <button
          onClick={() => changeRound(Math.max(1, roundNo - 1))}
          disabled={roundNo <= 1}
          className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
        >
          ◀ 上一回合
        </button>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={totalRounds}
            value={roundNo}
            onChange={e => changeRound(Math.min(totalRounds, Math.max(1, Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-center text-sm tabular-nums text-slate-700 outline-none focus:border-rose-400"
          />
          <span className="text-sm text-slate-400">/ {fmt(totalRounds)}</span>
        </div>
        <button
          onClick={() => changeRound(Math.min(totalRounds, roundNo + 1))}
          disabled={roundNo >= totalRounds}
          className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
        >
          下一回合 ▶
        </button>
        <button
          onClick={() => changeRound(totalRounds)}
          disabled={roundNo >= totalRounds}
          className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
        >
          最后 ⏭
        </button>
        <div className="h-5 w-px bg-rose-200" />
        <button
          onClick={() => setPlaying(p => !p)}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            playing ? 'bg-red-100 text-red-600 ring-1 ring-red-400/40' : 'bg-rose-500 text-white shadow-sm hover:bg-rose-400'
          }`}
        >
          {playing ? '⏸ 暂停' : '▶ 自动播放'}
        </button>
        <select
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none focus:border-rose-400"
        >
          <option value={3000}>3 秒/回合</option>
          <option value={2000}>2 秒/回合</option>
          <option value={1000}>1 秒/回合</option>
        </select>
      </div>

      {/* 回合内容 */}
      {loading ? (
        <Spinner />
      ) : error || !record ? (
        <ErrorBox message={error ?? '无数据'} />
      ) : (
        <>
          <RoundHeader record={record} summary={summary} />
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Section title="行动记录" subtitle={`本回合 ${record.Actions?.length ?? 0} 次操作`}>
                {(record.Actions ?? []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">本回合没有行动记录</p>
                ) : (
                  <div className="space-y-4">
                    {(record.Actions ?? []).map(action => (
                      <ActionItem
                        key={action.ActionIndex}
                        action={action}
                        fallbackChars={record.AllCharacters}
                        skillDesc={skillDesc}
                        itemDesc={itemDesc}
                      />
                    ))}
                  </div>
                )}
              </Section>
              <KillSection record={record} skillDesc={skillDesc} />
              <RoundDamageSection record={record} />
            </div>
            <div className="space-y-5">
              <EffectsSection record={record} skillDesc={skillDesc} />
              <InfoSection record={record} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ===== 回合概览 =====
function RoundHeader({ record, summary }: { record: RoundRecord; summary?: RoundSummaryDto }) {
  return (
    <div className="rounded-xl border border-rose-100 bg-gradient-to-r from-rose-50 to-pink-100/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="text-2xl font-black text-rose-500">第 {record.Round} 回合</div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          行动者：
          {record.Actor ? <CharChip char={record.Actor} size="lg" /> : <span className="text-slate-400">无</span>}
        </div>
        <div className="text-sm text-slate-500">
          游戏时间 <span className="tabular-nums text-slate-700">{fmtTime(record.TotalTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          {record.HasKill && <Badge tone="red">💀 本回合产生击杀</Badge>}
          {record.Checkpoint && record.Checkpoint.length > 0 && <Badge tone="cyan">📋 状态快照</Badge>}
          {summary && summary.actionCount > 0 && <Badge tone="indigo">{summary.actionCount} 次行动</Badge>}
          {summary && summary.effectCount > 0 && <Badge tone="green">{summary.effectCount} 条特效记录</Badge>}
        </div>
      </div>
    </div>
  )
}

// ===== 单条行动记录 =====
function ActionItem({ action, fallbackChars, skillDesc, itemDesc }: {
  action: ActionRecord
  fallbackChars: CharacterRef[]
  skillDesc: Map<number, string>
  itemDesc: Map<number, string>
}) {
  const chars = useMemo(() => charIndex(action.AllCharacters ?? fallbackChars), [action.AllCharacters, fallbackChars])
  const name = action.Skill?.Name || action.Item?.Name || actionTypeName(action.ActionType)
  const icon = ACTION_TYPE_ICONS[action.ActionType] ?? '·'
  const damages = keyedToEntries(action.Damages)
  const heals = keyedToEntries(action.Heals)
  const hasEffect = keyedToEntries(action.ApplyEffects).length > 0
  const desc = action.Skill
    ? skillDesc.get(action.Skill.Id)
    : action.Item
      ? itemDesc.get(action.Item.Id)
      : undefined

  return (
    <div className="flex gap-3">
      {/* 时间线标记 */}
      <div className="flex flex-col items-center">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ring-1 ${
            action.IsSuccess === false
              ? 'bg-red-50 ring-red-200'
              : damages.length > 0
                ? 'bg-red-50 ring-red-200'
                : heals.length > 0
                  ? 'bg-emerald-50 ring-emerald-200'
                  : 'bg-rose-50 ring-rose-200'
          }`}
        >
          {icon}
        </span>
        <span className="mt-1 w-px flex-1 bg-rose-100" />
      </div>
      {/* 内容 */}
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">#{action.ActionIndex}</span>
          <CharChip char={action.Actor} size="sm" />
          <span className="text-xs text-slate-400">{actionTypeName(action.ActionType)}</span>
          <span className="font-semibold text-slate-800">{name}</span>
          {action.Skill?.Name && <Badge tone="indigo">{skillTypeName(action.Skill.SkillType)}</Badge>}
          {action.IsSuccess === false && <Badge tone="red">失败</Badge>}
        </div>

        {/* 技能 / 物品描述 */}
        {desc ? <DescText text={desc} /> : null}

        {/* 消耗信息 */}
        <CostLine action={action} />

        {/* 目标 */}
        {action.Targets && action.Targets.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            目标：
            {action.Targets.map(t => (
              <CharChip key={t.Guid} char={t} size="sm" />
            ))}
          </div>
        )}

        {/* 伤害 / 治疗 / 标记 */}
        <div className="mt-1.5 space-y-0.5">
          {damages.map(([guid, dmg]) => {
            const target = chars.get(guid)
            const crit = action.IsCritical?.[guid]
            const evaded = action.IsEvaded?.[guid]
            const immune = action.IsImmune?.[guid]
            if (evaded)
              return (
                <div key={guid} className="text-xs text-slate-500">
                  {charName(target)} <span className="text-slate-400">闪避了攻击</span> 🌀
                </div>
              )
            if (immune)
              return (
                <div key={guid} className="text-xs text-slate-500">
                  {charName(target)} <span className="text-slate-400">免疫了伤害</span> 🛡️
                </div>
              )
            // 按伤害类型拆行显示（同一角色受到多类型伤害时各占一行）；旧档无 DamageDetails 时回退为单行总计
            const typeEntries = Object.entries(action.DamageDetails?.[guid] ?? {})
              .map(([t, v]) => ({ type: Number(t), value: v }))
              .sort((a, b) => b.value - a.value)
            const lines = typeEntries.length > 0 ? typeEntries : [{ type: -1, value: dmg }]
            return lines.map((line, i) => (
              <div key={`${guid}-${line.type}`} className="text-xs">
                <span className="text-slate-500">{charName(target)}</span>{' '}
                <span className="font-bold text-red-500">-{fmt(line.value, 1)}</span>
                {line.type >= 0 && (
                  <span className="ml-1">
                    <Badge tone={line.type === 1 ? 'indigo' : line.type === 2 ? 'cyan' : 'amber'}>{damageTypeName(line.type)}</Badge>
                  </span>
                )}
                {crit && i === 0 && <span className="ml-1 text-amber-600">⚡ 暴击</span>}
              </div>
            ))
          })}
          {heals.map(([guid, heal]) => (
            <div key={guid} className="text-xs">
              <span className="text-slate-500">{charName(chars.get(guid))}</span>{' '}
              <span className="font-bold text-emerald-600">+{fmt(heal, 1)}</span>
            </div>
          ))}
        </div>

        {/* 施加的特效 */}
        {hasEffect && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {keyedToEntries(action.ApplyEffects).map(([guid, types]) => (
              <span key={guid} className="text-xs text-slate-400">
                {charName(chars.get(guid))}：
                {types.map(t => (
                  <Badge key={t} tone="green">
                    {effectTypeName(t)}
                  </Badge>
                ))}
              </span>
            ))}
          </div>
        )}

        {/* 失败原因 */}
        {action.IsSuccess === false && action.FailReason && (
          <p className="mt-1 text-xs text-red-500">原因：{action.FailReason}</p>
        )}

        {/* 消息 */}
        {action.Messages && action.Messages.length > 0 && (
          <div className="mt-1.5 space-y-0.5 border-l-2 border-rose-200 pl-2.5">
            {action.Messages.map((m, i) => (
              <p key={i} className="text-xs text-slate-500">
                {m}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 消耗行 =====
function CostLine({ action }: { action: ActionRecord }) {
  const parts: string[] = []
  if (action.MPCost > 0) parts.push(`魔法 -${fmt(action.MPCost, 1)}`)
  if (action.EPCost > 0) parts.push(`能量 -${fmt(action.EPCost, 1)}`)
  if (action.SkillCD > 0) parts.push(`CD ${fmt(action.SkillCD, 1)}s`)
  if (action.DecisionPointsCost > 0) parts.push(`决策点 -${fmt(action.DecisionPointsCost, 1)}`)
  if (action.CastTime > 0) parts.push(`吟唱 ${fmt(action.CastTime, 1)}s`)
  if (action.HardnessTime > 0) parts.push(`硬直 ${fmt(action.HardnessTime, 1)}s`)
  if (parts.length === 0) return null
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
      {parts.map((p, i) => (
        <span key={i} className="tabular-nums">
          {p}
        </span>
      ))}
    </div>
  )
}

// ===== 击杀与消息 =====
function KillSection({ record, skillDesc }: { record: RoundRecord; skillDesc: Map<number, string> }) {
  const kills = record.ActorContinuousKilling ?? []
  const deaths = record.DeathContinuousKilling ?? []
  const others = record.OtherMessages ?? []
  if (!record.HasKill && kills.length === 0 && deaths.length === 0 && others.length === 0) return null
  return (
    <Section title="击杀与消息">
      <div className="space-y-2">
        {record.HasKill && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
            💀 本回合产生击杀！
          </div>
        )}
        {kills.map((k, i) => (
          <p key={`k${i}`} className="text-sm text-amber-600">
            🔪 {k}
          </p>
        ))}
        {deaths.map((d, i) => (
          <p key={`d${i}`} className="text-sm text-slate-500">
            ☠️ {d}
          </p>
        ))}
        {others.map((o, i) => (
          <p key={`o${i}`} className="text-sm text-slate-400">
            {o}
          </p>
        ))}
        {record.RoundRewards && record.RoundRewards.length > 0 && (
          <div className="rounded-lg bg-emerald-50/80 p-2.5">
            <p className="text-sm font-semibold text-emerald-600">🎁 回合奖励</p>
            {record.RoundRewards.map((s, i) => (
              <div key={`rw${i}`} className="mt-1">
                <p className="text-sm text-emerald-700">
                  {s.Name} <span className="text-xs text-emerald-500">(#{s.Id})</span>
                </p>
                {skillDesc.get(s.Id) ? <DescText text={skillDesc.get(s.Id)!} /> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

// ===== 本回合伤害 / 治疗分布 =====
function RoundDamageSection({ record }: { record: RoundRecord }) {
  const chars = charIndex(record.AllCharacters)
  const damages = keyedToEntries(record.Damages).sort((a, b) => b[1] - a[1])
  const heals = keyedToEntries(record.Heals).sort((a, b) => b[1] - a[1])
  if (damages.length === 0 && heals.length === 0) return null
  const maxD = Math.max(...damages.map(d => d[1]), 1)
  const maxH = Math.max(...heals.map(h => h[1]), 1)
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {damages.length > 0 && (
        <Section title="本回合伤害" subtitle="按目标分布">
          <div className="space-y-2">
            {damages.map(([guid, v]) => (
              <HBar key={guid} label={charName(chars.get(guid))} value={v} max={maxD} labelWidth="w-16" format={n => fmt(n, 1)} />
            ))}
          </div>
        </Section>
      )}
      {heals.length > 0 && (
        <Section title="本回合治疗" subtitle="按目标分布">
          <div className="space-y-2">
            {heals.map(([guid, v]) => (
              <HBar key={guid} label={charName(chars.get(guid))} value={v} max={maxH} labelWidth="w-16" format={n => fmt(n, 1)} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ===== 特效记录 =====
function EffectsSection({ record, skillDesc }: { record: RoundRecord; skillDesc: Map<number, string> }) {
  const chars = charIndex(record.AllCharacters)
  const effects = keyedToEntries(record.Effects)
  const applyEffects = keyedToEntries(record.ApplyEffects)
  if (effects.length === 0 && applyEffects.length === 0) {
    return (
      <Section title="特效记录">
        <p className="py-2 text-center text-sm text-slate-500">本回合无特效触发</p>
      </Section>
    )
  }
  return (
    <Section title="特效记录" subtitle={`${effects.length + applyEffects.length} 条记录`}>
      <div className="space-y-3">
        {effects.map(([guid, skill]) => (
          <div key={`e${guid}-${skill.Guid}`} className="rounded-lg bg-rose-50/80 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{charName(chars.get(guid))}</span>
              <Badge tone="indigo">{skillTypeName(skill.SkillType)}</Badge>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {skill.Name} <span className="text-xs font-normal text-slate-400">(#{skill.Id})</span>
            </p>
            {skillDesc.get(skill.Id) ? <DescText text={skillDesc.get(skill.Id)!} /> : null}
          </div>
        ))}
        {applyEffects.map(([guid, types]) => (
          <div key={`a${guid}`} className="rounded-lg bg-rose-50/80 p-2.5">
            <p className="text-xs text-slate-500">{charName(chars.get(guid))} 受到：</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {types.map(t => (
                <Badge key={t} tone="green">
                  {effectTypeName(t)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ===== 回合杂项信息 =====
function InfoSection({ record }: { record: RoundRecord }) {
  const respawns = record.Respawns ?? []
  const countdowns = keyedToEntries(record.RespawnCountdowns ?? {})
  const assists = record.Assists ?? []
  return (
    <Section title="回合信息">
      <dl className="space-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-slate-400">吟唱时间</dt>
          <dd className="tabular-nums text-slate-600">{fmt(record.CastTime, 2)}s</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">硬直时间</dt>
          <dd className="tabular-nums text-slate-600">{fmt(record.HardnessTime, 2)}s</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">助攻角色</dt>
          <dd className="max-w-[60%] text-right">
            {assists.length > 0 ? assists.map(a => charName(a)).join('、') : '—'}
          </dd>
        </div>
        {respawns.length > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-400">复活角色</dt>
            <dd className="max-w-[60%] text-right text-emerald-600">{respawns.map(a => charName(a)).join('、')}</dd>
          </div>
        )}
        {countdowns.map(([guid, secs]) => (
          <div key={guid} className="flex justify-between">
            <dt className="text-slate-400">{charName(charIndex(record.AllCharacters).get(guid))} 复活倒计时</dt>
            <dd className="tabular-nums text-slate-600">{fmt(secs, 1)}s</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
