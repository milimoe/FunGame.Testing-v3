import { useEffect, useMemo, useState } from 'react'
import { fetchRound, fetchSummary } from '../api'
import type { CharacterStateSnapshot, RoundSummaryDto } from '../types'
import { Badge, CharChip, DescText, ErrorBox, Section, Spinner, ValueBar } from './ui'
import { charName, effectTypeName, equipSlotName, fmt, fmtTime } from '../util'

export default function SnapshotPanel({ requestedRound, requestedCharacterId, onRoundChange, onCharacterChange }: {
  requestedRound?: number
  requestedCharacterId?: string
  onRoundChange: (round: number) => void
  onCharacterChange: (characterId: string | null, round?: number) => void
}) {
  const [summaries, setSummaries] = useState<RoundSummaryDto[]>([])
  const [sumError, setSumError] = useState<string | null>(null)
  const [roundNo, setRoundNo] = useState<number | null>(null)
  const [record, setRecord] = useState<{ round: number; checkpoint: CharacterStateSnapshot[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null)

  useEffect(() => {
    setSelectedGuid(requestedCharacterId ?? null)
  }, [requestedCharacterId])

  // 加载摘要，找出含检查点快照的回合
  useEffect(() => {
    fetchSummary()
      .then(list => {
        setSummaries(list)
      })
      .catch(e => setSumError(e.message))
  }, [])

  const checkpointRounds = useMemo(() => summaries.filter(s => s.hasCheckpoint), [summaries])

  // URL 回合没有检查点时，使用该回合之前最近的检查点。
  useEffect(() => {
    if (checkpointRounds.length === 0) return
    const candidates = requestedRound === undefined
      ? checkpointRounds
      : checkpointRounds.filter(s => s.round <= requestedRound)
    const target = candidates[candidates.length - 1] ?? checkpointRounds[0]
    setRoundNo(current => (current === target.round ? current : target.round))
  }, [checkpointRounds, requestedRound])

  // 加载选中回合的快照
  useEffect(() => {
    if (roundNo === null) return
    let cancelled = false
    setLoading(true)
    fetchRound(roundNo)
      .then(r => {
        if (!cancelled) {
          setRecord({ round: r.Round, checkpoint: r.Checkpoint ?? [] })
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

  const snapshots = record?.checkpoint ?? []
  const selected = snapshots.find(s => s.Character?.Guid === selectedGuid) ?? null

  if (sumError) return <ErrorBox message={sumError} />
  if (summaries.length === 0) return <Spinner />

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* 选择器 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-100 bg-white p-3 shadow-sm">
        <span className="text-sm text-slate-500">检查点回合（共 {checkpointRounds.length} 个）：</span>
        <select
          value={roundNo ?? ''}
          onChange={e => {
            const nextRound = Number(e.target.value)
            setRoundNo(nextRound)
            onRoundChange(nextRound)
          }}
          className="max-w-64 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-rose-400"
        >
          {checkpointRounds.map(s => (
            <option key={s.round} value={s.round}>
              第 {s.round} 回合（时间 {fmtTime(s.totalTime)}）
            </option>
          ))}
        </select>
        <div className="h-5 w-px bg-rose-200" />
        <span className="text-sm text-slate-500">角色：</span>
        <select
          value={selectedGuid ?? ''}
          onChange={e => {
            const nextCharacterId = e.target.value || null
            setSelectedGuid(nextCharacterId)
            onCharacterChange(nextCharacterId, roundNo ?? undefined)
          }}
          className="max-w-48 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-rose-400"
        >
          <option value="">全部角色</option>
          {snapshots.map(s => (
            <option key={s.Character?.Guid} value={s.Character?.Guid}>
              {charName(s.Character)}
            </option>
          ))}
        </select>
        {record && (
          <span className="ml-auto text-xs text-slate-400">
            第 {record.round} 回合 · {snapshots.length} 名角色 · 游戏时间 {fmtTime(lastTotalTime(summaries, record.round))}
          </span>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox message={error} />
      ) : snapshots.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">该回合没有状态快照</div>
      ) : selected ? (
        <SnapshotDetail
          snapshot={selected}
          allSnapshots={snapshots}
          onBack={() => {
            setSelectedGuid(null)
            onCharacterChange(null, roundNo ?? undefined)
          }}
        />
      ) : (
        /* 全部角色 HP 总览网格 */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map(s => {
            const c = s.Character
            const alive = s.HP > 0
            return (
              <button
                key={c?.Guid}
                onClick={() => {
                  const nextCharacterId = c?.Guid ?? null
                  setSelectedGuid(nextCharacterId)
                  onCharacterChange(nextCharacterId, roundNo ?? undefined)
                }}
                className="group rounded-xl border border-rose-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-rose-400/60"
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <CharChip char={c} />
                  {!alive && <Badge tone="red">已阵亡</Badge>}
                  {s.Effects.length > 0 && <Badge tone="green">{s.Effects.length} 特效</Badge>}
                </div>
                <div className="space-y-1.5">
                  <MiniBar label="HP" value={s.HP} max={s.MaxHP} color={alive ? '#f87171' : '#cbd5e1'} />
                  <MiniBar label="MP" value={s.MP} max={s.MaxMP} color="#fb7185" />
                  <MiniBar label="EP" value={s.EP} max={200} color="#fbbf24" />
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  装备 {s.EquipmentsDetail.length} 件 · 技能 {s.Skills.length} 个
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ===== 迷你数值条（快照卡片用）=====
function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-xs text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-rose-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500">
        {fmt(value, 0)} / {fmt(max, 0)}
      </span>
    </div>
  )
}

// ===== 单个角色详情 =====
function SnapshotDetail({ snapshot, allSnapshots, onBack }: {
  snapshot: CharacterStateSnapshot
  allSnapshots: CharacterStateSnapshot[]
  onBack: () => void
}) {
  const c = snapshot.Character
  // 角色 Guid -> 名称 索引（用于解析特效来源角色）
  const charNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of allSnapshots) {
      const cc = s.Character
      if (cc?.Guid && !map.has(cc.Guid)) map.set(cc.Guid, charName(cc))
    }
    return map
  }, [allSnapshots])
  const sourceName = (guid?: string): string | null => {
    if (!guid || guid === '' || guid === c?.Guid) return null
    return charNames.get(guid) ?? ''
  }
  const attributeEntries = useMemo(() => Object.entries(snapshot.Attributes ?? {}), [snapshot.Attributes])
  // 单行展示的关键属性
  const singleKeys = useMemo(
    () => new Set(['生命值', '魔法值', '攻击力', '物理护甲', '魔法抗性', '行动速度', '核心属性', '力量', '敏捷', '智力']),
    [],
  )
  const singleEntries = attributeEntries.filter(([k]) => singleKeys.has(k))
  const pairedEntries = attributeEntries.filter(([k]) => !singleKeys.has(k))
  const pairedRows = useMemo(() => {
    const rows: Array<Array<[string, string]>> = []
    for (let i = 0; i < pairedEntries.length; i += 2) {
      rows.push(pairedEntries.slice(i, i + 2))
    }
    return rows
  }, [pairedEntries])
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-100 bg-gradient-to-r from-rose-50 to-pink-100/70 p-4 shadow-sm">
        <CharChip char={c} size="lg" />
        {snapshot.HP > 0 ? <Badge tone="green">存活</Badge> : <Badge tone="red">已阵亡</Badge>}
        <button
          onClick={onBack}
          className="ml-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-rose-400 hover:text-rose-600"
        >
          ← 返回全部角色
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="角色状态和能力值">
            <div className="space-y-3">
              <ValueBar label="生命 HP" value={snapshot.HP} max={snapshot.MaxHP} color="#f87171" digits={2} />
              <ValueBar label="魔法 MP" value={snapshot.MP} max={snapshot.MaxMP} color="#60a5fa" digits={2} />
              <ValueBar label="能量 EP" value={snapshot.EP} max={200} color="#fbbf24" digits={2} />
            </div>
            <div className="border-t border-rose-100" style={{ marginTop: '10px', marginBottom: '5px'}} />
            <div>
              {attributeEntries.length === 0 ? (
                <p className="py-2 text-center text-sm text-slate-500">无属性数据</p>
              ) : (
                <div className="space-y-1">
                  {/* 关键属性：一行一个 */}
                  {singleEntries.map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-3 rounded-lg bg-rose-50/70 px-3 py-1.5 text-sm">
                      <span className="shrink-0 text-slate-400">{key}</span>
                      <span className="break-all text-right tabular-nums text-slate-700">{value}</span>
                    </div>
                  ))}
                  {/* 其余属性：两行一个 */}
                  {pairedRows.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 border-t border-rose-100 pt-3 text-xs">
                      {pairedRows.map((row, ri) => (
                        <div key={ri} className="contents">
                          {row.map(([key, value]) => (
                            key === '能量值' ? null : (
                            <div key={key} className="flex justify-between">
                              <span className="text-slate-400">{key}</span>
                              <span className="tabular-nums text-slate-600">{value}</span>
                            </div>
                            )
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
        </Section>

        <Section title="装备">
          {snapshot.EquipmentsDetail.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">未装备任何物品</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.EquipmentsDetail.map((eq, i) => {
                const desc = eq.Description
                return (
                  <li key={i} className="rounded-lg bg-rose-50/80 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">{equipSlotName(eq.Slot)}</span>
                      <span className="text-slate-700">
                        {eq.ItemName} <span className="text-xs text-slate-400">(#{eq.ItemId})</span>
                      </span>
                    </div>
                    {desc ? <DescText text={desc} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="技能" subtitle={`${snapshot.Skills.length} 个技能`}>
          {snapshot.Skills.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">无技能</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.Skills.map(s => {
                const desc = s.Description
                return (
                  <li key={s.SkillId} className="rounded-lg bg-rose-50/80 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-700">
                        {s.SkillName} <span className="text-xs text-slate-400">(#{s.SkillId})</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone="indigo">Lv.{s.Level}</Badge>
                        {s.CurrentCD > 0 && <Badge tone="red">CD {fmt(s.CurrentCD, 1)}s</Badge>}
                      </span>
                    </div>
                    {desc ? <DescText text={desc} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="物品栏" subtitle={`${snapshot.Items.length} 件物品`}>
          {snapshot.Items.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">背包为空</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.Items.map(it => {
                const desc = it.Description
                return (
                  <li key={it.ItemId} className="rounded-lg bg-rose-50/80 px-3 py-2 text-sm">
                    <span className="text-slate-700">
                      {it.ItemName} <span className="text-xs text-slate-400">(#{it.ItemId})</span>
                    </span>
                    {desc ? <DescText text={desc} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="状态栏特效" subtitle={`${snapshot.Effects.length} 个特效`}>
          {snapshot.Effects.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">无特效</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.Effects.map((ef, i) => {
                const src = sourceName(ef.SourceGuid)
                return (
                  <li key={i} className="rounded-lg bg-rose-50/80 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">
                        {ef.EffectName} <span className="text-xs text-slate-400">(#{ef.EffectId})</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        {src && (
                          <span className="text-xs text-amber-600" title={`由 ${src} 施加`}>
                            来源：{src}
                          </span>
                        )}
                        <Badge tone="cyan">{effectTypeName(ef.EffectType)}</Badge>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {ef.RemainDuration <= 0 && ef.RemainDurationTurn <= 0 ? (
                        <span className="text-slate-500">被动效果</span>
                      ) : (
                        <>
                          剩余 <span className="tabular-nums text-slate-600">{fmt(ef.RemainDuration, 1)}s</span>
                          {ef.RemainDurationTurn > 0 && (
                            <>
                              {' '}
                              · <span className="tabular-nums text-slate-600">{ef.RemainDurationTurn}</span> 回合
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {ef.Description ? <DescText text={ef.Description} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

function lastTotalTime(summaries: RoundSummaryDto[], round: number): number {
  return summaries.find(s => s.round === round)?.totalTime ?? 0
}
