import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useServer } from '../store'
import type { BattleCharacter, RoundRecord } from '../types'
import JsonView from './JsonView'

// 从 RoundRecord 解析战斗角色状态（Checkpoint 优先，TeamMap 决定阵营）
function parseCharacters(round: RoundRecord): BattleCharacter[] {
  const teamMap = round.TeamMap ?? {}
  const checkpoints = round.Checkpoint ?? []
  const byGuid = new Map(checkpoints.map((c) => [c.Character.Guid, c]))

  return (round.AllCharacters ?? []).map((ref, idx) => {
    const snap = byGuid.get(ref.Guid)
    const teamName = teamMap[ref.Guid] ?? ''
    const team: BattleCharacter['team'] =
      /红|敌|horde/i.test(teamName) ? 'horde' : /蓝|己|ally|alliance/i.test(teamName) ? 'alliance' : idx % 2 === 0 ? 'alliance' : 'horde'
    return {
      guid: ref.Guid,
      name: ref.Name,
      nickName: ref.NickName || ref.Name,
      level: snap ? Number(snap.Attributes?.Level ?? 0) || 1 : 1,
      hp: snap?.HP ?? 1,
      maxHp: snap?.MaxHP ?? 1,
      mp: snap?.MP ?? 0,
      maxMp: snap?.MaxMP ?? 1,
      ep: snap?.EP ?? 0,
      alive: (snap?.HP ?? 1) > 0,
      team,
      statuses: (snap?.Effects as unknown[])?.map((e) => String((e as { EffectName?: string }).EffectName ?? '') ?? '').filter(Boolean) ?? [],
    }
  })
}

export default function BattleView() {
  const { baseUrl, token, wsStatus, wsSend, events, clearEvents, battle, patchBattle, resetBattle, addRecord } = useServer()
  const [matchBusy, setMatchBusy] = useState(false)
  const [controlBusy, setControlBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const latestRoundRef = useRef<RoundRecord | null>(null)

  // 解析最近一回合的角色状态
  useEffect(() => {
    const roundEvent = [...events].reverse().find((e) => e.type === 'gaming.round')
    if (!roundEvent) return
    const d = roundEvent.data as { gameId?: string; round?: RoundRecord }
    const round = d.round as RoundRecord | undefined
    if (!round) return
    latestRoundRef.current = round
    const chars = parseCharacters(round)
    patchBattle({ characters: chars, round: round.Round, mode: battle.mode || d.gameId ? battle.mode : battle.mode })
  }, [events, patchBattle, battle.mode])

  const roundEvents = useMemo(() => events.filter((e) => e.type === 'gaming.round'), [events])

  const startMatch = async () => {
    if (wsStatus !== 'open') return
    setMatchBusy(true)
    resetBattle()
    clearEvents()
    addRecord({ kind: 'ws', name: '快速匹配（5 人 AI 对战）', wsType: 'match.start', requestBody: { mode: 'example', count: 5 }, status: 'running' })
    try {
      const result = await wsSend('match.start', { mode: 'example', count: 5 })
      updateBattleFromMatch(result)
    } catch (e) {
      addRecord({ kind: 'ws', name: '快速匹配', wsType: 'match.start', status: 'fail', elapsedMs: 0, error: e instanceof Error ? e.message : String(e) })
    }
    setMatchBusy(false)
  }

  const updateBattleFromMatch = (result: { ok: boolean; elapsedMs: number; envelope: unknown; raw: string; error?: string }) => {
    const env = result.envelope as { d?: Record<string, unknown> } | null
    const d = env?.d
    if (result.ok && d) {
      patchBattle({ gameId: (d.gameId as string) ?? null, mode: (d.mode as string) ?? 'example', running: true })
    }
    addRecord({
      kind: 'ws',
      name: '快速匹配响应',
      wsType: 'match.start',
      status: result.ok ? 'success' : 'fail',
      elapsedMs: result.elapsedMs,
      responseBody: env,
      error: result.error,
    })
  }

  // 对局控制：暂停 / 恢复 / 强制结束（REST，需要 GamesManage 权限）
  const controlGame = async (action: 'pause' | 'resume' | 'end', confirmText?: string) => {
    if (!battle.gameId) return
    if (confirmText && !window.confirm(confirmText)) return
    setControlBusy(true)
    addRecord({
      kind: 'rest',
      name: `对局${action === 'pause' ? '暂停' : action === 'resume' ? '恢复' : '强制结束'}`,
      method: 'POST',
      path: `/api/admin/server/games/${battle.gameId}/${action}`,
      status: 'running',
    })
    const result = await api.post(baseUrl, `/api/admin/server/games/${battle.gameId}/${action}`, {}, token)
    addRecord({
      kind: 'rest',
      name: `对局${action === 'pause' ? '暂停' : action === 'resume' ? '恢复' : '强制结束'}响应`,
      method: 'POST',
      path: `/api/admin/server/games/${battle.gameId}/${action}`,
      status: result.ok ? 'success' : 'fail',
      elapsedMs: result.elapsedMs,
      responseBody: result.body,
      error: result.error,
    })
    if (result.ok) {
      if (action === 'pause') patchBattle({ paused: true })
      else if (action === 'resume') patchBattle({ paused: false })
      else patchBattle({ running: false, paused: false })
    }
    setControlBusy(false)
    return result
  }

  const alive = battle.characters.filter((c) => c.alive)
  const dead = battle.characters.filter((c) => !c.alive)
  const alliance = battle.characters.filter((c) => c.team === 'alliance')
  const horde = battle.characters.filter((c) => c.team === 'horde')

  const lastRound = latestRoundRef.current

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ===== 顶部：双方阵容 + 回合计数 ===== */}
      <div className="panel-dark gold-frame relative rounded-2xl p-3">
        <div className="flex items-center justify-between gap-2">
          <TeamStrip title="己方" color="alliance" characters={alliance} />
          <div className="gold-frame shrink-0 rounded-xl bg-parchment-50/90 px-4 py-2 text-center">
            <div className="text-[10px] font-semibold tracking-widest text-gold-600">回合</div>
            <div className="font-fantasy text-2xl font-semibold leading-tight text-gold-600">
              {String(battle.round).padStart(2, '0')}
              <span className="text-sm text-ink-400"> / ∞</span>
            </div>
          </div>
          <TeamStrip title="敌方" color="horde" characters={horde} />
        </div>
      </div>

      {/* ===== 中央：角色战场 ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {battle.characters.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-gold-500/40 bg-parchment-200/50 text-center">
            <div className="mb-2 text-3xl text-gold-500/70">🏰</div>
            <div className="text-[14px] font-semibold text-ink-700">战斗尚未开始</div>
            <div className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-500">
              连接 WS 后点击下方「开始行动」发起一局 5 人 AI 对战，回合记录会实时推送到这里
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[...alliance, ...horde, ...dead].map((c) => (
              <CharacterCard key={c.guid} character={c} />
            ))}
          </div>
        )}
      </div>

      {/* ===== 底部：操作区 ===== */}
      <div className="panel-dark gold-frame rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={startMatch}
            disabled={wsStatus !== 'open' || matchBusy}
            className="rounded-xl bg-gradient-to-r from-gold-400 to-gold-300 px-5 py-2.5 text-[14px] font-semibold text-ink-900 shadow-lg shadow-gold-500/30 transition-transform hover:scale-[1.02] disabled:opacity-50"
          >
            {matchBusy ? '匹配中…' : '▶ 开始行动'}
          </button>
          <button
            onClick={() => patchBattle({ auto: !battle.auto })}
            className={`rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-colors ${
              battle.auto ? 'border-gold-500/60 bg-gold-500/15 text-gold-600' : 'border-ink-400/35 text-ink-600 hover:bg-ink-400/10'
            }`}
          >
            自动
          </button>
          <button
            onClick={() => patchBattle({ speed: battle.speed === 1 ? 2 : 1 })}
            className={`rounded-xl border px-4 py-2.5 font-mono text-[13px] font-medium transition-colors ${
              battle.speed === 2 ? 'border-gold-500/60 bg-gold-500/15 text-gold-600' : 'border-ink-400/35 text-ink-600 hover:bg-ink-400/10'
            }`}
          >
            ×{battle.speed}
          </button>

          {/* 对局控制（需 GamesManage 权限） */}
          {battle.gameId && battle.running && (
            <>
              <button
                onClick={() => controlGame(battle.paused ? 'resume' : 'pause')}
                disabled={controlBusy}
                className={`rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
                  battle.paused
                    ? 'border-emerald-600/50 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
                    : 'border-amber-600/50 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25'
                }`}
              >
                {battle.paused ? '▶ 继续' : '⏸ 暂停'}
              </button>
              <button
                onClick={() => controlGame('end', '确定要强制结束当前对局吗？归档仍会保留。')}
                disabled={controlBusy}
                className="rounded-xl border border-red-600/50 bg-red-500/15 px-4 py-2.5 text-[13px] font-medium text-red-700 transition-colors hover:bg-red-500/25 disabled:opacity-50"
              >
                ⏹ 强制结束
              </button>
            </>
          )}
          {battle.paused && (
            <span className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700">已暂停</span>
          )}

          <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-500">
            <span>{alive.length} 存活 / {battle.characters.length}</span>
            <button onClick={() => setShowLog((s) => !s)} className="rounded px-2 py-1 hover:bg-ink-400/15 hover:text-ink-700">
              事件日志 {roundEvents.length > 0 ? `(${roundEvents.length})` : ''}
            </button>
          </div>
        </div>
        {wsStatus !== 'open' && <div className="mt-2 text-[11px] text-amber-700">提示：请先在顶部登录并连接 WebSocket，再进行对局测试。</div>}
        {battle.gameId && battle.running && (
          <div className="mt-2 text-[11px] text-ink-500">
            对局控制走管理端 REST（需 GamesManage 权限，默认 admin 账号具备）
          </div>
        )}
      </div>

      {/* ===== 结算横幅 ===== */}
      {battle.gameOver && <GameOverBanner />}

      {/* ===== 事件日志（响应式折叠）===== */}
      {(showLog || battle.characters.length > 0) && (
        <div className="panel-dark gold-frame rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-gold-600">对局事件流</span>
            <button onClick={clearEvents} className="rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-400/15 hover:text-ink-700">
              清空
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {events.length === 0 && <div className="text-[12px] text-ink-400">暂无事件</div>}
            {events.map((e) => (
              <EventRow key={e.id} type={e.type} data={e.data} />
            ))}
          </div>
        </div>
      )}

      {/* 最近回合原始数据（调试用，可折叠） */}
      {lastRound && (
        <details className="panel-dark gold-frame rounded-2xl p-3">
          <summary className="cursor-pointer text-[12px] text-ink-500">最近回合原始 RoundRecord（JSON）</summary>
          <div className="mt-2">
            <JsonView value={lastRound} maxHeight="24rem" />
          </div>
        </details>
      )}
    </div>
  )
}

// ===== 队伍条 =====
function TeamStrip({ title, color, characters }: { title: string; color: 'alliance' | 'horde'; characters: BattleCharacter[] }) {
  const border = color === 'alliance' ? 'border-alliance-500/50' : 'border-horde-500/50'
  const text = color === 'alliance' ? 'text-alliance-600' : 'text-horde-600'
  const bar = color === 'alliance' ? 'bg-alliance-500' : 'bg-horde-500'
  return (
    <div className={`min-w-0 flex-1 rounded-xl border ${border} bg-parchment-200/50 p-2`}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold ${text}`}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {title}
        <span className="ml-auto text-ink-400">{characters.filter((c) => c.alive).length}/{characters.length}</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {characters.length === 0 && <span className="text-[11px] text-ink-400">空</span>}
        {characters.map((c) => (
          <div key={c.guid} className="w-12 shrink-0">
            <div
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold ${
                c.alive
                  ? color === 'alliance'
                    ? 'border-alliance-500/70 bg-alliance-500/15 text-alliance-600'
                    : 'border-horde-500/70 bg-horde-500/15 text-horde-600'
                  : 'border-ink-400/40 bg-ink-400/10 text-ink-400 line-through'
              }`}
            >
              {c.nickName.slice(0, 1)}
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-parchment-300">
              <div className={`h-full rounded-full ${bar} ${c.alive ? '' : 'opacity-30'}`} style={{ width: `${(c.hp / c.maxHp) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 角色卡片 =====
function CharacterCard({ character }: { character: BattleCharacter }) {
  const isAlliance = character.team === 'alliance'
  const border = isAlliance ? 'border-alliance-500/40' : 'border-horde-500/40'
  const hpPct = Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100))
  const mpPct = Math.max(0, Math.min(100, (character.mp / character.maxMp) * 100))

  return (
    <div className={`rounded-xl border ${border} bg-parchment-100/70 p-2.5 ${character.alive ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-2">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-[14px] font-semibold ${
            isAlliance ? 'border-alliance-500/70 bg-alliance-500/15 text-alliance-600' : 'border-horde-500/70 bg-horde-500/15 text-horde-600'
          }`}
        >
          {character.nickName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ink-800">{character.nickName}</span>
            <span className="shrink-0 rounded bg-gold-500/15 px-1 font-mono text-[10px] font-medium text-gold-600">Lv.{character.level}</span>
            {!character.alive && <span className="shrink-0 rounded bg-red-500/20 px-1 text-[10px] font-medium text-red-700">阵亡</span>}
          </div>
          <div className="mt-1.5 space-y-1">
            <Bar label="HP" value={character.hp} max={character.maxHp} pct={hpPct} color={isAlliance ? 'bg-alliance-500' : 'bg-horde-500'} />
            <Bar label="MP" value={character.mp} max={character.maxMp} pct={mpPct} color="bg-sky-500" />
          </div>
        </div>
      </div>
      {character.statuses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {character.statuses.slice(0, 5).map((s, i) => (
            <span key={i} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Bar({ label, value, max, pct, color }: { label: string; value: number; max: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 font-mono text-[10px] text-ink-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-parchment-300">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-600">
        {Math.round(value)}/{Math.round(max)}
      </span>
    </div>
  )
}

// ===== 事件行 =====
function EventRow({ type, data }: { type: string; data: unknown }) {
  const summary = useMemo(() => {
    if (type === 'gaming.round') {
      const d = data as { round?: RoundRecord }
      const r = d.round as RoundRecord | undefined
      if (!r) return '（回合数据）'
      const parts: string[] = []
      if (r.Actor) parts.push(`行动者 ${r.Actor.NickName || r.Actor.Name}`)
      const dmg = Object.values(r.Damages ?? {}).reduce((a, b) => a + b, 0)
      const heal = Object.values(r.Heals ?? {}).reduce((a, b) => a + b, 0)
      if (dmg > 0) parts.push(`伤害 ${dmg.toFixed(0)}`)
      if (heal > 0) parts.push(`治疗 ${heal.toFixed(0)}`)
      if (r.HasKill) parts.push('击杀！')
      return `第 ${r.Round} 回合 · ${parts.join(' · ')}`
    }
    if (type === 'gaming.over') {
      const d = data as { gameId?: string; totalRound?: number; totalTime?: number }
      return `对局结束 · 共 ${d.totalRound ?? '?'} 回合 · 用时 ${((d.totalTime ?? 0) / 1000).toFixed(1)}s`
    }
    if (type === 'gaming.start') return '对局开始'
    if (type === 'system.notice') return (data as { message?: string }).message ?? '服务器公告'
    return type
  }, [type, data])

  const color =
    type === 'gaming.round'
      ? 'border-sky-600/40 bg-sky-500/8'
      : type === 'gaming.over'
        ? 'border-gold-500/50 bg-gold-500/10'
        : 'border-ink-400/25 bg-parchment-200/40'

  return (
    <details className={`rounded-lg border ${color} px-2.5 py-1.5`}>
      <summary className="cursor-pointer text-[12px] text-ink-700">{summary}</summary>
      <div className="mt-1.5">
        <JsonView value={data} maxHeight="16rem" />
      </div>
    </details>
  )
}

// ===== 结算横幅 =====
function GameOverBanner() {
  const { battle, resetBattle, clearEvents, patchBattle } = useServer()
  const over = battle.gameOver
  if (!over) return null

  const result = over.gameResult as Array<{ rank: number; isWinner: boolean; character: { nickName: string; name: string } | null; team: { name: string } | null; kills: number; deaths: number; score: number }> | null
  const winner = result?.find((r) => r.isWinner)

  return (
    <div className="gold-frame rounded-2xl bg-gradient-to-b from-gold-300/30 to-parchment-200/80 p-4 text-center">
      <div className="font-fantasy text-[22px] font-semibold tracking-widest text-gold-600">战斗结束</div>
      <div className="mt-1 text-[12px] text-ink-600">
        {over.mode} · 共 {over.totalRound} 回合 · 用时 {((over.totalTime ?? 0) / 1000).toFixed(1)}s
      </div>
      {winner && (
        <div className="mt-2 text-[14px] font-medium text-gold-600">
          胜者：{winner.team?.name ?? winner.character?.nickName ?? winner.character?.name ?? '—'}
        </div>
      )}
      <div className="mx-auto mt-3 max-h-48 max-w-lg overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-ink-400">
              <th className="py-1 text-left">排名</th>
              <th className="text-left">角色</th>
              <th>击杀</th>
              <th>阵亡</th>
              <th>得分</th>
            </tr>
          </thead>
          <tbody>
            {result?.map((r) => (
              <tr key={r.rank} className="border-t border-ink-400/15 text-ink-700">
                <td className="py-1 text-left font-mono">{r.rank}</td>
                <td className="text-left">{r.character?.nickName ?? r.character?.name ?? r.team?.name ?? '—'}</td>
                <td className="text-center font-mono">{r.kills}</td>
                <td className="text-center font-mono">{r.deaths}</td>
                <td className="text-center font-mono">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => {
          resetBattle()
          clearEvents()
          patchBattle({ running: false })
        }}
        className="mt-3 rounded-lg border border-gold-500/60 bg-gold-500/15 px-4 py-1.5 text-[13px] font-medium text-gold-600 hover:bg-gold-500/25"
      >
        返回
      </button>
    </div>
  )
}
