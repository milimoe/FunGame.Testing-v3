import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { resolveDefaultBaseUrl } from '../baseUrl'
import { useSoloGame } from '../game/useSoloGame'
import { shapeLabel } from '../game/shape'
import type { SoloCharacterDto, SoloDecisionReply } from '../game/soloTypes'
import SoloActionPanel, { type SkillIntent, type SoloPreviewRange } from './SoloActionPanel'
import SoloCharDetail from './SoloCharDetail'
import SoloFloatingPanel, { SoloModal } from './SoloFloatingPanel'
import SoloLog from './SoloLog'
import SoloMap from './SoloMap'
import SoloQueue from './SoloQueue'
import SoloRoster from './SoloRoster'
import { SoloTurnBanner } from './SoloTurnBanner'

// ============================================================================
// 单人模式 · 移动端竖版界面
//
// 版面（自上而下 / 自左而右）：
//   顶栏      返回 · 回合 / 用时 / 比分 · 暂停 · 设置 · 终止对局
//   左        行动顺序表（竖条，含玩家决策点）
//   中        大地图（棋子正上方画血条，黄=攻击/施法距离，绿=移动距离）
//   右        统一功能按钮列：操作 / 日志 / 队伍 —— 点击弹出右侧小窗，可随时关掉
//   底部      仅在地图上选目标 / 选格子时出现「确认」条（勾选与确认分离）
//
// 对局模式：5V5 团队死亡竞赛（红蓝阵营，己方恒为蓝色，10 人头取胜）。
// 交互约定：移动 / 普攻「勾选 → 看详情 → 确认」；技能 / 爆发技 / 物品点一下直达下级菜单。
// ============================================================================

const DEFAULT_BASE_URL = resolveDefaultBaseUrl('http://localhost:11030')
const LS_URL = 'fungame.solo.baseUrl'

const CONN_META: Record<string, { label: string; dot: string }> = {
  idle: { label: '未连接', dot: '#9ca3af' },
  connecting: { label: '连接中…', dot: '#f59e0b' },
  open: { label: '已连接', dot: '#10b981' },
  closed: { label: '已断开', dot: '#ef4444' },
  error: { label: '连接异常', dot: '#ef4444' },
}

/** 这些决策需要玩家在右侧「操作」小窗里做选择，到达时自动弹出 */
const AUTO_DRAWER_KINDS = new Set(['ActionType', 'Skill', 'Item', 'Inquiry', 'Continue'])
/** 这些决策在地图上点选，不能自动弹窗（会挡住地图） */
const MAP_PICK_KINDS = new Set(['Targets', 'TargetGrid', 'TargetGrids'])

interface SoloOptions {
  characterCount: number
  level: number
  skillLevel: number
  roundDelayMs: number
  /** 团队 5V5（关闭 = 混战） */
  teamMode: boolean
  teamSize: number
  /** 死亡竞赛夺冠人头数 */
  maxScoreToWin: number
  /** 初始装备品质：0=白 1=绿 2=蓝 3=紫 4=橙 5=红（5 含红以上） */
  initialItemQuality: number
  /** 空投轮换间隔（游戏时间秒）：每 N 秒再空投一次并提升品质；0 = 关闭 */
  dropItemsIntervalSeconds: number
}

type Drawer = 'action' | 'log' | 'team' | null

/** 己方（蓝队）配色 */
const MY_COLOR = '#2563eb'
/** 敌方（红队）配色 */
const FOE_COLOR = '#dc2626'

function MiniBar({ label, value, max, color, track }: { label: string; value: number; max: number; color: string; track: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[15px] shrink-0 text-[8.5px] font-bold leading-none" style={{ color }}>
        {label}
      </span>
      <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: track }}>
        <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="w-[62px] shrink-0 text-right font-mono text-[9px] leading-none text-ink-500">
        {Math.round(value)}
        <span className="text-ink-400">/{Math.round(max)}</span>
      </span>
    </div>
  )
}

/**
 * 玩家 HUD：竖屏手机上棋盘受宽度限制（12×12 只能排到 ~18px 的格子），
 * 中间列下方天然留出一条空的横带——正好放自己的血蓝条，符合手游的习惯。
 */
function PlayerHud({ c, color = MY_COLOR, ring = '#1d4ed8' }: { c: SoloCharacterDto; color?: string; ring?: string }) {
  const dead = c.isEliminated || c.hp <= 0
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-gold-500/35 bg-parchment-200/85 px-2 py-1.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
        style={{
          backgroundColor: dead ? '#6b7280' : color,
          color: '#fff',
          boxShadow: `0 0 0 1.5px ${ring}`,
          opacity: dead ? 0.6 : 1,
        }}
      >
        {[...(c.nickName || c.name || '?')][0]}
      </span>
      <div className="min-w-0 flex-1 space-y-[3px]">
        <div className="flex items-center gap-1.5 text-[10.5px] leading-none">
          <span className="truncate font-bold text-gold-700">★ {c.displayName}</span>
          <span className="shrink-0 text-ink-400">Lv.{c.level}</span>
          {c.teamName ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold"
              style={{ backgroundColor: `${color}22`, color }}
            >
              {c.teamName}（己方）
            </span>
          ) : null}
          <span className="ml-auto shrink-0 rounded-full bg-ink-800/8 px-1.5 py-[1px] text-[9.5px] text-ink-500">
            {dead ? '已阵亡' : c.state === 'Actionable' ? '待行动' : c.state}
          </span>
        </div>
        <MiniBar label="HP" value={c.hp} max={c.maxHP} color={dead ? '#9ca3af' : '#dc2626'} track="rgba(220,38,38,0.13)" />
        <MiniBar label="MP" value={c.mp} max={c.maxMP} color={c.maxMP > 0 ? '#2563eb' : '#cbd5e1'} track="rgba(37,99,235,0.13)" />
        <MiniBar label="EP" value={c.ep} max={c.maxEP} color="#b8862e" track="rgba(184,134,46,0.16)" />
      </div>
    </div>
  )
}

/** 死亡竞赛比分板：己方蓝 / 敌方红，先到 maxScoreToWin 人头者胜 */
function ScoreBoard({ teams, maxScoreToWin }: { teams: { name: string; score: number; alive: number; size: number; isPlayerTeam: boolean }[]; maxScoreToWin: number }) {
  if (teams.length === 0) return null
  const mine = teams.find((t) => t.isPlayerTeam) ?? teams[0]
  const foe = teams.find((t) => !t.isPlayerTeam)
  const Bar = ({ score, color }: { score: number; color: string }) => (
    <span className="ml-1 inline-block h-[4px] w-8 overflow-hidden rounded-full bg-ink-800/12 align-middle">
      <span
        className="block h-full rounded-full"
        style={{ width: `${maxScoreToWin > 0 ? Math.min(100, (score / maxScoreToWin) * 100) : 0}%`, backgroundColor: color }}
      />
    </span>
  )
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-ink-800/5 px-2 py-[2px] font-mono text-[10px]">
      <span className="font-bold" style={{ color: MY_COLOR }}>
        {mine.name} {mine.score}
      </span>
      <Bar score={mine.score} color={MY_COLOR} />
      <span className="text-ink-400">:</span>
      {foe ? (
        <>
          <Bar score={foe.score} color={FOE_COLOR} />
          <span className="font-bold" style={{ color: FOE_COLOR }}>
            {foe.score} {foe.name}
          </span>
        </>
      ) : null}
      {maxScoreToWin > 0 ? <span className="text-ink-400">/ {maxScoreToWin}</span> : null}
    </span>
  )
}

/** 右侧功能按钮 */
function RailButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  badge?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-[1px] rounded-xl border py-1.5 transition-all ${
        active
          ? 'border-gold-500/70 bg-gradient-to-b from-gold-300/30 to-gold-500/10 shadow-sm'
          : 'border-ink-400/20 bg-parchment-100/60 hover:bg-parchment-300/60'
      }`}
    >
      <span className="text-[16px] leading-none">{icon}</span>
      <span className={`text-[9.5px] leading-none ${active ? 'font-bold text-gold-700' : 'text-ink-500'}`}>{label}</span>
      {badge ? (
        <span className="absolute right-1 top-1 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-horde-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-horde-500" />
        </span>
      ) : null}
    </button>
  )
}

export default function SoloPanel() {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS_URL) ?? DEFAULT_BASE_URL)
  const [opt, setOpt] = useState<SoloOptions>({
    characterCount: 10,
    level: 60,
    skillLevel: 6,
    roundDelayMs: 350,
    teamMode: true,
    teamSize: 5,
    maxScoreToWin: 10,
    initialItemQuality: 5,
    dropItemsIntervalSeconds: 40,
  })
  const [starting, setStarting] = useState(false)
  // 技能意图：记住玩家点的是「战技 / 魔法」还是「爆发技」，用于过滤后续技能列表
  const [skillIntent, setSkillIntent] = useState<SkillIntent>('all')

  const game = useSoloGame(baseUrl)
  const { state } = game

  // ==================== 界面状态 ====================
  const [view, setView] = useState<'setup' | 'game'>('setup')
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [modal, setModal] = useState<'settings' | 'end' | null>(null)
  const [detailGuid, setDetailGuid] = useState<string | null>(null)
  // 地图上的勾选（与「确认」分离）
  const [pickedGrids, setPickedGrids] = useState<number[]>([])
  const [pickedTargets, setPickedTargets] = useState<string[]>([])
  // 操作菜单下发的射程预演（黄色攻击 / 绿色移动）
  const [preview, setPreview] = useState<SoloPreviewRange | null>(null)

  const decision = state.decision
  const payload = decision?.payload
  const requestKey = decision?.requestId ?? null
  const kind = payload?.kind ?? null

  const persistBaseUrl = (v: string) => {
    setBaseUrl(v)
    localStorage.setItem(LS_URL, v)
  }

  // 开局后自动进入对局视图
  useEffect(() => {
    if (state.started) setView('game')
  }, [state.started])

  // 结算时收起所有浮层
  useEffect(() => {
    if (state.finished) {
      setDrawer(null)
      setModal(null)
      setDetailGuid(null)
    }
  }, [state.finished])

  // 新决策到达：清空勾选 → 切回对局视图 → 需要选择类决策就自动弹出操作小窗
  useEffect(() => {
    const p = state.decision?.payload
    setPickedGrids([])
    if (p?.kind === 'Targets' && p.selectAll && p.targets.length > 0) {
      // 「选取全体」的技能 / 普攻：默认替玩家把全部可选目标勾上（问题 3）
      setPickedTargets(p.targets.map((t) => t.guid))
    } else if (p?.kind === 'Targets' && p.targets.length === 1 && p.targets[0].isSelf) {
      // 可选目标只有自己（常见于仅自身目标的增益技能）：默认勾上自己，
      // 但仍需玩家按地图下方的「确认目标」提交，不静默自动发送
      setPickedTargets([p.targets[0].guid])
    } else {
      setPickedTargets([])
    }
    setPreview(null)
    if (requestKey) {
      setView('game')
      if (kind && AUTO_DRAWER_KINDS.has(kind)) setDrawer('action')
      // 地图选取类决策要立刻让开地图
      else setDrawer((d) => (d === 'action' ? null : d))
      return
    }
    // 决策已解决：稍等再收起操作小窗。延时是为了让「行动类型 → 技能」这类连续阶段
    // 不出现「关一下又开」的闪烁（新请求到达会清掉这个定时器）。
    const timer = window.setTimeout(() => setDrawer((d) => (d === 'action' ? null : d)), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, kind])

  // ==================== 动作 ====================
  const startGame = useCallback(async () => {
    setStarting(true)
    try {
      const ok = await game.connect()
      if (!ok) return // 保持设置页，展示连接错误
      setSkillIntent('all')
      game.start({
        // 团队模式：参战人数 = 每队人数 × 2（保证两队满编）
        characterCount: opt.teamMode ? opt.teamSize * 2 : opt.characterCount,
        level: opt.level,
        skillLevel: opt.skillLevel,
        normalAttackLevel: opt.skillLevel + 2,
        maxRound: 999,
        roundDelayMs: opt.roundDelayMs,
        teamMode: opt.teamMode,
        teamSize: opt.teamSize,
        maxScoreToWin: opt.maxScoreToWin,
        // 团队死亡竞赛需要无限复活才能打到 10 人头；混战保留 1 次复活
        maxRespawnTimes: opt.teamMode ? -1 : 1,
        // 空投：初始装备品质 + 轮换间隔（游戏时间秒，0 = 关闭轮换）
        initialItemQuality: opt.initialItemQuality,
        dropItemsIntervalSeconds: opt.dropItemsIntervalSeconds,
      })
    } finally {
      setStarting(false)
    }
  }, [game, opt])

  const submit = useCallback(
    (p: SoloDecisionReply, intent?: SkillIntent) => {
      if (intent && intent !== 'all') setSkillIntent(intent)
      game.submit(p)
    },
    [game],
  )

  const cancelDecision = useCallback(() => game.cancel(), [game])

  const inspect = useCallback((guid: string) => setDetailGuid(guid), [])

  // 地图勾选
  const toggleGrid = useCallback(
    (gridId: number) => {
      const p = state.decision?.payload
      if (p?.kind === 'TargetGrid') {
        setPickedGrids((prev) => (prev[0] === gridId ? [] : [gridId]))
      } else if (p?.kind === 'TargetGrids') {
        // 非指向性技能：只选一个【中心格】，受影响区域由服务端按技能形状展开
        setPickedGrids((prev) => (prev[0] === gridId ? [] : [gridId]))
      }
    },
    [state.decision],
  )

  const toggleTarget = useCallback(
    (guid: string) => {
      const p = state.decision?.payload
      if (p?.kind !== 'Targets') return
      const max = Math.max(1, p.maxTargets)
      setPickedTargets((prev) => {
        if (prev.includes(guid)) return prev.filter((g) => g !== guid)
        if (max <= 1) return [guid]
        return prev.length < max ? [...prev, guid] : prev
      })
    },
    [state.decision],
  )

  // 地图勾选的提交（勾选与确认分离：只有这里按下确认才会发出）
  const confirmPick = useCallback(
    (overrideGridId?: number) => {
      const p = state.decision?.payload
      if (!p) return
      if (p.kind === 'TargetGrid') {
        const id = overrideGridId ?? pickedGrids[0]
        if (id === undefined) return
        game.submit({ gridId: id })
      } else if (p.kind === 'TargetGrids') {
        if (pickedGrids.length === 0) return
        game.submit({ gridIds: pickedGrids })
      } else if (p.kind === 'Targets') {
        if (pickedTargets.length === 0) return
        game.submit({ targetGuids: pickedTargets })
      }
    },
    [game, state.decision, pickedGrids, pickedTargets],
  )

  // ==================== 地图下方「确认」条 ====================
  const pickButtons = (
    <span className="flex shrink-0 items-center gap-1.5">
      {payload?.kind === 'TargetGrid' && payload.currentGridId >= 0 ? (
        <button
          onClick={() => confirmPick(payload.currentGridId)}
          title="移动距离为 0，原地待命"
          className="rounded-lg border border-gold-600/50 bg-gold-300/30 px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:bg-gold-300/50"
        >
          原地待命
        </button>
      ) : null}
      <button
        onClick={() => confirmPick()}
        disabled={
          (payload?.kind === 'TargetGrid' && pickedGrids.length === 0) ||
          (payload?.kind === 'TargetGrids' && pickedGrids.length === 0) ||
          (payload?.kind === 'Targets' && pickedTargets.length === 0)
        }
        className="rounded-lg border border-emerald-700/50 bg-emerald-600/90 px-3.5 py-1 text-[11.5px] font-bold text-white shadow-sm hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {payload?.kind === 'Targets' ? '确认目标' : payload?.kind === 'TargetGrids' ? '确认施放' : '确认移动'}
      </button>
      <button
        onClick={cancelDecision}
        className="rounded-lg border border-ink-400/30 bg-parchment-200/70 px-2.5 py-1 text-[11.5px] text-ink-600 hover:bg-parchment-300/70"
      >
        取消
      </button>
    </span>
  )

  let pickHint: ReactNode = null
  if (payload?.kind === 'TargetGrid') {
    pickHint =
      payload.gridIds.length === 0 ? (
        <span className="text-amber-700">⚠ 没有可移动的格子（可能被围住），请点「取消」返回</span>
      ) : (
        <>
          🏃 点选绿色格子移动
          {pickedGrids.length > 0 ? <b className="text-emerald-700"> · 已选 #{pickedGrids[0]}</b> : null}
        </>
      )
  } else if (payload?.kind === 'TargetGrids') {
    pickHint =
      payload.gridIds.length === 0 ? (
        <span className="text-amber-700">⚠ 该技能没有可施放的格子，请点「取消」返回</span>
      ) : (
        <>
          ✨ 点选中心格（{shapeLabel(payload.shapeRangeType)}
          {(payload.shapeRadius ?? 0) > 0 ? ` 半径${payload.shapeRadius}` : ''}）
          {pickedGrids.length > 0 ? <b className="text-emerald-700"> · 已选中心 #{pickedGrids[0]}（紫区将被覆盖）</b> : null}
        </>
      )
  } else if (payload?.kind === 'Targets') {
    pickHint =
      payload.targets.length === 0 ? (
        <span className="text-amber-700">
          ⚠ 「{payload.skillName || '技能'}」当前没有可选目标（不在射程内或已阵亡），请点「取消」返回
        </span>
      ) : (
        <>
          🎯 为「{payload.skillName || '技能'}」点选棋子
          <b className="text-horde-600">
            {' '}
            · 已选 {pickedTargets.length}/{Math.max(1, payload.maxTargets)}
          </b>
        </>
      )
  }

  const mapPickBar =
    payload && MAP_PICK_KINDS.has(payload.kind) ? (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 rounded-xl border border-gold-500/45 bg-parchment-200/90 px-2 py-1.5">
        <span className="min-w-0 text-[11px] leading-tight text-ink-600">{pickHint}</span>
        {pickButtons}
      </div>
    ) : null

  const player = state.playerGuid ? state.charByGuid.get(state.playerGuid) ?? null : null
  const detailChar = detailGuid ? state.charByGuid.get(detailGuid) ?? null : null
  const conn = CONN_META[state.conn] ?? CONN_META.idle
  const hasDecision = !!decision && decision.payload.kind !== 'SelectCharacter'

  // ==================== 设置页 ====================
  if (view === 'setup') {
    const inGame = state.started && !state.finished
    return (
      <div className="solo-root flex h-full items-center justify-center overflow-y-auto p-3">
        <div className="panel w-[min(560px,96%)] rounded-2xl p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-400 to-gold-600 text-[22px] shadow">⚔️</span>
            <div className="min-w-0">
              <h2 className="font-fantasy text-[18px] font-bold tracking-wide text-ink-900">单人模式</h2>
              <p className="text-[11.5px] leading-relaxed text-ink-500">
                服务器权威计算 · 1 名人类 vs 9 名 AI · 基于 FunGame.Core v3 MixGamingQueue
              </p>
            </div>
          </div>

          {inGame ? (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-emerald-700">对局进行中（第 {state.round} 回合）</div>
                <div className="text-[10.5px] text-ink-500">后台仍在推进；回到对局后若轮到你，操作小窗会自动弹出。</div>
              </div>
              <button
                onClick={() => setView('game')}
                className="shrink-0 rounded-xl border border-emerald-700/50 bg-emerald-600/90 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-emerald-600"
              >
                继续对局
              </button>
            </div>
          ) : null}

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
                onKeyDown={(e) => e.key === 'Enter' && void startGame()}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-ink-400/25 bg-white/70 px-3 py-2 font-mono text-[12.5px] text-ink-800 focus:border-gold-500"
              />
              {state.conn !== 'open' ? (
                <button
                  onClick={() => void game.connect()}
                  disabled={starting}
                  className="shrink-0 rounded-xl border border-ink-400/25 bg-parchment-200/70 px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-parchment-300/70 disabled:opacity-50"
                >
                  连接
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
              单人战斗引擎由本地 WebAPI（默认 11030）驱动；传输层已抽象，将来联动 Server-v3（5000）联机版时协议不变。
            </p>
          </div>

          {/* 对局模式 */}
          <div className="mb-3 rounded-xl border border-ink-800/10 bg-parchment-100/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-ink-700">对局模式</span>
              <span className="text-[10.5px] text-ink-400">己方恒为蓝队</span>
            </div>
            <div className="flex gap-2">
              {(
                [
                  [true, '⚔ 5V5 团队', '红蓝两队，先取人头者胜'],
                  [false, '☠ 混战', '各自为战，仅 1 次复活'],
                ] as const
              ).map(([mode, label, hint]) => (
                <button
                  key={String(mode)}
                  onClick={() => setOpt((o) => ({ ...o, teamMode: mode }))}
                  title={hint}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left transition-all ${
                    opt.teamMode === mode
                      ? 'border-gold-500/70 bg-gradient-to-b from-gold-300/30 to-gold-500/10 shadow-sm'
                      : 'border-ink-400/20 bg-parchment-100/60 hover:bg-parchment-300/50'
                  }`}
                >
                  <div className={`text-[12.5px] font-bold ${opt.teamMode === mode ? 'text-gold-700' : 'text-ink-600'}`}>{label}</div>
                  <div className="mt-[1px] text-[10px] leading-tight text-ink-400">{hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 对局参数 */}
          <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {(
              [
                [
                  'characterCount',
                  opt.teamMode ? '参战人数（= 每队 ×2）' : '参战人数',
                  opt.teamMode ? opt.teamSize * 2 : opt.characterCount,
                  (v: number) => setOpt((o) => ({ ...o, characterCount: v })),
                  { min: 2, max: 10 },
                  opt.teamMode,
                ],
                ['level', '角色等级', opt.level, (v: number) => setOpt((o) => ({ ...o, level: v })), { min: 1, max: 100 }, false],
                ['skillLevel', '技能等级', opt.skillLevel, (v: number) => setOpt((o) => ({ ...o, skillLevel: v })), { min: 1, max: 20 }, false],
                ['roundDelayMs', '回合间隔(ms)', opt.roundDelayMs, (v: number) => setOpt((o) => ({ ...o, roundDelayMs: v })), { min: 0, max: 3000 }, false],
                ['teamSize', '每队人数', opt.teamSize, (v: number) => setOpt((o) => ({ ...o, teamSize: v })), { min: 1, max: 5 }, !opt.teamMode],
                ['maxScoreToWin', '夺冠人头', opt.maxScoreToWin, (v: number) => setOpt((o) => ({ ...o, maxScoreToWin: v })), { min: 1, max: 99 }, !opt.teamMode],
                [
                  'initialItemQuality',
                  '初始装备品质（0白~5红）',
                  opt.initialItemQuality,
                  (v: number) => setOpt((o) => ({ ...o, initialItemQuality: v })),
                  { min: 0, max: 5 },
                  false,
                ],
                [
                  'dropItemsIntervalSeconds',
                  '空投轮换间隔（游戏秒，0=关）',
                  opt.dropItemsIntervalSeconds,
                  (v: number) => setOpt((o) => ({ ...o, dropItemsIntervalSeconds: v })),
                  { min: 0, max: 600 },
                  false,
                ],
              ] as const
            ).map(([key, label, value, setter, range, locked]) => (
              <label
                key={key}
                className={`flex flex-col gap-1 rounded-xl border px-3 py-2 ${
                  locked ? 'border-ink-800/8 bg-ink-800/4 opacity-55' : 'border-ink-800/10 bg-parchment-100/50'
                }`}
              >
                <span className="text-[10.5px] font-medium text-ink-500">{label}</span>
                <input
                  type="number"
                  value={value}
                  min={range.min}
                  max={range.max}
                  disabled={locked}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-400/20 bg-white/70 px-2 py-1 text-[13px] text-ink-800 focus:border-gold-500 disabled:cursor-not-allowed"
                />
              </label>
            ))}
          </div>

          <button
            onClick={() => void startGame()}
            disabled={starting || state.conn === 'connecting'}
            className="w-full rounded-xl border border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 px-4 py-3 font-fantasy text-[15px] font-bold tracking-wider text-white shadow-md shadow-gold-500/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting || state.conn === 'connecting' ? '正在连接…' : '⚔ 开始单人战斗'}
          </button>
          {state.conn === 'error' ? (
            <p className="mt-2 text-center text-[11.5px] text-horde-500">连接失败：请确认 Testing-v3 WebAPI 已在本机启动（端口 11030）。</p>
          ) : null}
        </div>
      </div>
    )
  }

  // ==================== 对局页 ====================
  return (
    <div className="solo-root relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* ---------- 顶栏 ---------- */}
      <header className="relative z-20 flex shrink-0 items-center gap-1.5 border-b border-gold-500/25 bg-parchment-200/70 px-1.5 py-1.5 backdrop-blur">
        <button
          onClick={() => setView('setup')}
          title="返回设置页（对局在后台继续）"
          className="flex h-8 shrink-0 items-center gap-0.5 rounded-xl border border-ink-400/25 bg-parchment-100/70 px-2 text-[12px] text-ink-600 hover:bg-parchment-300/60"
        >
          ‹ 返回
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[11px] text-ink-600">
          <span className="shrink-0 font-fantasy text-[12px] font-bold text-gold-700">⚔ 单人</span>
          <span className="shrink-0">
            第 <b className="font-mono text-[12.5px] text-ink-800">{state.round}</b> 回合
          </span>
          <span className="hidden shrink-0 font-mono text-ink-500 sm:inline">{state.totalTime.toFixed(0)}s</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-ink-800/5 px-2 py-[2px] text-[10px] text-ink-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: conn.dot }} />
            <span className="hidden sm:inline">{conn.label}</span>
          </span>
        </div>

        {state.conn !== 'open' ? (
          <button
            onClick={() => void game.connect()}
            title="重新连接（断线期间由 AI 托管）"
            className="h-8 shrink-0 rounded-xl border border-amber-600/50 bg-amber-500/15 px-2 text-[11.5px] font-medium text-amber-700 hover:bg-amber-500/25"
          >
            ⟳ 重连
          </button>
        ) : null}

        <button
          onClick={() => game.pause(!state.paused)}
          title={state.paused ? '继续对局' : '暂停对局（引擎挂起，不再计时）'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-[13px] transition-colors ${
            state.paused
              ? 'border-emerald-600/50 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
              : 'border-ink-400/25 bg-parchment-100/70 text-ink-600 hover:bg-parchment-300/60'
          }`}
        >
          {state.paused ? '▶' : '⏸'}
        </button>
        <button
          onClick={() => setModal('settings')}
          title="设置"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ink-400/25 bg-parchment-100/70 text-[14px] text-ink-600 hover:bg-parchment-300/60"
        >
          ⚙
        </button>
        <button
          onClick={() => setModal('end')}
          title="终止对局"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-horde-500/40 bg-horde-500/10 text-[13px] text-horde-600 hover:bg-horde-500/20"
        >
          ⏹
        </button>
      </header>

      {/* ---------- 团队比分条（仅 5V5 团队死亡竞赛） ---------- */}
      {state.teamMode && state.teams.length > 0 ? (
        <div
          className={`relative z-10 flex shrink-0 items-center gap-2 border-b px-1.5 py-1 ${
            state.paused ? 'border-emerald-600/30 bg-emerald-500/8' : 'border-gold-500/20 bg-parchment-200/40'
          }`}
        >
          {state.paused ? (
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold text-emerald-700">
              ⏸ 已暂停
            </span>
          ) : (
            <span className="shrink-0 text-[10.5px] font-semibold text-ink-500">比分</span>
          )}
          <ScoreBoard teams={state.teams} maxScoreToWin={state.maxScoreToWin} />
          <span className="ml-auto truncate text-right text-[10px] text-ink-400">
            {state.maxScoreToWin > 0 ? `先取 ${state.maxScoreToWin} 人头者胜 · 无限复活` : '团队混战'}
          </span>
        </div>
      ) : null}

      {/* ---------- 主体：左顺序表 · 中地图 · 右功能按钮 ---------- */}
      <div className="relative flex min-h-0 flex-1 gap-1 p-1">
        <SoloQueue
          queue={state.queue}
          charByGuid={state.charByGuid}
          playerGuid={state.playerGuid}
          currentActorGuid={state.currentActorGuid}
          playerDP={state.playerDP}
          onInspect={inspect}
        />

        <section className="relative flex min-w-0 flex-1 flex-col gap-1">
          {state.map ? (
            <SoloMap
              map={state.map}
              charByGuid={state.charByGuid}
              playerGuid={state.playerGuid}
              currentActorGuid={state.currentActorGuid}
              decision={state.decision}
              pickedGrids={pickedGrids}
              pickedTargets={pickedTargets}
              preview={preview}
              onToggleGrid={toggleGrid}
              onToggleTarget={toggleTarget}
              onInspect={inspect}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12.5px] text-ink-400">等待地图数据…</div>
          )}
          {player ? <PlayerHud c={player} /> : null}
          {mapPickBar}
          <SoloTurnBanner
            hasDecision={hasDecision}
            decisionDeadline={state.decisionDeadline}
            aiEscalated={state.aiEscalated}
            paused={state.paused}
            round={state.round}
          />
        </section>

        {/* 右侧统一功能按钮列：随时调出 / 关闭小窗 */}
        <nav className="flex w-[44px] shrink-0 flex-col gap-1.5 rounded-xl border border-ink-800/10 bg-parchment-200/55 p-1">
          <RailButton
            icon="⚔"
            label="操作"
            active={drawer === 'action'}
            badge={hasDecision && drawer !== 'action'}
            onClick={() => setDrawer((d) => (d === 'action' ? null : 'action'))}
          />
          <RailButton icon="📜" label="日志" active={drawer === 'log'} onClick={() => setDrawer((d) => (d === 'log' ? null : 'log'))} />
          <RailButton icon="👥" label="队伍" active={drawer === 'team'} onClick={() => setDrawer((d) => (d === 'team' ? null : 'team'))} />
          <div className="mt-auto flex flex-col items-center gap-1 pt-1 text-center text-[9px] leading-tight text-ink-400">
            <span className="font-mono">{state.log.length}</span>
            <span>行日志</span>
          </div>
        </nav>
      </div>

      {/* ---------- 右侧小窗：操作 ---------- */}
      {drawer === 'action' ? (
        <SoloFloatingPanel
          title="操作"
          subtitle={player ? `★ ${player.displayName}` : '等待你的回合'}
          onClose={() => setDrawer(null)}
          bodyClassName="flex min-h-0 flex-col p-0"
        >
          <SoloActionPanel
            decision={state.decision}
            player={player}
            skillIntent={skillIntent}
            playerDP={state.playerDP}
            paused={state.paused}
            currentActorGuid={state.currentActorGuid}
            decisionDeadline={state.decisionDeadline}
            onPreview={setPreview}
            onSubmit={submit}
            onCancel={cancelDecision}
            pickFooter={<div className="flex items-center justify-end gap-2">{pickButtons}</div>}
          />
        </SoloFloatingPanel>
      ) : null}

      {/* ---------- 右侧小窗：日志 ---------- */}
      {drawer === 'log' ? (
        <SoloFloatingPanel
          title="战斗日志"
          subtitle={`第 ${state.round} 回合 · 共 ${state.log.length} 行`}
          onClose={() => setDrawer(null)}
          bodyClassName="flex min-h-0 flex-col p-2.5"
        >
          <SoloLog log={state.log} round={state.round} />
        </SoloFloatingPanel>
      ) : null}

      {/* ---------- 右侧小窗：队伍 ---------- */}
      {drawer === 'team' ? (
        <SoloFloatingPanel
          title="参战角色"
          subtitle={`${state.characters.filter((c) => !c.isEliminated && c.hp > 0).length} 人存活 / 共 ${state.characters.length} 人`}
          onClose={() => setDrawer(null)}
        >
          <SoloRoster characters={state.characters} playerGuid={state.playerGuid} />
        </SoloFloatingPanel>
      ) : null}

      {/* ---------- 角色详情模态窗 ---------- */}
      {detailChar ? (
        <SoloCharDetail
          character={detailChar}
          isPlayer={detailChar.guid === state.playerGuid}
          isCurrentActor={detailChar.guid === state.currentActorGuid}
          onClose={() => setDetailGuid(null)}
        />
      ) : null}

      {/* ---------- 开局选角色：居中浮层 ---------- */}
      {payload?.kind === 'SelectCharacter' ? (
        <SoloActionPanel
          mode="modal"
          decision={state.decision}
          player={player}
          skillIntent="all"
          decisionDeadline={state.decisionDeadline}
          onSubmit={submit}
          onCancel={cancelDecision}
        />
      ) : null}

      {/* ---------- 设置 ---------- */}
      {modal === 'settings' ? (
        <SoloModal
          title="设置"
          subtitle={`对局 #${state.gameId ?? '—'}`}
          icon="⚙"
          onClose={() => setModal(null)}
          footer={
            <>
              {state.conn !== 'open' ? (
                <button
                  onClick={() => void game.connect()}
                  className="rounded-xl border border-amber-600/50 bg-amber-500/15 px-3.5 py-2 text-[12.5px] font-medium text-amber-700 hover:bg-amber-500/25"
                >
                  ⟳ 重新连接
                </button>
              ) : null}
              <button
                onClick={() => setModal(null)}
                className="rounded-xl border border-ink-400/30 bg-parchment-200/70 px-4 py-2 text-[12.5px] text-ink-600 hover:bg-parchment-300/70"
              >
                关闭
              </button>
            </>
          }
        >
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['回合', `${state.round}`],
                  ['用时', `${state.totalTime.toFixed(1)} 秒`],
                  ['连接', conn.label],
                  ['日志', `${state.log.length} 行`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-800/10 bg-parchment-100/60 px-2.5 py-2">
                  <div className="text-[10px] text-ink-400">{k}</div>
                  <div className="font-mono text-[12.5px] font-semibold text-ink-700">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-ink-800/10 bg-parchment-100/60 px-2.5 py-2">
              <div className="text-[10px] text-ink-400">引擎地址</div>
              <div className="break-all font-mono text-[11.5px] text-ink-700">{baseUrl}</div>
            </div>
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
              断线或决策超时后，服务端会把你的角色交给 AI 代打；重新连上后在本回合结束后自动夺回控制权。
            </div>
            <button
              onClick={() => {
                setModal(null)
                setModal('end')
              }}
              className="w-full rounded-xl border border-horde-500/40 bg-horde-500/10 px-3 py-2 text-[12.5px] font-medium text-horde-600 hover:bg-horde-500/20"
            >
              ⏹ 终止当前对局
            </button>
          </div>
        </SoloModal>
      ) : null}

      {/* ---------- 终止确认 ---------- */}
      {modal === 'end' ? (
        <SoloModal
          title="终止对局"
          tone="red"
          icon="⚠"
          onClose={() => setModal(null)}
          footer={
            <>
              <button
                onClick={() => setModal(null)}
                className="rounded-xl border border-ink-400/30 bg-parchment-200/70 px-4 py-2 text-[12.5px] text-ink-600 hover:bg-parchment-300/70"
              >
                再想想
              </button>
              <button
                onClick={() => {
                  setModal(null)
                  setDetailGuid(null)
                  setDrawer(null)
                  game.end()
                  setView('setup')
                }}
                className="rounded-xl border border-horde-500/50 bg-horde-500/90 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-horde-500"
              >
                终止对局
              </button>
            </>
          }
        >
          <p className="text-[12.5px] leading-relaxed text-ink-700">
            将立即结束当前对局并断开与引擎的连接，本局进度不会保留。
            <br />
            如需保留对局，请改用顶栏左侧的「返回」（对局会在后台继续，可随时回到对局）。
          </p>
        </SoloModal>
      ) : null}

      {/* ---------- 结算 ---------- */}
      {state.finished && state.ranking ? (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-ink-900/60 p-3 backdrop-blur-[2px]">
          <div className="panel solo-pop flex max-h-full w-[min(460px,96vw)] flex-col overflow-hidden rounded-2xl">
            <div className="shrink-0 bg-gradient-to-r from-gold-500/90 to-transparent px-4 py-3">
              <div className="font-fantasy text-[17px] font-bold tracking-wider text-white drop-shadow">🏆 对局结算</div>
              <div className="text-[11.5px] text-amber-100/90">
                共 {state.round} 回合 · {state.totalTime.toFixed(1)} 秒
                {state.winnerName ? ` · 胜者：${state.winnerName}` : ''}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              {state.ranking.map((r) => (
                <div
                  key={r.guid}
                  className={`rounded-xl border px-2.5 py-2 ${
                    r.isWinner
                      ? 'border-gold-500/60 bg-gold-300/20'
                      : r.isPlayer
                        ? 'border-gold-500/40 bg-parchment-100/70'
                        : 'border-ink-800/10 bg-parchment-100/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-center text-[13px]">
                      {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : <span className="text-[11px] text-ink-400">{r.rank}</span>}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${r.isPlayer ? 'text-gold-700' : 'text-ink-700'}`}>
                      {r.isPlayer ? '★ ' : ''}
                      {r.displayName}
                      {r.isWinner ? <span className="ml-1 text-[10px] font-normal text-gold-600">胜者</span> : null}
                    </span>
                    <span className="shrink-0 font-mono text-[13px] font-bold text-ink-800">{Math.round(r.rating)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-8 font-mono text-[10px] text-ink-500">
                    <span>击杀 {r.kills}</span>
                    <span>死亡 {r.deaths}</span>
                    <span>助攻 {r.assists}</span>
                    <span>伤害 {Math.round(r.totalDamage)}</span>
                    <span>治疗 {Math.round(r.totalHeal)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-ink-800/10 px-3 py-2.5">
              <button
                onClick={() => {
                  game.end()
                  setView('setup')
                }}
                className="rounded-xl border border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 px-4 py-2 text-[12.5px] font-bold text-white shadow-sm hover:brightness-110"
              >
                ⚔ 再开一局
              </button>
              <button
                onClick={() => {
                  game.end()
                  setView('setup')
                }}
                className="rounded-xl border border-ink-400/25 bg-parchment-200/60 px-3.5 py-2 text-[12.5px] text-ink-600 hover:bg-parchment-300/60"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
