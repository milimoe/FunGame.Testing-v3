import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useServer } from '../store'
import type { GameMetaDto, GameRecordRef, GameSummaryDto, RoundRecord } from '../types'
import JsonView from './JsonView'

export default function ReplayPanel() {
  const { baseUrl, token } = useServer()
  const [records, setRecords] = useState<GameRecordRef[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [meta, setMeta] = useState<GameMetaDto | null>(null)
  const [summaries, setSummaries] = useState<GameSummaryDto[]>([])
  const [currentRound, setCurrentRound] = useState<RoundRecord | null>(null)
  const [roundNo, setRoundNo] = useState(1)
  const [stats, setStats] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadList = useCallback(async () => {
    setError(null)
    setLoading(true)
    const result = await api.get<{ data: { items: GameRecordRef[] } }>(baseUrl, '/api/gamerecords?page=1&pageSize=20', token)
    setLoading(false)
    if (result.ok && result.body?.data?.items) {
      setRecords(result.body.data.items)
      if (result.body.data.items.length > 0 && !selectedId) {
        selectGame(result.body.data.items[0].id)
      }
    } else {
      setError(result.error ?? '拉取对局记录失败（可能需要 logs:read 权限）')
    }
  }, [baseUrl, token, selectedId])

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectGame = async (id: string) => {
    setSelectedId(id)
    setError(null)
    setMeta(null)
    setSummaries([])
    setCurrentRound(null)
    setStats(null)

    const [metaRes, sumRes, statRes] = await Promise.all([
      api.get<{ data: GameMetaDto }>(baseUrl, `/api/games/${id}/meta`, token),
      api.get<{ data: GameSummaryDto[] }>(baseUrl, `/api/games/${id}/rounds/summary`, token),
      api.get(baseUrl, `/api/games/${id}/statistics`, token),
    ])
    if (metaRes.ok && metaRes.body?.data) setMeta(metaRes.body.data)
    if (sumRes.ok && sumRes.body?.data) {
      setSummaries(sumRes.body.data)
      const first = sumRes.body.data[0]
      if (first) {
        setRoundNo(first.round)
        loadRound(id, first.round)
      }
    }
    if (statRes.ok) setStats(statRes.body)
    if (!metaRes.ok) setError(metaRes.error ?? '加载回放失败')
  }

  const loadRound = async (id: string, n: number) => {
    const result = await api.get<RoundRecord>(baseUrl, `/api/games/${id}/rounds/${n}`, token)
    if (result.ok && result.body) setCurrentRound(result.body)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      {/* 对局列表 */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <div className="panel-dark gold-frame rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gold-600">对局记录</span>
            <button onClick={loadList} className="rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-400/15 hover:text-ink-700">
              刷新
            </button>
          </div>
          {error && <div className="mb-2 rounded-lg border border-red-600/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-700">{error}</div>}
          {loading && <div className="text-[12px] text-ink-500">加载中…</div>}
          <div className="space-y-1.5">
            {records.map((r) => (
              <button
                key={r.id}
                onClick={() => selectGame(r.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                  selectedId === r.id ? 'border-gold-500/60 bg-gold-500/10' : 'border-ink-400/20 bg-parchment-200/40 hover:bg-parchment-300/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] font-medium text-ink-700">{r.id.slice(0, 8)}…</span>
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">{r.mode}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
                  <span>{r.totalRounds} 回合</span>
                  <span className={r.winner ? 'text-gold-600 font-medium' : ''}>{r.winner || '进行中'}</span>
                </div>
              </button>
            ))}
            {!loading && records.length === 0 && <div className="py-6 text-center text-[12px] text-ink-400">暂无对局记录（可在战斗面板跑一局）</div>}
          </div>
        </div>
      </div>

      {/* 回放详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-3">
        {meta && (
          <div className="panel-dark gold-frame rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink-800">{meta.mode}</span>
              <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-700">{meta.modeType}</span>
              <span className="text-[11px] text-ink-500">{meta.roundCount} 回合 · {((meta.totalTime ?? 0) / 1000).toFixed(1)}s</span>
              <span className="ml-auto text-[11px] font-medium text-gold-600">胜者：{meta.winner || '—'}</span>
            </div>
            {meta.characters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {meta.characters.map((c) => (
                  <span key={c.guid} className="rounded-lg border border-ink-400/20 bg-parchment-200/50 px-2 py-1 text-[11px] text-ink-700">
                    {c.nickName || c.name} <span className="font-medium text-gold-600">Lv.{c.level}</span>
                  </span>
                ))}
              </div>
            )}
            {meta.teams.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {meta.teams.map((t) => (
                  <span
                    key={t.name}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${t.isWinner ? 'border-gold-500/60 text-gold-600' : 'border-ink-400/30 text-ink-600'}`}
                  >
                    {t.name} {t.score}分{t.isWinner ? ' ★' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {summaries.length > 0 && (
          <div className="panel-dark gold-frame rounded-2xl p-3">
            <div className="mb-2 text-[13px] font-semibold text-gold-600">回合时间轴</div>
            <div className="flex flex-wrap gap-1.5">
              {summaries.map((s) => (
                <button
                  key={s.round}
                  onClick={() => {
                    setRoundNo(s.round)
                    if (selectedId) loadRound(selectedId, s.round)
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    roundNo === s.round ? 'bg-gold-500/20 text-gold-600 ring-1 ring-gold-500/50' : 'bg-parchment-200/60 text-ink-600 hover:bg-parchment-300/70'
                  }`}
                  title={`${s.actorName} · 伤害 ${s.damageTotal} · 治疗 ${s.healTotal}`}
                >
                  R{s.round}
                  {s.hasKill && <span className="ml-0.5 text-red-600">☠</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentRound ? (
          <div className="panel-dark gold-frame rounded-2xl p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gold-600">第 {currentRound.Round} 回合</span>
              <span className="text-[11px] text-ink-500">
                {currentRound.Actor?.NickName ?? currentRound.Actor?.Name ?? ''} 行动
                {Object.values(currentRound.Damages ?? {}).reduce((a, b) => a + b, 0) > 0 &&
                  ` · 伤害 ${Object.values(currentRound.Damages ?? {}).reduce((a, b) => a + b, 0).toFixed(0)}`}
                {currentRound.HasKill && ' · 击杀'}
              </span>
            </div>
            <JsonView value={currentRound} maxHeight="30rem" />
          </div>
        ) : (
          selectedId && <div className="py-8 text-center text-[12px] text-ink-400">该对局可能仍在进行中或没有回合记录</div>
        )}

        {stats !== null && stats !== undefined && (
          <details className="panel-dark gold-frame rounded-2xl p-3">
            <summary className="cursor-pointer text-[12px] text-ink-500">最终统计（statistics）</summary>
            <div className="mt-2">
              <JsonView value={stats} maxHeight="24rem" />
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
