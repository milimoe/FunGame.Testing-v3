import { useEffect, useState } from 'react'
import type { SoloCharacterDto, SoloDecisionReply, SoloDecisionRequest } from '../../game/soloTypes'

interface SoloDecisionProps {
  decision: SoloDecisionRequest | null
  player: SoloCharacterDto | null
  /** 提交决策（不同 kind 的 payload 见各 UI） */
  onSubmit: (payload: SoloDecisionReply, intent?: SkillIntent) => void
  onCancel: () => void
  /** modal=居中浮层（仅开局选角色用）；dock=底部停靠栏（回合内决策，不遮挡战场信息） */
  mode?: 'modal' | 'dock'
  /** 技能意图：由行动按钮传入，用于过滤后续技能列表 */
  skillIntent?: SkillIntent
}

const KIND_LABEL: Record<string, string> = {
  SelectCharacter: '选择角色',
  ActionType: '选择行动',
  Skill: '选择技能',
  Item: '选择物品',
  Targets: '选择目标',
  Inquiry: '询问',
  Continue: '继续',
}

/** 通用按钮 */
function Btn({
  children,
  onClick,
  disabled,
  variant = 'ghost',
  className = '',
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  className?: string
  title?: string
}) {
  const base =
    'rounded-xl border px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40'
  const look =
    variant === 'primary'
      ? 'border-gold-600/60 bg-gradient-to-b from-gold-400 to-gold-600 text-white shadow-sm hover:brightness-110'
      : variant === 'danger'
        ? 'border-horde-500/50 bg-horde-500/90 text-white hover:bg-horde-500'
        : 'border-ink-400/25 bg-parchment-200/60 text-ink-700 hover:bg-parchment-300/60'
  return (
    <button className={`${base} ${look} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

function ModalShell({ title, tone, onCancel, children, canCancel = true, footer }: {
  title: React.ReactNode
  tone?: 'gold' | 'blue' | 'red' | 'violet'
  onCancel?: () => void
  children: React.ReactNode
  canCancel?: boolean
  footer?: React.ReactNode
}) {
  const toneBar =
    tone === 'blue' ? 'from-alliance-500/80' : tone === 'red' ? 'from-horde-500/80' : tone === 'violet' ? 'from-purple-500/80' : 'from-gold-500/90'
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && canCancel) onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canCancel, onCancel])
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-[2px]">
      <div className="panel flex max-h-full w-[min(560px,94vw)] flex-col overflow-hidden rounded-2xl">
        <div className={`shrink-0 bg-gradient-to-r ${toneBar} to-transparent px-4 py-2.5`}>
          <div className="font-fantasy text-[15px] font-bold tracking-wide text-white drop-shadow">{title}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink-800/10 px-3.5 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}

/** 角色选择（开局） */
function CharacterSelect({ options, onSubmit }: {
  options: { guid: string; id: number; displayName: string; info: string }[]
  onSubmit: (guid: string) => void
}) {
  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-500">
        共有 {options.length} 名候选角色（10 名随机抽选）。选择后其余 9 名将作为 AI 对手，地图上与你进行混战。
      </p>
      <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
        {options.map((o, i) => (
          <button
            key={o.guid}
            onClick={() => onSubmit(o.guid)}
            className="group flex flex-col items-center gap-1 rounded-xl border border-ink-800/10 bg-parchment-100/60 p-2.5 transition-all hover:-translate-y-0.5 hover:border-gold-500/60 hover:bg-gold-300/15 hover:shadow-md"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-gold-400 to-gold-600 text-lg font-bold text-white shadow group-hover:scale-105">
              {[...(o.displayName.replace(/^Lv\.\d+\s*/, '') || '?')][0]}
            </span>
            <span className="text-center text-[12px] font-semibold leading-tight text-ink-800">
              {o.displayName.replace(/^Lv\.\d+\s*/, '')}
            </span>
            <span className="text-center text-[9.5px] leading-tight text-ink-400">{o.info?.slice(0, 60)}</span>
            <span className="mt-0.5 rounded-full bg-ink-800/5 px-2 py-[1px] text-[9.5px] text-ink-500">编号 {i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 技能意图：引擎的 PreCastSkill 分支会把「战技 / 魔法 / 爆发技」放在同一个列表里，
 * 之后由 skill.SkillType == SuperSkill 自行分流为 CastSkill / CastSuperSkill。
 * 因此玩家端一律发送 PreCastSkill（发 CastSkill / CastSuperSkill 会绕过选技能流程导致崩溃），
 * 这里仅用 intent 在客户端过滤后续技能列表。
 */
export type SkillIntent = 'all' | 'normal' | 'super'

/** 行动类型选择 */
function ActionTypeSelect({ payload, player, onSubmit }: {
  payload: Extract<SoloDecisionRequest['payload'], { kind: 'ActionType' }>
  player: SoloCharacterDto | null
  onSubmit: (actionType: string, intent: SkillIntent) => void
}) {
  const anyUsableSkill = payload.skills.some((s) => s.usable && !s.isSuperSkill)
  const anyUsableSuper = payload.skills.some((s) => s.usable && s.isSuperSkill)
  const anyUsableItem = payload.items.some((i) => i.usable)
  const dp = payload.dp

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-[12px] text-ink-600">
        <span className="font-semibold text-gold-700">★ {player?.displayName ?? '你'} 的回合</span>
        {dp && (
          <span className="rounded-full bg-gold-300/20 px-2.5 py-0.5 font-mono text-[11px] text-gold-700">
            DP {dp.current}/{dp.max}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Btn variant="primary" className="!py-3" onClick={() => onSubmit('Move', 'all')}>
          🏃 移动
        </Btn>
        <Btn variant="primary" className="!py-3" onClick={() => onSubmit('NormalAttack', 'all')}>
          ⚔ 普通攻击
        </Btn>
        <Btn
          variant="primary"
          className="!py-3"
          disabled={!anyUsableSkill}
          title={anyUsableSkill ? '施放战技 / 魔法（统一发送 PreCastSkill，由引擎按技能类型分流）' : '没有可用技能'}
          onClick={() => onSubmit('PreCastSkill', 'normal')}
        >
          ✨ 战技 / 魔法
        </Btn>
        <Btn
          variant="primary"
          className="!py-3"
          disabled={!anyUsableSuper}
          title={anyUsableSuper ? '施放爆发技（消耗 EP，统一发送 PreCastSkill）' : '没有可用爆发技'}
          onClick={() => onSubmit('PreCastSkill', 'super')}
        >
          💥 爆发技
        </Btn>
        <Btn variant="primary" className="!py-3" disabled={!anyUsableItem} title={anyUsableItem ? '使用物品' : '没有可用物品'} onClick={() => onSubmit('UseItem', 'all')}>
          🎒 物品
        </Btn>
        <Btn variant="ghost" className="!py-3" onClick={() => onSubmit('EndTurn', 'all')}>
          ⏭ 结束回合
        </Btn>
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-400">
        提示：选择移动后地图会高亮可移动格子；战技 / 魔法 / 爆发技均走同一套「吟唱」流程（PreCastSkill），
        由引擎按技能类型自动分流，选中条目后再挑目标。
      </p>
    </div>
  )
}

/** 可选条目列表（技能 / 物品） */
function EntryList({ entries, onPick, header }: {
  entries: { guid: string; name: string; usable: boolean; reason: string; meta: string; tag: string; tagColor: string }[]
  onPick: (guid: string) => void
  header: string
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] text-ink-500">{header}</p>
      <div className="flex max-h-[48vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {entries.length === 0 && <div className="py-6 text-center text-[12px] text-ink-400">没有可用的条目</div>}
        {entries.map((e) => (
          <button
            key={e.guid}
            disabled={!e.usable}
            onClick={() => onPick(e.guid)}
            title={e.usable ? undefined : e.reason}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
              e.usable
                ? 'border-gold-500/35 bg-parchment-100/70 hover:-translate-y-px hover:border-gold-500/70 hover:bg-gold-300/15 hover:shadow-sm'
                : 'cursor-not-allowed border-ink-400/15 bg-ink-800/5 opacity-55'
            }`}
          >
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: e.tagColor, color: '#fff' }}
            >
              {e.tag}
            </span>
            <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${e.usable ? 'text-ink-800' : 'text-ink-400 line-through'}`}>
              {e.name}
            </span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-500">{e.meta}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 目标选择（含多目标） */
function TargetsSelect({ payload, onSubmit, onCancel, player }: {
  payload: Extract<SoloDecisionRequest['payload'], { kind: 'Targets' }>
  onSubmit: (guids: string[]) => void
  onCancel: () => void
  player: SoloCharacterDto | null
}) {
  const multi = payload.maxTargets > 1
  const [sel, setSel] = useState<string[]>([])

  const toggle = (guid: string) => {
    if (!multi) {
      onSubmit([guid])
      return
    }
    setSel((prev) => (prev.includes(guid) ? prev.filter((g) => g !== guid) : prev.length < payload.maxTargets ? [...prev, guid] : prev))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] text-ink-600">
        <span>
          为 <b className="text-gold-700">「{payload.skillName || '技能'}」</b> 选择目标（最多 {payload.maxTargets} 个）
        </span>
        <span className="text-ink-400">{player?.displayName}</span>
      </div>
      <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
        {payload.targets.map((t) => {
          const picked = sel.includes(t.guid)
          return (
            <button
              key={t.guid}
              onClick={() => toggle(t.guid)}
              className={`rounded-xl border p-2 text-left transition-all ${
                picked
                  ? 'border-alliance-500/80 bg-alliance-500/15 shadow-sm'
                  : 'border-horde-500/30 bg-parchment-100/60 hover:border-horde-500/60'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-horde-500 text-[11px] font-bold text-white">
                  {[...(t.displayName.replace(/^Lv\.\d+\s*/, '') || '?')][0]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-800">
                  {t.displayName.replace(/^Lv\.\d+\s*/, '')}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-ink-800/10">
                  <div
                    className="h-full rounded-full bg-horde-500"
                    style={{ width: `${Math.min(100, (t.hp / Math.max(1, t.maxHp)) * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] text-ink-500">{Math.round(t.hp)}</span>
              </div>
            </button>
          )
        })}
      </div>
      {payload.targets.length === 0 && <div className="py-6 text-center text-[12px] text-ink-400">范围内没有可选目标</div>}
      {multi && (
        <div className="mt-3 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onCancel}>取消</Btn>
          <Btn variant="primary" disabled={sel.length === 0} onClick={() => onSubmit(sel)}>
            确认（已选 {sel.length}）
          </Btn>
        </div>
      )}
    </div>
  )
}

/** 询问（抉择/数字/文本） */
function InquirySelect({ payload, onSubmit, onCancel }: {
  payload: Extract<SoloDecisionRequest['payload'], { kind: 'Inquiry' }>
  onSubmit: (v: { choices?: string[]; number?: number; text?: string; cancel?: boolean }) => void
  onCancel: () => void
}) {
  const type = payload.inquiryType
  const isMulti = type === 'MultipleChoice'
  const [sel, setSel] = useState<string[]>(payload.defaultChoice ? [payload.defaultChoice] : [])
  const [num, setNum] = useState<number>(payload.defaultNumber ?? 0)
  const [text, setText] = useState('')

  if (type === 'NumberInput') {
    return (
      <div>
        <p className="mb-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700">{payload.description || payload.topic}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={payload.minNumber}
            max={payload.maxNumber}
            value={num}
            onChange={(e) => setNum(Number(e.target.value))}
            className="w-40 rounded-xl border border-ink-400/30 bg-white/70 px-3 py-2 text-[14px] text-ink-800 focus:border-gold-500"
          />
          <span className="text-[11px] text-ink-400">范围 {payload.minNumber} ~ {payload.maxNumber}</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {payload.canCancel && <Btn variant="ghost" onClick={onCancel}>取消</Btn>}
          <Btn variant="primary" onClick={() => onSubmit({ number: num })}>确定</Btn>
        </div>
      </div>
    )
  }

  if (type === 'TextInput') {
    return (
      <div>
        <p className="mb-3 whitespace-pre-wrap text-[13px] text-ink-700">{payload.description || payload.topic}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-ink-400/30 bg-white/70 px-3 py-2 text-[13px] text-ink-800 focus:border-gold-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          {payload.canCancel && <Btn variant="ghost" onClick={onCancel}>取消</Btn>}
          <Btn variant="primary" onClick={() => onSubmit({ text })}>确定</Btn>
        </div>
      </div>
    )
  }

  // Choice / MultipleChoice / BinaryChoice / 兜底
  return (
    <div>
      <p className="mb-1 text-[14px] font-semibold text-ink-800">{payload.topic}</p>
      {payload.description && <p className="mb-3 whitespace-pre-wrap text-[12px] text-ink-500">{payload.description}</p>}
      <div className="flex max-h-[44vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {payload.choices.map((ch) => {
          const picked = sel.includes(ch.key)
          return (
            <button
              key={ch.key}
              onClick={() => (isMulti ? setSel((p) => (p.includes(ch.key) ? p.filter((k) => k !== ch.key) : [...p, ch.key])) : onSubmit({ choices: [ch.key] }))}
              className={`rounded-xl border px-3 py-2 text-left text-[13px] transition-all ${
                picked ? 'border-alliance-500/80 bg-alliance-500/15' : 'border-ink-400/25 bg-parchment-100/60 hover:border-gold-500/50'
              }`}
            >
              {isMulti && <span className="mr-1.5">{picked ? '☑' : '☐'}</span>}
              {ch.text || ch.key}
            </button>
          )
        })}
      </div>
      {isMulti && (
        <div className="mt-3 flex justify-end gap-2">
          {payload.canCancel && <Btn variant="ghost" onClick={onCancel}>取消</Btn>}
          <Btn variant="primary" disabled={sel.length === 0} onClick={() => onSubmit({ choices: sel })}>确认</Btn>
        </div>
      )}
    </div>
  )
}

/** 主入口：按决策类型渲染（TargetGrid / TargetGrids 由地图组件就地处理，这里不弹窗） */
export default function SoloDecisionModal({
  decision,
  player,
  onSubmit,
  onCancel,
  mode = 'modal',
  skillIntent = 'all',
}: SoloDecisionProps) {
  const payload = decision?.payload
  const kind = payload?.kind

  if (!payload) return null
  if (kind === 'TargetGrid' || kind === 'TargetGrids') return null // 由地图处理

  let body: React.ReactNode = null
  let title: React.ReactNode = kind ? KIND_LABEL[kind] ?? kind : ''
  let tone: 'gold' | 'blue' | 'red' | 'violet' = 'gold'

  if (kind === 'SelectCharacter') {
    body = <CharacterSelect options={payload.characters} onSubmit={(g) => onSubmit({ characterGuid: g })} />
    tone = 'gold'
  } else if (kind === 'ActionType') {
    body = <ActionTypeSelect payload={payload} player={player} onSubmit={(t, intent) => onSubmit({ actionType: t }, intent)} />
    title = `⚔ 你的回合 · ${player?.displayName ?? ''}`
    tone = 'gold'
  } else if (kind === 'Skill') {
    // 按行动按钮的意图过滤（爆发技 / 战技·魔法）；若筛选后为空则退回全量，避免空列表卡死
    const superOnly = payload.skills.filter((s) => s.isSuperSkill)
    const normalOnly = payload.skills.filter((s) => !s.isSuperSkill)
    const list =
      skillIntent === 'super' ? (superOnly.length > 0 ? superOnly : payload.skills)
      : skillIntent === 'normal' ? (normalOnly.length > 0 ? normalOnly : payload.skills)
      : payload.skills
    body = (
      <EntryList
        header={skillIntent === 'super' ? '选择要施放的爆发技：' : '选择要施放的战技 / 魔法：'}
        entries={list.map((s) => ({
          guid: s.guid,
          name: s.name,
          usable: s.usable,
          reason: s.unusableReason,
          tag: s.isSuperSkill ? '爆发' : s.isMagic ? '魔法' : '战技',
          tagColor: s.isSuperSkill ? '#9333ea' : s.isMagic ? '#2563eb' : '#a3741f',
          meta: `${s.usable ? '' : s.unusableReason + ' · '}${s.realMPCost > 0 ? `${s.realMPCost}MP ` : ''}${s.realEPCost > 0 ? `${s.realEPCost}EP ` : ''}${s.currentCD > 0 ? `CD${s.currentCD.toFixed(0)}` : ''}`,
        }))}
        onPick={(guid) => onSubmit({ skillGuid: guid })}
      />
    )
    title = `✨ 选择技能 · ${player?.displayName ?? ''}`
    tone = 'violet'
  } else if (kind === 'Item') {
    body = (
      <EntryList
        header="选择一个要使用的物品："
        entries={payload.items.map((i) => ({
          guid: i.guid,
          name: i.name,
          usable: i.usable,
          reason: i.unusableReason,
          tag: '物品',
          tagColor: '#5c4632',
          meta: `${i.usable ? '' : i.unusableReason + ' · '}${i.remainUseTimes > 0 ? `×${i.remainUseTimes}` : ''}`,
        }))}
        onPick={(guid) => onSubmit({ itemGuid: guid })}
      />
    )
    title = `🎒 选择物品 · ${player?.displayName ?? ''}`
    tone = 'gold'
  } else if (kind === 'Targets') {
    body = (
      <TargetsSelect
        payload={payload}
        player={player}
        onCancel={onCancel}
        onSubmit={(guids) => onSubmit({ targetGuids: guids })}
      />
    )
    title = `🎯 选择目标 · ${payload.skillName || ''}`
    tone = 'red'
  } else if (kind === 'Inquiry') {
    body = <InquirySelect payload={payload} onSubmit={(v) => onSubmit(v)} onCancel={onCancel} />
    title = `❓ ${payload.topic}`
    tone = 'blue'
  } else if (kind === 'Continue') {
    body = <p className="whitespace-pre-wrap text-[13px] text-ink-700">{payload.message}</p>
    title = '回合结束'
    tone = 'gold'
  } else {
    // 未知/新增决策类型：展示原始负载并提供取消，避免出现「空白弹层挡住操作」的死角
    body = (
      <div>
        <p className="mb-2 text-[12px] text-ink-500">未识别的决策类型：{String(kind ?? '(缺失)')}</p>
        <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-xl bg-ink-800/5 p-2 text-[11px] leading-relaxed text-ink-600">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    )
    title = '⚠ 未支持的决策'
    tone = 'blue'
  }

  // 可取消：技能 / 物品 / 目标选择，以及未知类型兜底（行动类型与开局选角色不可取消）
  const known = !!KIND_LABEL[kind ?? '']
  const canCancel = kind === 'Skill' || kind === 'Item' || kind === 'Targets' || !known
  const cancelBtn = canCancel ? (
    <Btn variant={known ? 'ghost' : 'danger'} onClick={onCancel}>{known ? '取消' : '取消该决策'}</Btn>
  ) : null

  // 停靠模式：底部操作栏，不遮挡地图与角色信息
  if (mode === 'dock') {
    return (
      <div className="shrink-0 rounded-xl border border-gold-500/40 bg-parchment-200/90 px-3 py-2 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-fantasy text-[13px] font-bold tracking-wide text-gold-700">{title}</span>
          <span className="flex shrink-0 items-center gap-2">{cancelBtn}</span>
        </div>
        <div className="max-h-[170px] overflow-y-auto pr-1">{body}</div>
      </div>
    )
  }

  return (
    <ModalShell
      title={title}
      tone={tone}
      canCancel={canCancel}
      onCancel={onCancel}
      footer={cancelBtn ? <div className="flex justify-end">{cancelBtn}</div> : undefined}
    >
      {body}
    </ModalShell>
  )
}
