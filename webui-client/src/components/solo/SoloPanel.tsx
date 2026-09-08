import { useCallback, useState } from 'react'
import { useSoloGame } from '../../game/useSoloGame'
import type { SoloDecisionReply } from '../../game/soloTypes'
import SoloDecisionModal from './SoloDecisionModal'
import SoloLog from './SoloLog'
import SoloMap from './SoloMap'
import SoloQueue from './SoloQueue'
import SoloRoster from './SoloRoster'
import { SoloTurnBanner } from './SoloTurnBanner'

const DEFAULT_BASE_URL = 'http://localhost:11030'
const LS_URL = 'fungame.solo.baseUrl'

const CONN_META: Record<string, { label: string; dot: string }> = {
  idle: { label: '未连接', dot: '#9ca3af' },
  connecting: { label: '连接中…', dot: '#f59e0b' },
  open: { label: '已连接', dot: '#10b981' },
  closed: { label: '已断开', dot: '#ef4444' },
  error: { label: '连接异常', dot: '#ef4444' },
}

interface SoloOptions {
  characterCount: number
  level: number
  skillLevel: number
  roundDelayMs: number
}

export default function SoloPanel() {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS_URL) ?? DEFAULT_BASE_URL)
  const [showLog, setShowLog] = useState(true)
  const [opt, setOpt] = useState<SoloOptions>({ characterCount: 10, level: 60, skillLevel: 6, roundDelayMs: 350 })
  const [starting, setStarting] = useState(false)
  // 技能意图：记住玩家点的是「战技/魔法」还是「爆发技」，用于过滤后续技能列表
  const [skillIntent, setSkillIntent] = useState<'all' | 'normal' | 'super'>('all')
  const game = useSoloGame(baseUrl)
  const { state } = game

  const persistBaseUrl = (v: string) => {
    setBaseUrl(v)
    localStorage.setItem(LS_URL, v)
  }

  const startGame = useCallback(async () => {
    setStarting(true)
    try {
      const ok = await game.connect()
      if (!ok) return // 保持设置页，展示连接错误
      setSkillIntent('all')
      game.start({
        characterCount: opt.characterCount,
        level: opt.level,
        skillLevel: opt.skillLevel,
        normalAttackLevel: opt.skillLevel + 2,
        maxRound: 999,
        roundDelayMs: opt.roundDelayMs,
      })
    } finally {
      setStarting(false)
    }
  }, [game, opt])

  // 目标格提交 → 决策回传
  const submitGrid = useCallback(
    (gridId: number) => game.submit({ gridId } as SoloDecisionReply),
    [game],
  )
  const submitGrids = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) game.cancel()
      else game.submit({ gridIds: ids } as SoloDecisionReply)
    },
    [game],
  )
  // 地图直接点选角色作为目标
  const submitTargets = useCallback(
    (guids: string[]) => {
      if (guids.length === 0) game.cancel()
      else game.submit({ targetGuids: guids } as SoloDecisionReply)
    },
    [game],
  )

  const player = state.playerGuid ? (state.charByGuid.get(state.playerGuid) ?? null) : null
  const conn = CONN_META[state.conn] ?? CONN_META.idle

  // ============ 设置页 ============
  if (!state.started && !state.running && !state.finished) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-4">
        <div className="panel w-[min(720px,96%)] rounded-2xl p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-400 to-gold-600 text-2xl shadow">⚔️</span>
            <div>
              <h2 className="font-fantasy text-xl font-bold tracking-wide text-ink-900">单人模式</h2>
              <p className="text-[12px] text-ink-500">服务器权威计算 · 1 名人类 vs 9 名 AI · 基于 FunGame.Core v3 MixGamingQueue</p>
            </div>
          </div>

          {/* 连接地址 */}
          <div className="mb-4 rounded-xl border border-ink-800/10 bg-parchment-100/60 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-ink-700">单人局引擎地址（Testing-v3 WebAPI）</span>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: conn.dot }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: conn.dot }} />
                {conn.label}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                value={baseUrl}
                onChange={(e) => persistBaseUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startGame()}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-ink-400/25 bg-white/70 px-3 py-2 font-mono text-[12.5px] text-ink-800 focus:border-gold-500"
              />
              {state.conn !== 'open' && (
                <button
                  onClick={() => void game.connect()}
                  disabled={starting}
                  className="shrink-0 rounded-xl border border-ink-400/25 bg-parchment-200/70 px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-parchment-300/70 disabled:opacity-50"
                >
                  连接
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
              单人战斗引擎由本地 WebAPI（默认 11030）驱动；传输层已抽象，将来联动 Server-v3（5000）联机版时协议不变。
            </p>
          </div>

          {/* 对局参数 */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['characterCount', '参战人数', opt.characterCount, (v: number) => setOpt((o) => ({ ...o, characterCount: v })), { min: 2, max: 10 }],
                ['level', '角色等级', opt.level, (v: number) => setOpt((o) => ({ ...o, level: v })), { min: 1, max: 100 }],
                ['skillLevel', '技能等级', opt.skillLevel, (v: number) => setOpt((o) => ({ ...o, skillLevel: v })), { min: 1, max: 20 }],
                ['roundDelayMs', '回合间隔(ms)', opt.roundDelayMs, (v: number) => setOpt((o) => ({ ...o, roundDelayMs: v })), { min: 0, max: 3000 }],
              ] as const
            ).map(([key, label, value, setter, range]) => (
              <label key={key} className="flex flex-col gap-1 rounded-xl border border-ink-800/10 bg-parchment-100/50 px-3 py-2">
                <span className="text-[10.5px] font-medium text-ink-500">{label}</span>
                <input
                  type="number"
                  value={value}
                  min={range.min}
                  max={range.max}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-400/20 bg-white/70 px-2 py-1 text-[13px] text-ink-800 focus:border-gold-500"
                />
              </label>
            ))}
          </div>

          <button
            onClick={() => void startGame()}
            disabled={starting || state.conn === 'connecting'}
            className="w-full rounded-xl border border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 px-4 py-3 font-fantasy text-[16px] font-bold tracking-wider text-white shadow-md shadow-gold-500/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting || state.conn === 'connecting' ? '正在连接…' : '⚔ 开始单人战斗'}
          </button>
          {state.conn === 'error' && (
            <p className="mt-2 text-center text-[11.5px] text-horde-500">连接失败：请确认 Testing-v3 WebAPI 已在本机启动（端口 11030）。</p>
          )}
        </div>
      </div>
    )
  }

  // ============ 战斗页 ============
  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-gold-500/25 bg-parchment-200/60 px-3 py-1.5">
        <div className="flex items-center gap-4 text-[12px] text-ink-600">
          <span className="font-fantasy text-[13px] font-bold text-gold-700">⚔ 单人模式</span>
          <span>
            第 <b className="font-mono text-[13px] text-ink-800">{state.round}</b> 回合
          </span>
          <span className="font-mono text-ink-500">{state.totalTime.toFixed(1)} 秒</span>
          <span className="hidden text-ink-400 sm:inline">#{state.gameId ?? '…'}</span>
        </div>
        <div className="flex items-center gap-2">
          {state.conn !== 'open' && (
            <button
              onClick={() => void game.connect()}
              className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 hover:bg-amber-500/25"
            >
              {state.finished ? '断开' : '重新连接（AI 托管中）'}
            </button>
          )}
          <span className="flex items-center gap-1.5 rounded-full bg-ink-800/5 px-2.5 py-1 text-[11px] text-ink-500">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: conn.dot }} />
            {conn.label}
          </span>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="rounded-lg border border-ink-400/25 bg-parchment-200/60 px-2.5 py-1 text-[11.5px] text-ink-600 hover:bg-parchment-300/60"
          >
            📜 {showLog ? '收起' : '展开'}日志
          </button>
          <button
            onClick={() => game.end()}
            className="rounded-lg border border-horde-500/40 bg-horde-500/10 px-2.5 py-1 text-[11.5px] font-medium text-horde-600 hover:bg-horde-500/20"
          >
            ⏹ 结束对局
          </button>
        </div>
      </div>

      {/* 主体三栏 */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* 左：行动顺序 */}
        <aside className="panel w-[190px] shrink-0 rounded-xl p-2">
          <SoloQueue queue={state.queue} charByGuid={state.charByGuid} playerGuid={state.playerGuid} playerDP={state.playerDP} />
        </aside>

        {/* 中：地图 */}
        <section className="relative flex min-w-0 flex-1 flex-col rounded-xl border border-gold-500/25 bg-parchment-200/30 p-2">
          {state.map ? (
            <SoloMap
              map={state.map}
              charByGuid={state.charByGuid}
              playerGuid={state.playerGuid}
              decision={state.decision}
              onPickGrid={submitGrid}
              onSubmitGrids={submitGrids}
              onPickTargets={submitTargets}
              onCancelDecision={() => game.cancel()}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[13px] text-ink-400">等待地图数据…</div>
          )}

          {/* 回合状态横幅：轮到谁 / 剩余多久 / 是否被 AI 托管 */}
          <SoloTurnBanner
            hasDecision={state.decision !== null}
            decisionDeadline={state.decisionDeadline}
            aiEscalated={state.aiEscalated}
            round={state.round}
          />
        </section>

        {/* 右：角色列表 */}
        <aside className="w-[270px] shrink-0 rounded-xl border border-ink-800/10 bg-parchment-200/40 p-1.5">
          <SoloRoster characters={state.characters} playerGuid={state.playerGuid} />
        </aside>
      </div>

      {/* 回合内决策：停靠操作栏（位于战场下方、日志之上，不遮挡地图与角色信息） */}
      {state.decision && state.decision.kind !== 'SelectCharacter' && (
        <SoloDecisionModal
          mode="dock"
          decision={state.decision}
          player={player}
          skillIntent={skillIntent}
          onSubmit={(p, intent) => {
            if (intent && intent !== 'all') setSkillIntent(intent)
            game.submit(p)
          }}
          onCancel={() => game.cancel()}
        />
      )}

      {/* 底部日志 */}
      {showLog && (
        <div className="h-[150px] shrink-0 rounded-xl border border-ink-800/10 bg-parchment-200/40 p-2">
          <SoloLog log={state.log} round={state.round} />
        </div>
      )}

      {/* 开局选角色：居中浮层（此时尚无战场信息可看） */}
      {state.decision && state.decision.kind === 'SelectCharacter' && (
        <SoloDecisionModal
          mode="modal"
          decision={state.decision}
          player={player}
          skillIntent="all"
          onSubmit={(p) => game.submit(p)}
          onCancel={() => game.cancel()}
        />
      )}

      {/* 结算层 */}
      {state.finished && state.ranking && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink-900/55 p-4 backdrop-blur-[2px]">
          <div className="panel flex max-h-full w-[min(680px,96vw)] flex-col overflow-hidden rounded-2xl">
            <div className="shrink-0 bg-gradient-to-r from-gold-500/90 to-transparent px-5 py-3">
              <div className="font-fantasy text-[18px] font-bold tracking-wider text-white drop-shadow">🏆 对局结算</div>
              <div className="text-[12px] text-amber-100/90">
                共 {state.round} 回合 · {(state.totalTime ?? 0).toFixed(1)} 秒
                {state.winnerName ? ` · 胜者：${state.winnerName}` : ''}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-ink-800/10 text-left text-[10.5px] uppercase tracking-wider text-ink-400">
                    <th className="py-1.5 pr-2">#</th>
                    <th className="py-1.5 pr-2">角色</th>
                    <th className="py-1.5 pr-2 text-right">评分</th>
                    <th className="py-1.5 pr-2 text-right">击杀</th>
                    <th className="py-1.5 pr-2 text-right">死亡</th>
                    <th className="py-1.5 pr-2 text-right">助攻</th>
                    <th className="py-1.5 pr-2 text-right">伤害</th>
                    <th className="py-1.5 text-right">治疗</th>
                  </tr>
                </thead>
                <tbody>
                  {state.ranking.map((r) => (
                    <tr
                      key={r.guid}
                      className={`border-b border-ink-800/5 ${r.isWinner ? 'bg-gold-300/15' : ''} ${r.isPlayer ? 'font-bold text-gold-700' : 'text-ink-700'}`}
                    >
                      <td className="py-1.5 pr-2">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
                      <td className="py-1.5 pr-2">
                        {r.isPlayer ? '★ ' : ''}
                        {r.displayName}
                        {r.isWinner && <span className="ml-1 text-[10px] text-gold-600">胜者</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{Math.round(r.rating)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-horde-600">{r.kills}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-ink-400">{r.deaths}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-ink-500">{r.assists}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{Math.round(r.totalDamage)}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-600">{Math.round(r.totalHeal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-ink-800/10 px-4 py-3">
              <button
                onClick={() => game.end()}
                className="rounded-xl border border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 px-5 py-2 text-[13px] font-bold text-white shadow-sm hover:brightness-110"
              >
                ⚔ 再开一局
              </button>
              <button
                onClick={() => game.end()}
                className="rounded-xl border border-ink-400/25 bg-parchment-200/60 px-4 py-2 text-[13px] text-ink-600 hover:bg-parchment-300/60"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
