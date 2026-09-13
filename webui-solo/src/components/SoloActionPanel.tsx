import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  SoloActionQuotaDto,
  SoloCharacterDto,
  SoloDecisionReply,
  SoloDecisionRequest,
  SoloDpDto,
  SoloItemDto,
  SoloSkillDto,
} from '../game/soloTypes'
import { SoloModal } from './SoloFloatingPanel'
import { fmt } from './soloFormat'
import { shapeLabel } from '../game/shape'

// ============================================================================
// 操作区（右侧「操作」小窗内容 / 开局选角色浮层）
//
// 交互约定（2026-09-12 二次调整）：
//   · 移动 / 普通攻击 —— 仍是「勾选 → 看详情 → 确认」两段式（这两个容易手滑，必须拦一道）
//   · 战技 / 魔法、爆发技、物品 —— **点一下就发出**，直接进入下一级菜单（技能列表 / 物品列表），
//     少一次点击；下级菜单里再「勾选 → 看详情 → 确认」。
//   · 不是自己的回合时，这里退化为「只读监视」：仍可翻阅自己的技能、物品与消耗，
//     但没有任何提交按钮。
//
// 射程配色（问题 2）：黄色 = 攻击距离 / 技能选取距离；绿色 = 移动距离。
// 地图上的高亮由 SoloPanel 汇总后交给 SoloMap 渲染。
//
// 引擎侧约定：战技 / 魔法 / 爆发技一律发送 PreCastSkill，由引擎按
// SkillType == SuperSkill 自行分流（发 CastSkill / CastSuperSkill 会绕过选技能流程）。
// 这里只用 intent 在客户端过滤后续技能列表。
// ============================================================================

export type SkillIntent = 'all' | 'normal' | 'super'

type ActionKey = 'Move' | 'NormalAttack' | 'Skill' | 'SuperSkill' | 'UseItem' | 'EndTurn'

const ACTION_ORDER: ActionKey[] = ['Move', 'NormalAttack', 'Skill', 'SuperSkill', 'UseItem', 'EndTurn']

/** 点击后立刻提交、直接进入下级菜单的行动类型（不需要确认） */
const ONE_TAP: ReadonlySet<ActionKey> = new Set<ActionKey>(['Skill', 'SuperSkill', 'UseItem'])

const ACTION_META: Record<ActionKey, { label: string; icon: string; engine: string; intent: SkillIntent; desc: string }> = {
  Move: {
    label: '移动',
    icon: '🏃',
    engine: 'Move',
    intent: 'all',
    desc: '在地图上移动。勾选后地图会亮出绿色可移动范围（受行动力 MOV 限制），再点选目标格子并确认。',
  },
  NormalAttack: {
    label: '普通攻击',
    icon: '⚔',
    engine: 'NormalAttack',
    intent: 'all',
    desc: '对单个敌人发起物理攻击，不消耗 MP。勾选后地图会亮出黄色攻击范围，点选目标棋子并确认。',
  },
  Skill: {
    label: '战技 / 魔法',
    icon: '✨',
    engine: 'PreCastSkill',
    intent: 'normal',
    desc: '施放战技或魔法：点一下直接进入技能列表，挑一个后看详情再确认（魔法需要吟唱）。',
  },
  SuperSkill: {
    label: '爆发技',
    icon: '💥',
    engine: 'PreCastSkill',
    intent: 'super',
    desc: '施放爆发技：点一下直接进入爆发技列表，挑一个后看详情再确认，主要消耗 EP。',
  },
  UseItem: {
    label: '物品',
    icon: '🎒',
    engine: 'UseItem',
    intent: 'all',
    desc: '使用背包物品：点一下直接进入物品列表，挑一件后看详情再确认。',
  },
  EndTurn: {
    label: '结束回合',
    icon: '⏭',
    engine: 'EndTurn',
    intent: 'all',
    desc: '放弃剩余行动，把回合交给行动顺序表上的下一个角色。未用完的决策点不会保留。',
  },
}

/** 行动类型 → 引擎配额键 */
const QUOTA_KEY: Partial<Record<ActionKey, string>> = {
  NormalAttack: 'NormalAttack',
  Skill: 'CastSkill',
  SuperSkill: 'CastSuperSkill',
  UseItem: 'UseItem',
}

/** 子列表里有条目但全都不可用（CD/资源不足等）：按钮保留入口，仅可进入查看详情 */
const VIEW_ONLY_HINT = '均不可用 · 仅可查看'

const KIND_TITLE: Record<string, string> = {
  SelectCharacter: '选择角色',
  ActionType: '选择行动',
  Skill: '选择技能',
  Item: '选择物品',
  Targets: '选择目标',
  TargetGrid: '选择格子',
  TargetGrids: '选择范围',
  Inquiry: '询问',
  Continue: '继续',
}

// ============================================================================
// 射程预演：交给 SoloPanel → SoloMap 去画黄/绿格
// ============================================================================
export interface SoloPreviewRange {
  /** 黄色：攻击 / 技能选取距离（格）；-1 = 全图 */
  attackRange?: number | null
  /** 绿色：移动距离（格） */
  moveRange?: number | null
  /** 射程圆心（施法者 / 当前所在格） */
  actorGridId: number
}

// ============================================================================
// 小工具
// ============================================================================

/** 取某个行动类型的配额信息（服务端已按引擎记账口径算好） */
function quotaFor(dp: SoloDpDto | null | undefined, key: string | undefined): SoloActionQuotaDto | null {
  if (!dp || !key) return null
  return (dp.quotas ?? []).find((q) => q.actionType === key) ?? null
}

/** 兼容老服务端：只有 ActionUsed 时退化为「已用 n 次」 */
function usedOnly(dp: SoloDpDto | null | undefined, key: string | undefined): number | null {
  if (!dp || !key || (dp.quotas ?? []).length > 0) return null
  const v = dp.actionUsed?.[key]
  return typeof v === 'number' ? v : null
}

/** 技能射程摘要：全图 / 单值 / 区间 */
function rangeSummary(list: { castRange: number; castAnywhere: boolean }[]): string | null {
  if (list.length === 0) return null
  if (list.some((s) => s.castAnywhere)) return '射程 全图'
  const nums = list.map((s) => s.castRange).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return min === max ? `射程 ${min}` : `射程 ${min}~${max}`
}

function skillTag(s: SoloSkillDto): { text: string; color: string } {
  if (s.isSuperSkill) return { text: '爆发', color: '#9333ea' }
  if (s.isMagic) return { text: '魔法', color: '#2563eb' }
  return { text: '战技', color: '#a3741f' }
}

function skillTargets(s: SoloSkillDto): string {
  const t = [s.canSelectEnemy ? '敌方' : null, s.canSelectTeammate ? '友方' : null, s.canSelectSelf ? '自身' : null].filter(Boolean)
  return t.length > 0 ? t.join('/') : '—'
}

/** 勾选指示器（radio / checkbox） */
function Tick({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border text-[11px] font-bold leading-none ${
        square ? 'rounded-[5px]' : 'rounded-full'
      } ${on ? 'border-gold-600 bg-gold-500 text-white' : 'border-ink-400/40 bg-white/60 text-transparent'}`}
    >
      ✓
    </span>
  )
}

/** 可勾选行（技能 / 物品 / 目标 / 选项 共用）
 *  disabled = 完全不可点；locked = 置灰但仍可点击（查看详情用，确认按钮会另行拦住） */
function PickRow({
  selected,
  disabled,
  locked,
  onClick,
  tag,
  tagColor,
  name,
  hint,
  meta,
  square,
  title,
}: {
  selected: boolean
  disabled?: boolean
  locked?: boolean
  onClick: () => void
  tag?: string
  tagColor?: string
  name: string
  hint?: string
  meta?: ReactNode
  square?: boolean
  title?: string
}) {
  const inactive = !!disabled || !!locked
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all ${
        disabled
          ? 'cursor-not-allowed border-ink-400/15 bg-ink-800/5 opacity-55'
          : locked
            ? 'border-ink-400/20 bg-ink-800/5 opacity-70 hover:border-gold-500/40'
            : selected
              ? 'border-gold-500/70 bg-gold-300/20 shadow-sm'
              : 'border-ink-400/20 bg-parchment-100/60 hover:border-gold-500/50 hover:bg-gold-300/10'
      }`}
    >
      <Tick on={selected} square={square} />
      {tag ? (
        <span className="shrink-0 rounded-md px-1.5 py-[1px] text-[10px] font-bold text-white" style={{ backgroundColor: tagColor }}>
          {tag}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] font-semibold ${inactive ? 'text-ink-400 line-through' : 'text-ink-800'}`}>{name}</span>
        {hint ? <span className="mt-[1px] block truncate text-[10.5px] leading-tight text-ink-400">{hint}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-right font-mono text-[10.5px] text-ink-500">{meta}</span> : null}
    </button>
  )
}

/** 详情卡：把当前勾选项的完整说明摊开给人看 */
function DetailCard({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'blue' | 'red' }) {
  const look =
    tone === 'red'
      ? 'border-horde-500/45 bg-horde-500/10'
      : tone === 'blue'
        ? 'border-alliance-500/40 bg-alliance-500/10'
        : 'border-gold-500/45 bg-gold-300/12'
  return <div className={`rounded-xl border px-2.5 py-2 ${look}`}>{children}</div>
}

function Kv({ items }: { items: (string | null | false)[] }) {
  const list = items.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (list.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-ink-500">
      {list.map((t, i) => (
        <span key={`${t}-${i}`}>{t}</span>
      ))}
    </div>
  )
}

/** 射程 / 配额小标签 */
function Chip({ tone, children }: { tone: 'attack' | 'move' | 'quota'; children: ReactNode }) {
  const look =
    tone === 'attack'
      ? 'border-amber-500/45 bg-amber-300/25 text-amber-800'
      : tone === 'move'
        ? 'border-emerald-500/40 bg-emerald-400/20 text-emerald-800'
        : 'border-ink-400/25 bg-ink-800/6 text-ink-500'
  return <span className={`rounded-md border px-1.5 py-[1px] font-mono text-[9.5px] leading-[13px] ${look}`}>{children}</span>
}

/** 配额标签：剩余 / 总数，用尽变红 */
function QuotaChip({ q, label }: { q: SoloActionQuotaDto; label?: string }) {
  const out = q.remaining <= 0
  return (
    <span
      className={`rounded-md border px-1.5 py-[1px] font-mono text-[9.5px] leading-[13px] ${
        out ? 'border-horde-500/45 bg-horde-500/12 text-horde-600' : 'border-emerald-500/40 bg-emerald-400/16 text-emerald-800'
      }`}
    >
      {label ? `${label} ` : ''}剩 {q.remaining}/{q.quota}
    </span>
  )
}

// ============================================================================
// 只读监视视图（不是自己回合时也能翻技能、物品）
// ============================================================================
function SkillCard({ s, open, onToggle }: { s: SoloSkillDto; open: boolean; onToggle: () => void }) {
  const t = skillTag(s)
  return (
    <div className="space-y-1">
      <PickRow
        selected={open}
        onClick={onToggle}
        tag={t.text}
        tagColor={t.color}
        name={s.name}
        hint={s.description ? s.description.split('\n')[0] : undefined}
        meta={
          <>
            {s.castAnywhere ? <div className="text-amber-700">射程 全图</div> : <div className="text-amber-700">射程 {s.castRange}</div>}
            {s.realMPCost > 0 ? <div className="text-alliance-600">{fmt(s.realMPCost)} MP</div> : null}
            {s.realEPCost > 0 ? <div className="text-gold-600">{fmt(s.realEPCost)} EP</div> : null}
            {s.currentCD > 0 ? <div className="text-horde-600">CD {fmt(s.currentCD, 0)}</div> : null}
          </>
        }
      />
      {open ? (
        <div className="ml-1">
          <DetailCard tone="blue">
            <Kv
              items={[
                `Lv.${s.level}`,
                s.realMPCost > 0 ? `MP ${fmt(s.realMPCost)}` : null,
                s.realEPCost > 0 ? `EP ${fmt(s.realEPCost)}` : null,
                s.realCD > 0 ? `冷却 ${fmt(s.realCD)} 回合` : null,
                s.castAnywhere ? '射程 全图' : `射程 ${s.castRange}`,
                `目标：${skillTargets(s)}`,
                s.usable ? null : `不可用：${s.unusableReason}`,
              ]}
            />
            <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">
              {s.description || '该技能没有描述'}
            </p>
          </DetailCard>
        </div>
      ) : null}
    </div>
  )
}

function ItemCard({ i, open, onToggle }: { i: SoloItemDto; open: boolean; onToggle: () => void }) {
  return (
    <div className="space-y-1">
      <PickRow
        selected={open}
        onClick={onToggle}
        tag="物品"
        tagColor="#5c4632"
        name={i.name}
        hint={i.description ? i.description.split('\n')[0] : undefined}
        meta={
          <>
            {i.castRange > 0 ? <div className="text-amber-700">{i.castAnywhere ? '射程 全图' : `射程 ${i.castRange}`}</div> : null}
            {i.remainUseTimes > 0 ? <div>×{i.remainUseTimes}</div> : null}
          </>
        }
      />
      {open ? (
        <div className="ml-1">
          <DetailCard>
            <Kv
              items={[
                i.itemType,
                i.remainUseTimes > 0 ? `剩余 ${i.remainUseTimes} 次` : null,
                i.castRange > 0 ? (i.castAnywhere ? '射程 全图' : `射程 ${i.castRange}`) : null,
                i.usable ? null : `不可用：${i.unusableReason}`,
              ]}
            />
            <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">
              {i.description || '该物品没有描述'}
            </p>
          </DetailCard>
        </div>
      ) : null}
    </div>
  )
}

/** 只读监视：翻自己的技能 / 物品，看消耗与射程，但不能提交任何东西 */
function MonitorView({
  player,
  dp,
  paused,
  currentActorGuid,
  onPreview,
}: {
  player: SoloCharacterDto | null
  dp: SoloDpDto | null
  paused?: boolean
  currentActorGuid?: string | null
  onPreview: (p: SoloPreviewRange | null) => void
}) {
  const [tab, setTab] = useState<'skill' | 'item'>('skill')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const skills = (player?.skills ?? []).filter((s) => s.isActive)
  const items = player?.items ?? []
  const isMyActor = !!player && player.guid === currentActorGuid

  // 监视模式下先把攻击距离（黄）亮出来，玩家一眼就知道自己够得着多远
  useEffect(() => {
    if (player && player.gridId >= 0) {
      onPreview({ attackRange: player.atr, moveRange: null, actorGridId: player.gridId })
    } else {
      onPreview(null)
    }
    return () => onPreview(null)
  }, [player, onPreview])

  if (!player) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
        <span className="text-[26px]">⏳</span>
        <p className="text-[12px] leading-relaxed text-ink-500">
          等待对局数据…
          <br />
          开局后这里会显示你的角色、技能与物品。
        </p>
      </div>
    )
  }

  const q = (key: string) => quotaFor(dp, key)

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-alliance-500/35 bg-alliance-500/8 px-2.5 py-2">
        <div className="text-[11.5px] font-bold text-alliance-700">
          {paused ? '⏸ 对局已暂停' : isMyActor ? '👀 正在行动的是你' : '👀 旁观中 · 不是你的回合'}
        </div>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">
          这里可以随时翻阅自己的技能、物品、射程与消耗；轮到你的回合时会自动切回可操作状态。
        </p>
      </div>

      {/* 基础射程 / 配额速览 */}
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="attack">攻击距离 {player.atr}</Chip>
        <Chip tone="move">移动距离 {player.mov}</Chip>
        {dp ? <Chip tone="quota">决策点 {dp.current}/{dp.max}</Chip> : null}
        {(['NormalAttack', 'CastSkill', 'PreCastSkill', 'CastSuperSkill', 'UseItem'] as const).map((k) => {
          const qq = q(k)
          return qq ? <QuotaChip key={k} q={qq} label={qq.label} /> : null
        })}
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ['skill', `技能 ${skills.length}`],
            ['item', `物品 ${items.length}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k)
              setOpenKey(null)
            }}
            className={`flex-1 rounded-xl border px-2 py-1.5 text-[11.5px] font-semibold transition-all ${
              tab === k ? 'border-gold-500/70 bg-gold-300/20 text-gold-700' : 'border-ink-400/20 bg-parchment-100/60 text-ink-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {tab === 'skill' ? (
          skills.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-ink-400">没有主动技能</div>
          ) : (
            skills.map((s) => (
              <SkillCard
                key={s.guid}
                s={s}
                open={openKey === s.guid}
                onToggle={() => setOpenKey((k) => (k === s.guid ? null : s.guid))}
              />
            ))
          )
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ink-400">没有物品</div>
        ) : (
          items.map((i) => (
            <ItemCard
              key={i.guid}
              i={i}
              open={openKey === i.guid}
              onToggle={() => setOpenKey((k) => (k === i.guid ? null : i.guid))}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 主面板
// ============================================================================

interface SoloActionPanelProps {
  decision: SoloDecisionRequest | null
  player: SoloCharacterDto | null
  skillIntent: SkillIntent
  /** panel = 右侧小窗内容；modal = 居中浮层（开局选角色） */
  mode?: 'panel' | 'modal'
  /** 不是自己回合 / 没有决策时的只读监视数据源 */
  playerDP?: SoloDpDto | null
  paused?: boolean
  currentActorGuid?: string | null
  /** 决策截止时间戳（ms），来自服务端下发的 timeoutMs；用于面板底部倒计时 */
  decisionDeadline?: number | null
  onSubmit: (payload: SoloDecisionReply, intent?: SkillIntent) => void
  onCancel: () => void
  /** 射程预演回调（黄色攻击 / 绿色移动），null = 清除 */
  onPreview?: (p: SoloPreviewRange | null) => void
  /** 地图勾选类决策（TargetGrid/Targets）的确认入口，由 SoloPanel 注入 */
  pickFooter?: ReactNode
}

interface DraftAction {
  k: 'action'
  key: ActionKey
}
interface DraftSkill {
  k: 'skill'
  guid: string
}
interface DraftItem {
  k: 'item'
  guid: string
}
interface DraftChoice {
  k: 'choice'
  keys: string[]
}
interface DraftNumber {
  k: 'number'
  value: number
}
interface DraftText {
  k: 'text'
  value: string
}
type Draft = DraftAction | DraftSkill | DraftItem | DraftChoice | DraftNumber | DraftText

export default function SoloActionPanel({
  decision,
  player,
  skillIntent,
  mode = 'panel',
  playerDP = null,
  paused = false,
  currentActorGuid = null,
  decisionDeadline = null,
  onSubmit,
  onCancel,
  onPreview,
  pickFooter,
}: SoloActionPanelProps) {
  const payload = decision?.payload
  const [draft, setDraft] = useState<Draft | null>(null)
  const requestKey = decision?.requestId ?? 'none'

  // ==================== 决策剩余时间（底部倒计时） ====================
  const [remain, setRemain] = useState<number | null>(null)
  useEffect(() => {
    if (decisionDeadline === null || !decision) {
      setRemain(null)
      return
    }
    const tick = () => setRemain(Math.max(0, Math.ceil((decisionDeadline - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [decisionDeadline, decision])

  // 每次新的决策请求都清空勾选（避免上一阶段的选择被误确认）
  useEffect(() => {
    const p = decision?.payload
    if (p?.kind === 'Inquiry') {
      if (p.inquiryType === 'NumberInput') return setDraft({ k: 'number', value: p.defaultNumber ?? 0 })
      if (p.inquiryType === 'TextInput') return setDraft({ k: 'text', value: '' })
      if (p.inquiryType === 'MultipleChoice') return setDraft({ k: 'choice', keys: p.defaultChoice ? [p.defaultChoice] : [] })
    }
    // 「选取全体」的技能/普攻：默认就替玩家把全部可选目标勾上（问题 3）
    if (p?.kind === 'Targets' && p.selectAll && p.targets.length > 0) {
      return setDraft({ k: 'choice', keys: p.targets.map((t) => t.guid) })
    }
    setDraft(null)
    // 仅在请求变化时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  // ==================== 各决策类型的正文 ====================
  const dp: SoloDpDto | null = payload && 'dp' in payload ? (payload.dp as SoloDpDto | null) : null

  const skillList = useMemo(() => {
    if (payload?.kind !== 'Skill') return []
    const supers = payload.skills.filter((s) => s.isSuperSkill)
    const normals = payload.skills.filter((s) => !s.isSuperSkill)
    if (skillIntent === 'super') return supers.length > 0 ? supers : payload.skills
    if (skillIntent === 'normal') return normals.length > 0 ? normals : payload.skills
    return payload.skills
  }, [payload, skillIntent])

  let title = payload ? (KIND_TITLE[payload.kind] ?? payload.kind) : '操作'
  let tone: 'gold' | 'blue' | 'red' | 'violet' = 'gold'
  let body: ReactNode = null
  let canCancel = false
  let confirmLabel = '确认'
  let confirmDisabled = !draft
  let onConfirm = () => undefined as void

  if (!payload) {
    // ---------- 没有决策 = 只读监视 ----------
    title = '监视操作'
    tone = 'blue'
    body = <MonitorView player={player} dp={playerDP} paused={paused} currentActorGuid={currentActorGuid} onPreview={onPreview ?? (() => {})} />
    confirmLabel = ''
    confirmDisabled = true
  } else if (payload.kind === 'SelectCharacter') {
    title = '选择出战角色'
    body = (
      <div>
        <p className="mb-2 text-[11.5px] leading-relaxed text-ink-500">
          共 {payload.characters.length} 名候选角色（随机抽选）。选中者由你操控；开局后你会被随机分到红蓝两队之一
          （己方恒显示为蓝色），率先拿到 10 个人头的队伍获胜。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {payload.characters.map((o, i) => {
            const picked = draft?.k === 'choice' && draft.keys[0] === o.guid
            const name = o.displayName.replace(/^Lv\.\d+\s*/, '')
            return (
              <button
                key={o.guid}
                onClick={() => setDraft({ k: 'choice', keys: [o.guid] })}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 transition-all ${
                  picked ? 'border-gold-500/80 bg-gold-300/20 shadow-md' : 'border-ink-800/10 bg-parchment-100/60 hover:border-gold-500/50'
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-gold-400 to-gold-600 text-[17px] font-bold text-white shadow">
                  {[...name][0] ?? '?'}
                </span>
                <span className="text-center text-[12px] font-semibold leading-tight text-ink-800">{name}</span>
                <span className="line-clamp-2 text-center text-[9.5px] leading-tight text-ink-400">{o.info}</span>
                <span className="rounded-full bg-ink-800/5 px-2 py-[1px] text-[9.5px] text-ink-500">编号 {i + 1}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
    canCancel = false
    confirmLabel = '确认出战'
    confirmDisabled = !(draft?.k === 'choice' && draft.keys.length > 0)
    onConfirm = () => {
      if (draft?.k === 'choice' && draft.keys[0]) onSubmit({ characterGuid: draft.keys[0] })
    }
  } else if (payload.kind === 'ActionType') {
    title = '选择行动'
    const anyUsableSkill = payload.skills.some((s) => s.usable && !s.isSuperSkill)
    const anyUsableMagic = payload.skills.some((s) => s.usable && s.isMagic)
    const anyUsableSuper = payload.skills.some((s) => s.usable && s.isSuperSkill)
    const anyUsableItem = payload.items.some((i) => i.usable)

    const normalSkills = payload.skills.filter((s) => !s.isSuperSkill && !s.isMagic)
    const magicSkills = payload.skills.filter((s) => s.isMagic)
    const superSkills = payload.skills.filter((s) => s.isSuperSkill)

    // 配额用尽 / 无可选项的行为直接禁用；「列表里有条目但全都不可用」时保留入口（仅可查看详情，无法确认）
    const quotaOf = (k: ActionKey) => quotaFor(dp, QUOTA_KEY[k])
    const exhausted = (k: ActionKey): string | null => {
      if (k === 'Move' || k === 'EndTurn') return null
      if (k === 'NormalAttack') return quotaOf(k)?.remaining === 0 ? '普通攻击次数已用尽' : null
      if (k === 'Skill') {
        if (normalSkills.length + magicSkills.length === 0) return '没有战技 / 魔法'
        return anyUsableSkill || anyUsableMagic ? null : VIEW_ONLY_HINT
      }
      if (k === 'SuperSkill') {
        if (superSkills.length === 0) return '没有爆发技'
        return anyUsableSuper ? null : VIEW_ONLY_HINT
      }
      if (k === 'UseItem') {
        if (payload.items.length === 0) return '没有物品'
        return anyUsableItem ? null : VIEW_ONLY_HINT
      }
      return null
    }

    const pickedKey = draft?.k === 'action' ? draft.key : null
    const meta = pickedKey ? ACTION_META[pickedKey] : null

    body = (
      <div className="space-y-2.5">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink-600">选择行动类型</span>
            <span className="text-[10px] text-ink-400">技能 / 爆发技 / 物品 一步直达</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ACTION_ORDER.map((k) => {
              const m = ACTION_META[k]
              const oneTap = ONE_TAP.has(k)
              const q = quotaOf(k)
              const used = usedOnly(dp, QUOTA_KEY[k])
              const reason = exhausted(k)
              const viewOnly = reason === VIEW_ONLY_HINT
              const blocked = !!reason && !viewOnly
              const picked = pickedKey === k
              return (
                <button
                  key={k}
                  disabled={blocked}
                  title={reason ?? m.desc}
                  onClick={() => {
                    if (blocked) return
                    if (oneTap) {
                      // 直接进入下级菜单：不经过确认
                      onSubmit({ actionType: m.engine }, m.intent)
                      return
                    }
                    setDraft({ k: 'action', key: k })
                  }}
                  className={`flex flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
                    blocked
                      ? 'cursor-not-allowed border-ink-400/15 bg-ink-800/5 opacity-55'
                      : picked
                        ? 'border-gold-500/80 bg-gradient-to-b from-gold-300/30 to-gold-500/10 shadow-md'
                        : 'border-ink-400/20 bg-parchment-100/60 hover:border-gold-500/55 hover:bg-gold-300/10'
                  }`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="text-[15px] leading-none">{m.icon}</span>
                    <span className={`min-w-0 flex-1 truncate text-[13px] font-bold ${blocked ? 'text-ink-400' : 'text-ink-800'}`}>{m.label}</span>
                    {oneTap && !blocked ? <span className="shrink-0 text-[10px] font-normal text-gold-600">›</span> : null}
                    {picked ? <span className="text-[11px] text-gold-600">●</span> : null}
                  </span>
                  {/* 射程（黄 = 攻击/施法，绿 = 移动）与配额 */}
                  <span className="flex w-full flex-wrap items-center gap-1">
                    {k === 'Move' ? <Chip tone="move">移动 {payload.mov ?? '?'}</Chip> : null}
                    {k === 'NormalAttack' ? <Chip tone="attack">攻击 {payload.atr ?? '?'}</Chip> : null}
                    {k === 'Skill' && rangeSummary([...normalSkills, ...magicSkills]) ? (
                      <Chip tone="attack">{rangeSummary([...normalSkills, ...magicSkills])}</Chip>
                    ) : null}
                    {k === 'SuperSkill' && rangeSummary(superSkills) ? <Chip tone="attack">{rangeSummary(superSkills)}</Chip> : null}
                    {k === 'UseItem' && rangeSummary(payload.items) ? <Chip tone="attack">{rangeSummary(payload.items)}</Chip> : null}
                    {k === 'Skill' ? (
                      <>
                        {quotaFor(dp, 'CastSkill') ? <QuotaChip q={quotaFor(dp, 'CastSkill')!} label="战技" /> : null}
                        {quotaFor(dp, 'PreCastSkill') ? <QuotaChip q={quotaFor(dp, 'PreCastSkill')!} label="魔法" /> : null}
                      </>
                    ) : q ? (
                      <QuotaChip q={q} />
                    ) : used !== null && used > 0 ? (
                      <Chip tone="quota">已用 {used} 次</Chip>
                    ) : null}
                    {reason ? (
                      <span className={`text-[9.5px] ${viewOnly ? 'text-ink-400' : 'text-horde-500'}`}>{reason}</span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {meta ? (
          <DetailCard>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] leading-none">{meta.icon}</span>
              <span className="text-[13px] font-bold text-ink-800">{meta.label}</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600">{meta.desc}</p>
          </DetailCard>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-400/30 px-2.5 py-2 text-center text-[11px] text-ink-400">
            移动 / 普通攻击需要勾选后确认；技能 / 爆发技 / 物品点一下直接进入列表
          </div>
        )}

        {/* 场上敌友速览（动态人数，问题 3） */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-horde-500/30 bg-horde-500/8 px-2 py-1.5">
            <div className="text-[10px] font-semibold text-horde-700">可选敌人 {payload.enemys?.length ?? 0}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-500">
              {(payload.enemyOptions ?? []).map((t) => t.displayName.replace(/^Lv\.\d+\s*/, '')).join(' / ') || '—'}
            </div>
          </div>
          <div className="rounded-xl border border-alliance-500/30 bg-alliance-500/8 px-2 py-1.5">
            <div className="text-[10px] font-semibold text-alliance-700">可选队友 {payload.teammates?.length ?? 0}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-500">
              {(payload.teammateOptions ?? []).map((t) => t.displayName.replace(/^Lv\.\d+\s*/, '')).join(' / ') || '—'}
            </div>
          </div>
        </div>
      </div>
    )
    canCancel = false
    // 只有「需要确认」的行动类型才会产生 draft
    confirmDisabled = !(draft?.k === 'action' && !ONE_TAP.has(draft.key))
    onConfirm = () => {
      if (draft?.k !== 'action') return
      const m = ACTION_META[draft.key]
      onSubmit({ actionType: m.engine }, m.intent)
    }
  } else if (payload.kind === 'Skill') {
    title = skillIntent === 'super' ? '选择爆发技' : '选择技能'
    tone = 'violet'
    const picked = draft?.k === 'skill' ? payload.skills.find((s) => s.guid === draft.guid) ?? null : null
    body = (
      <div className="space-y-2.5">
        <div className="text-[11px] text-ink-500">
          共 {skillList.length} 个技能 · 勾选后查看详情，确认后才进入选目标
          <span className="ml-1 text-ink-400">（冷却 / 资源不足的技能可勾选查看，但无法确认）</span>
        </div>
        <div className="space-y-1.5">
          {skillList.length === 0 ? <div className="py-6 text-center text-[12px] text-ink-400">没有可用技能</div> : null}
          {skillList.map((s) => {
            const t = skillTag(s)
            return (
              <PickRow
                key={s.guid}
                selected={picked?.guid === s.guid}
                locked={!s.usable}
                title={s.usable ? s.description || s.name : s.unusableReason}
                onClick={() => setDraft({ k: 'skill', guid: s.guid })}
                tag={t.text}
                tagColor={t.color}
                name={s.name}
                hint={s.description ? s.description.split('\n')[0] : undefined}
                meta={
                  <>
                    <div className="text-amber-700">{s.castAnywhere ? '射程 全图' : `射程 ${s.castRange}`}</div>
                    {s.realMPCost > 0 ? <div className="text-alliance-600">{fmt(s.realMPCost)} MP</div> : null}
                    {s.realEPCost > 0 ? <div className="text-gold-600">{fmt(s.realEPCost)} EP</div> : null}
                    {s.currentCD > 0 ? <div className="text-horde-600">CD {fmt(s.currentCD, 0)}</div> : null}
                  </>
                }
              />
            )
          })}
        </div>
        {picked ? (
          <DetailCard tone="blue">
            <div className="flex items-center gap-1.5">
              <span className="rounded-md px-1.5 py-[1px] text-[10px] font-bold text-white" style={{ backgroundColor: skillTag(picked).color }}>
                {skillTag(picked).text}
              </span>
              <span className="text-[13px] font-bold text-ink-800">{picked.name}</span>
              <span className="rounded-md bg-ink-800/8 px-1 py-[1px] font-mono text-[10px] text-ink-500">Lv.{picked.level}</span>
              {picked.usable ? null : (
                <span className="rounded-md bg-horde-500/15 px-1.5 py-[1px] text-[10px] font-semibold text-horde-600">
                  不可确认：{picked.unusableReason}
                </span>
              )}
            </div>
            <Kv
              items={[
                picked.realMPCost > 0 ? `MP ${fmt(picked.realMPCost)}` : null,
                picked.realEPCost > 0 ? `EP ${fmt(picked.realEPCost)}` : null,
                picked.realCD > 0 ? `冷却 ${fmt(picked.realCD)} 回合` : null,
                picked.currentCD > 0 ? `剩余 CD ${fmt(picked.currentCD, 0)} 回合` : null,
                picked.castAnywhere ? '射程 全图' : `射程 ${picked.castRange} 格`,
                `目标：${skillTargets(picked)}`,
                picked.usable ? null : `不可用原因：${picked.unusableReason}`,
              ]}
            />
            {picked.description ? (
              <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">{picked.description}</p>
            ) : (
              <p className="mt-1.5 text-[11.5px] text-ink-400">该技能没有描述</p>
            )}
          </DetailCard>
        ) : null}
      </div>
    )
    canCancel = true
    // 不可用的技能（CD / 资源不足等）可勾选看详情，但确认按钮拦住
    confirmDisabled = !picked || !picked.usable
    onConfirm = () => {
      if (draft?.k === 'skill' && picked?.usable) onSubmit({ skillGuid: draft.guid })
    }
  } else if (payload.kind === 'Item') {
    title = '选择物品'
    const picked = draft?.k === 'item' ? payload.items.find((i) => i.guid === draft.guid) ?? null : null
    body = (
      <div className="space-y-2.5">
        <div className="text-[11px] text-ink-500">
          共 {payload.items.length} 件物品 · 勾选后查看详情
          <span className="ml-1 text-ink-400">（不可用的物品可勾选查看，但无法确认）</span>
        </div>
        <div className="space-y-1.5">
          {payload.items.length === 0 ? <div className="py-6 text-center text-[12px] text-ink-400">没有可用物品</div> : null}
          {payload.items.map((i: SoloItemDto) => (
            <PickRow
              key={i.guid}
              selected={picked?.guid === i.guid}
              locked={!i.usable}
              title={i.usable ? i.description || i.name : i.unusableReason}
              onClick={() => setDraft({ k: 'item', guid: i.guid })}
              tag="物品"
              tagColor="#5c4632"
              name={i.name}
              hint={i.description ? i.description.split('\n')[0] : undefined}
              meta={
                <>
                  {i.castRange > 0 ? <div className="text-amber-700">{i.castAnywhere ? '射程 全图' : `射程 ${i.castRange}`}</div> : null}
                  {i.remainUseTimes > 0 ? <div>×{i.remainUseTimes}</div> : null}
                </>
              }
            />
          ))}
        </div>
        {picked ? (
          <DetailCard>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-ink-800">{picked.name}</span>
              {picked.usable ? null : (
                <span className="rounded-md bg-horde-500/15 px-1.5 py-[1px] text-[10px] font-semibold text-horde-600">
                  不可确认：{picked.unusableReason}
                </span>
              )}
            </div>
            <Kv
              items={[
                picked.itemType,
                picked.remainUseTimes > 0 ? `剩余 ${picked.remainUseTimes} 次` : null,
                picked.castRange > 0 ? (picked.castAnywhere ? '射程 全图' : `射程 ${picked.castRange} 格`) : null,
                picked.usable ? null : `不可用原因：${picked.unusableReason}`,
              ]}
            />
            <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">
              {picked.description || '该物品没有描述'}
            </p>
          </DetailCard>
        ) : null}
      </div>
    )
    canCancel = true
    // 不可用的物品可勾选看详情，但确认按钮拦住
    confirmDisabled = !picked || !picked.usable
    onConfirm = () => {
      if (draft?.k === 'item' && picked?.usable) onSubmit({ itemGuid: draft.guid })
    }
  } else if (payload.kind === 'Inquiry') {
    title = payload.topic || '询问'
    tone = 'blue'
    const type = payload.inquiryType
    if (type === 'NumberInput') {
      const value = draft?.k === 'number' ? draft.value : payload.defaultNumber ?? 0
      body = (
        <div className="space-y-2.5">
          {payload.description ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">{payload.description}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={payload.minNumber}
              max={payload.maxNumber}
              value={value}
              onChange={(e) => setDraft({ k: 'number', value: Number(e.target.value) })}
              className="w-28 rounded-xl border border-ink-400/30 bg-white/70 px-3 py-2 text-[15px] text-ink-800 focus:border-gold-500"
            />
            <span className="font-mono text-[11px] text-ink-400">
              范围 {payload.minNumber} ~ {payload.maxNumber}
            </span>
          </div>
        </div>
      )
      canCancel = payload.canCancel
      confirmDisabled = draft?.k !== 'number'
      onConfirm = () => {
        if (draft?.k === 'number') onSubmit({ number: draft.value })
      }
    } else if (type === 'TextInput') {
      const value = draft?.k === 'text' ? draft.value : ''
      body = (
        <div className="space-y-2.5">
          {payload.description ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">{payload.description}</p>
          ) : null}
          <textarea
            value={value}
            rows={3}
            onChange={(e) => setDraft({ k: 'text', value: e.target.value })}
            className="w-full rounded-xl border border-ink-400/30 bg-white/70 px-3 py-2 text-[13px] text-ink-800 focus:border-gold-500"
          />
        </div>
      )
      canCancel = payload.canCancel
      confirmDisabled = draft?.k !== 'text'
      onConfirm = () => {
        if (draft?.k === 'text') onSubmit({ text: draft.value })
      }
    } else {
      const isMulti = type === 'MultipleChoice'
      const keys = draft?.k === 'choice' ? draft.keys : []
      // 点击选项后，下方详情框显示该选项的完整描述（多选时显示最近点选的一项）
      const detailKey = isMulti ? keys[keys.length - 1] : keys[0]
      const detail = payload.choices.find((ch) => ch.key === detailKey)
      body = (
        <div className="space-y-2.5">
          {payload.description ? (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">{payload.description}</p>
          ) : null}
          <div className="space-y-1.5">
            {payload.choices.map((ch) => {
              const on = keys.includes(ch.key)
              return (
                <PickRow
                  key={ch.key}
                  square={isMulti}
                  selected={on}
                  onClick={() =>
                    isMulti
                      ? setDraft({ k: 'choice', keys: on ? keys.filter((k) => k !== ch.key) : [...keys, ch.key] })
                      : setDraft({ k: 'choice', keys: [ch.key] })
                  }
                  name={ch.key}
                  hint={ch.text ? ch.text.split('\n')[0] : undefined}
                />
              )
            })}
          </div>
          {detail && detail.text ? (
            <DetailCard tone="blue">
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-gold-500/20 px-1.5 py-[1px] text-[10px] font-bold text-gold-700">选项</span>
                <span className="text-[12.5px] font-bold text-ink-800">{detail.key}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">{detail.text}</p>
            </DetailCard>
          ) : null}
          {isMulti ? <p className="text-[10.5px] text-ink-400">可多选，已选 {keys.length} 项</p> : null}
        </div>
      )
      canCancel = payload.canCancel
      confirmDisabled = keys.length === 0
      onConfirm = () => {
        if (draft?.k === 'choice') onSubmit({ choices: draft.keys })
      }
    }
  } else if (payload.kind === 'Continue') {
    title = '准备继续'
    body = <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-700">{payload.message}</p>
    confirmLabel = '继续'
    confirmDisabled = false
    // 服务端只把该决策当作「看完日志再继续」的闸门，回执内容不参与后续计算
    onConfirm = () => onSubmit({ cancelled: false })
  } else if (payload.kind === 'Targets' || payload.kind === 'TargetGrid' || payload.kind === 'TargetGrids') {
    // 选目标 / 选格子是在地图上完成的，这里只做说明与兜底确认
    // 单独取出 Targets / TargetGrids 负载：判别联合在 `Targets|TargetGrid|TargetGrids` 下不会自动收窄成员
    const tPayload = payload.kind === 'Targets' ? payload : null
    const tGridsPayload = payload.kind === 'TargetGrids' ? payload : null
    const targets = tPayload?.targets ?? []
    const selectedKeys = draft?.k === 'choice' ? draft.keys : []
    body = (
      <div className="space-y-2.5">
        <DetailCard tone="blue">
          <div className="text-[12.5px] font-bold text-ink-800">
            {payload.kind === 'Targets' ? '请在地图上点选目标' : '请在地图上点选格子'}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600">
            {payload.kind === 'TargetGrid'
              ? `地图上绿色高亮的格子可以移动（移动距离 ${payload.moveRange ?? payload.mov ?? '?'}）。点选后按地图下方的「确认移动」提交。`
              : payload.kind === 'TargetGrids'
                ? `非指向性技能：在黄色施法范围内点选一个【中心格】，选中后地图会用紫色预览技能形状（${
                    shapeLabel(tGridsPayload?.shapeRangeType)
                  }${(tGridsPayload?.shapeRadius ?? 0) > 0 ? ` 半径${tGridsPayload?.shapeRadius}` : ''}）覆盖的区域，按「确认施放」提交。`
                : `为「${tPayload?.skillName || '技能'}」点选地图上的角色棋子，最多 ${tPayload?.maxTargets ?? 1} 个${
                    tPayload?.selectAll ? '（本技能为全体选取，已默认全选）' : ''
                  }。`}
          </p>
        </DetailCard>
        {targets.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[10.5px] text-ink-500">
              可选目标 <b className="text-ink-700">{targets.length}</b> 个
              {tPayload?.selectAll ? <span className="ml-1 text-emerald-700">· 已默认全选</span> : null}
            </div>
            {targets.map((t) => {
              const on = selectedKeys.includes(t.guid)
              const max = Math.max(1, tPayload?.maxTargets ?? 1)
              return (
                <button
                  key={t.guid}
                  onClick={() => {
                    const keys = draft?.k === 'choice' ? draft.keys : []
                    if (keys.includes(t.guid)) setDraft({ k: 'choice', keys: keys.filter((g) => g !== t.guid) })
                    else if (keys.length < max) setDraft({ k: 'choice', keys: [...keys, t.guid] })
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-all ${
                    on ? 'border-gold-500/70 bg-gold-300/20' : 'border-ink-800/10 bg-parchment-100/60 hover:border-gold-500/50'
                  }`}
                >
                  <Tick on={on} square />
                  {t.isSelf ? <span className="shrink-0 rounded bg-gold-500/20 px-1 text-[9px] text-gold-700">自己</span> : null}
                  {!t.isSelf && t.isTeammate ? (
                    <span className="shrink-0 rounded bg-alliance-500/15 px-1 text-[9px] text-alliance-700">队友</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700">{t.displayName}</span>
                  <span className="h-[5px] w-14 shrink-0 overflow-hidden rounded-full bg-horde-500/15">
                    <span
                      className="block h-full rounded-full bg-horde-500"
                      style={{ width: `${Math.min(100, (t.hp / Math.max(1, t.maxHp)) * 100)}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] text-ink-500">
                    {Math.round(t.hp)}/{Math.round(t.maxHp)}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    )
    canCancel = false
    confirmLabel = ''
    confirmDisabled = true
    onConfirm = () => undefined
  } else {
    title = '未支持的决策'
    body = (
      <div>
        <p className="mb-2 text-[12px] text-ink-500">未识别的决策类型：{String((payload as { kind?: string }).kind ?? '(缺失)')}</p>
        <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-xl bg-ink-800/5 p-2 text-[11px] leading-relaxed text-ink-600">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    )
    tone = 'blue'
    canCancel = false
    confirmLabel = ''
    confirmDisabled = true
  }

  // ==================== 射程预演同步给地图 ====================
  const previewActorGrid = useMemo(() => {
    if (!payload) return -1
    const g = (payload as { actorGridId?: number }).actorGridId
    if (typeof g === 'number' && g >= 0) return g
    return player && player.gridId >= 0 ? player.gridId : -1
  }, [payload, player])

  useEffect(() => {
    if (!onPreview) return
    // 没有决策 = 只读监视：预演由 MonitorView 自己按「攻击距离」下发，这里不要覆盖它
    if (!payload) return
    if (previewActorGrid < 0) {
      onPreview(null)
      return
    }
    // 地图勾选类决策由地图自己按 payload 画，不叠加预演
    if (payload.kind === 'Targets' || payload.kind === 'TargetGrid' || payload.kind === 'TargetGrids') {
      onPreview(null)
      return
    }
    let attackRange: number | null = null
    let moveRange: number | null = null

    if (payload.kind === 'ActionType') {
      // 攻击距离是角色的固有属性，进操作菜单就亮黄（问题 2：优先显示攻击距离）
      attackRange = payload.atr ?? null
      if (draft?.k === 'action' && draft.key === 'Move') moveRange = payload.mov ?? null
    } else if (payload.kind === 'Skill') {
      if (draft?.k === 'skill') {
        const s = payload.skills.find((x) => x.guid === draft.guid)
        if (s) attackRange = s.castAnywhere ? -1 : s.castRange
      }
    } else if (payload.kind === 'Item') {
      if (draft?.k === 'item') {
        const i = payload.items.find((x) => x.guid === draft.guid)
        if (i && i.castRange > 0) attackRange = i.castAnywhere ? -1 : i.castRange
      }
    }
    onPreview(attackRange === null && moveRange === null ? null : { attackRange, moveRange, actorGridId: previewActorGrid })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, draft, previewActorGrid])

  useEffect(() => () => onPreview?.(null), [onPreview])

  const mapPickMode = payload?.kind === 'Targets' || payload?.kind === 'TargetGrid' || payload?.kind === 'TargetGrids'

  // 当前所处阶段（抽屉抬头只有「操作」两个字，必须把阶段显性化，否则玩家不知道自己在选什么）
  const stageLabel =
    !payload ? '监视操作'
    : payload.kind === 'ActionType' ? '选择行动类型'
    : payload.kind === 'Skill' ? (skillIntent === 'super' ? '选择爆发技' : '选择技能')
    : payload.kind === 'Item' ? '选择物品'
    : payload.kind === 'Targets' ? '选择目标'
    : payload.kind === 'TargetGrid' ? '选择移动格子'
    : payload.kind === 'TargetGrids' ? '选择施放范围'
    : payload.kind === 'Inquiry' ? '询问'
    : payload.kind === 'Continue' ? '继续'
    : payload.kind === 'SelectCharacter' ? '选择出战角色' : null

  // 剩余时间提示：有待决策时显示倒计时；暂停时引擎不计时，显示暂停态
  const urgent = remain !== null && remain <= 10
  const timeChip =
    !payload ? null : paused ? (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-50/95 px-2 py-[2px] text-[11px] font-medium text-emerald-700">
        ⏸ 已暂停
      </span>
    ) : remain !== null ? (
      <span
        className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-[11px] font-medium tabular-nums ${
          urgent ? 'border-rose-400/60 bg-rose-50/95 text-rose-700' : 'border-emerald-400/60 bg-emerald-50/95 text-emerald-700'
        }`}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${urgent ? 'bg-rose-400' : 'bg-emerald-400'}`}
          />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${urgent ? 'bg-rose-500' : 'bg-emerald-500'}`} />
        </span>
        剩余 {remain}s
      </span>
    ) : null

  const footer = (
    <div className="flex items-center gap-2">
      {timeChip ?? <span className="min-w-0 flex-1" />}
      <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
        {canCancel ? (
          <button
            onClick={onCancel}
            className="rounded-xl border border-ink-400/30 bg-parchment-200/70 px-3.5 py-2 text-[12.5px] font-medium text-ink-600 hover:bg-parchment-300/70"
          >
            取消
          </button>
        ) : null}
        {confirmLabel ? (
          <button
            onClick={() => onConfirm()}
            disabled={confirmDisabled}
            className="rounded-xl border border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 px-5 py-2 text-[13px] font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        ) : null}
      </div>
    </div>
  )

  if (mode === 'modal') {
    return (
      <SoloModal title={title} tone={tone} onClose={onCancel} canClose={canCancel} footer={footer} icon="🎮">
        {body}
      </SoloModal>
    )
  }

  const headerDp: SoloDpDto | null = dp ?? playerDP ?? null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 抬头：先讲清楚「现在在选什么」，再给决策点 */}
      {player ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-800/10 px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11.5px] font-bold text-gold-700">
            {stageLabel ?? '操作'}
            <span className="ml-1.5 font-normal text-ink-400">★ {player.displayName}</span>
          </span>
          {headerDp ? (
            <span className="shrink-0 rounded-full bg-gold-300/20 px-2 py-[1px] font-mono text-[10.5px] text-gold-700">
              决策点 {headerDp.current}/{headerDp.max}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5">{body}</div>
      {mapPickMode && pickFooter ? <div className="shrink-0 border-t border-ink-800/10 p-2.5">{pickFooter}</div> : null}
      <div className="shrink-0 border-t border-ink-800/10 bg-parchment-200/40 p-2.5">{footer}</div>
    </div>
  )
}
