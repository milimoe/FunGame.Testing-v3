import { useEffect, useMemo, useState } from 'react'
import { fetchRound, fetchSummary } from '../api'
import type { CharacterStateSnapshot, RoundSummaryDto } from '../types'
import { Badge, CharChip, ErrorBox, Section, Spinner, ValueBar } from './ui'
import { charName, effectTypeName, equipSlotName, fmt, fmtTime } from '../util'

export default function SnapshotPanel() {
  const [summaries, setSummaries] = useState<RoundSummaryDto[]>([])
  const [sumError, setSumError] = useState<string | null>(null)
  const [roundNo, setRoundNo] = useState<number | null>(null)
  const [record, setRecord] = useState<{ round: number; checkpoint: CharacterStateSnapshot[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null)

  // 加载摘要，找出含检查点快照的回合
  useEffect(() => {
    fetchSummary()
      .then(list => {
        setSummaries(list)
        const first = list.find(s => s.hasCheckpoint)
        if (first) setRoundNo(first.round)
      })
      .catch(e => setSumError(e.message))
  }, [])

  const checkpointRounds = useMemo(() => summaries.filter(s => s.hasCheckpoint), [summaries])

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
            setRoundNo(Number(e.target.value))
            setSelectedGuid(null)
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
          onChange={e => setSelectedGuid(e.target.value || null)}
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
        <SnapshotDetail snapshot={selected} onBack={() => setSelectedGuid(null)} />
      ) : (
        /* 全部角色 HP 总览网格 */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map(s => {
            const c = s.Character
            const alive = s.HP > 0
            return (
              <button
                key={c?.Guid}
                onClick={() => setSelectedGuid(c?.Guid ?? null)}
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
                  {s.EP > 0 && <MiniBar label="EP" value={s.EP} max={Math.max(s.EP, 1)} color="#fbbf24" />}
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
function SnapshotDetail({ snapshot, onBack }: { snapshot: CharacterStateSnapshot; onBack: () => void }) {
  const c = snapshot.Character
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
        <Section title="状态数值">
          <div className="space-y-3">
            <ValueBar label="生命 HP" value={snapshot.HP} max={snapshot.MaxHP} color="#f87171" digits={1} />
            <ValueBar label="魔法 MP" value={snapshot.MP} max={snapshot.MaxMP} color="#60a5fa" digits={1} />
            {snapshot.EP > 0 && <ValueBar label="能量 EP" value={snapshot.EP} max={Math.max(snapshot.EP, 1)} color="#fbbf24" digits={1} />}
            <div className="grid grid-cols-2 gap-2 border-t border-rose-100 pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">生命回复 HR</span>
                <span className="tabular-nums text-slate-600">{fmt(snapshot.HR, 1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">魔法回复 MR</span>
                <span className="tabular-nums text-slate-600">{fmt(snapshot.MR, 1)}</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="装备">
          {snapshot.EquipmentsDetail.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">未装备任何物品</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.EquipmentsDetail.map((eq, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg bg-rose-50/80 px-3 py-2 text-sm">
                  <span className="text-slate-400">{equipSlotName(eq.Slot)}</span>
                  <span className="text-slate-700">
                    {eq.ItemName} <span className="text-xs text-slate-400">(#{eq.ItemId})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="技能" subtitle={`${snapshot.Skills.length} 个技能`}>
          {snapshot.Skills.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">无技能</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.Skills.map(s => (
                <li key={s.SkillId} className="flex items-center justify-between rounded-lg bg-rose-50/80 px-3 py-2 text-sm">
                  <span className="text-slate-700">
                    {s.SkillName} <span className="text-xs text-slate-400">(#{s.SkillId})</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone="indigo">Lv.{s.Level}</Badge>
                    {s.CurrentCD > 0 && <Badge tone="red">CD {fmt(s.CurrentCD, 1)}s</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="物品栏" subtitle={`${snapshot.Items.length} 件物品`}>
          {snapshot.Items.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">背包为空</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {snapshot.Items.map(it => (
                <li key={it.ItemId} className="rounded-lg bg-rose-50/80 px-3 py-1.5 text-sm text-slate-700">
                  {it.ItemName} <span className="text-xs text-slate-400">(#{it.ItemId})</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="状态栏特效" subtitle={`${snapshot.Effects.length} 个特效`}>
          {snapshot.Effects.length === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500">无特效</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.Effects.map((ef, i) => (
                <li key={i} className="rounded-lg bg-rose-50/80 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">
                      {ef.EffectName} <span className="text-xs text-slate-400">(#{ef.EffectId})</span>
                    </span>
                    <Badge tone="cyan">{effectTypeName(ef.EffectType)}</Badge>
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
                </li>
              ))}
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
