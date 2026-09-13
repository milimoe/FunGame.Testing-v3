import { useState } from 'react'
import type { SoloCharacterDto } from '../game/soloTypes'
import { SoloModal } from './SoloFloatingPanel'
import { fmt } from './soloFormat'

// ============================================================================
// 角色详情模态窗：点击地图上的棋子（或行动顺序表 / 队伍列表里的条目）打开。
// 地图格子寸土寸金，血条只能给个大概；完整数值、状态、技能与物品说明都在这里。
//
// 交互（2026-09-12 增补）：
//   · 「全部属性」可收缩块：力量 / 敏捷 / 智力 / 攻防 / 暴击 / 穿透 / 射程 … 全量数值
//   · 「装备栏」可收缩块：点装备名展开物品描述，再点一次收起；点另一件则切换描述
//   · 状态效果同样可点：点一下看效果描述，再点收起 / 切换
// ============================================================================

interface SoloCharDetailProps {
  character: SoloCharacterDto
  /** 是否玩家自己 */
  isPlayer: boolean
  /** 是否是当前行动者 */
  isCurrentActor: boolean
  onClose: () => void
}

const STATE_LABEL: Record<string, string> = {
  Actionable: '待行动',
  Idle: '待机',
  Waiting: '等待',
  Dead: '已阵亡',
  Eliminated: '已淘汰',
}

function shortName(c: SoloCharacterDto): string {
  const src = c.nickName || c.name || '?'
  return [...src][0] ?? '?'
}

function StatRow({
  label,
  value,
  max,
  color,
  track,
  showMax = true,
}: {
  label: string
  value: number
  max: number
  color: string
  track: string
  showMax?: boolean
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[10px] font-bold" style={{ color }}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: track }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-[74px] shrink-0 text-right font-mono text-[11px] text-ink-600">
        {Math.round(value)}
        {showMax ? <span className="text-ink-400">/{Math.round(max)}</span> : null}
      </span>
    </div>
  )
}

/** 可收缩区块的抬头 */
function SectionHead({
  title,
  count,
  open,
  onToggle,
  hint,
}: {
  title: string
  count?: string
  open: boolean
  onToggle: () => void
  hint?: string
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-ink-800/10 bg-parchment-100/70 px-2.5 py-1.5 transition-colors hover:bg-parchment-300/50"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`text-[10px] text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-[11.5px] font-semibold text-ink-700">{title}</span>
        {count ? <span className="text-[10px] text-ink-400">{count}</span> : null}
      </span>
      <span className="shrink-0 text-[10px] text-ink-400">{hint ?? (open ? '收起' : '展开')}</span>
    </button>
  )
}

export default function SoloCharDetail({ character: c, isPlayer, isCurrentActor, onClose }: SoloCharDetailProps) {
  const dead = c.isEliminated || c.hp <= 0
  const activeSkills = c.skills.filter((s) => s.isActive)
  const usableSkills = activeSkills.filter((s) => s.usable)
  const usableItems = c.items.filter((i) => i.usable)

  const [openAttr, setOpenAttr] = useState(false)
  const [openEquip, setOpenEquip] = useState(true)
  const [equipDetail, setEquipDetail] = useState<string | null>(null)
  const [effectDetail, setEffectDetail] = useState<string | null>(null)

  const attrEntries = Object.entries(c.attributes ?? {})
  const equipments = c.equipments ?? []
  const effects = c.effects ?? []

  const teamLabel = c.teamName ? c.teamName : isPlayer ? '我的角色' : '对手'
  const teamTone = isPlayer && !c.teamName ? 'gold' : c.teamName && c.teamName.includes('蓝') ? 'blue' : 'red'

  return (
    <SoloModal
      title={c.displayName}
      subtitle={`Lv.${c.level} · ${teamLabel} · ${dead ? '已阵亡' : (STATE_LABEL[c.state] ?? c.state)}`}
      tone={teamTone === 'blue' ? 'blue' : teamTone === 'red' ? 'red' : 'gold'}
      onClose={onClose}
      icon={isPlayer ? '★' : dead ? '☠' : '⚔'}
    >
      <div className="space-y-3">
        {/* 概要 */}
        <div className="flex items-center gap-3">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[24px] font-bold shadow-sm"
            style={{
              backgroundColor: dead ? '#6b7280' : c.teamName ? (c.teamName.includes('蓝') ? '#2563eb' : '#dc2626') : isPlayer ? '#d4a838' : '#dc2626',
              color: '#fff',
              boxShadow: `0 0 0 2px ${c.teamName ? (c.teamName.includes('蓝') ? '#1d4ed8' : '#7f1d1d') : isPlayer ? '#8a5f12' : '#7f1d1d'}`,
            }}
          >
            {shortName(c)}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-ink-800/8 px-1.5 py-[1px] text-[10px] text-ink-600">{c.name}</span>
              {c.nickName && c.nickName !== c.name ? (
                <span className="rounded-md bg-ink-800/8 px-1.5 py-[1px] text-[10px] text-ink-500">「{c.nickName}」</span>
              ) : null}
              {c.teamName ? (
                <span
                  className={`rounded-md px-1.5 py-[1px] text-[10px] font-semibold ${
                    c.teamName.includes('蓝') ? 'bg-alliance-500/15 text-alliance-700' : 'bg-horde-500/15 text-horde-700'
                  }`}
                >
                  {c.teamName}
                  {isPlayer ? '（己方）' : ''}
                </span>
              ) : null}
              {isCurrentActor && !dead ? (
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-[1px] text-[10px] font-medium text-emerald-700">当前行动</span>
              ) : null}
              {dead ? <span className="rounded-md bg-ink-800/10 px-1.5 py-[1px] text-[10px] text-ink-500">已阵亡</span> : null}
              {c.isAI ? <span className="rounded-md bg-alliance-500/12 px-1.5 py-[1px] text-[10px] text-alliance-600">AI</span> : null}
            </div>
            <div className="space-y-1">
              <StatRow label="HP" value={c.hp} max={c.maxHP} color={dead ? '#9ca3af' : '#dc2626'} track="rgba(220,38,38,0.12)" />
              <StatRow label="MP" value={c.mp} max={c.maxMP} color={c.maxMP > 0 ? '#2563eb' : '#cbd5e1'} track="rgba(37,99,235,0.12)" />
              <StatRow label="EP" value={c.ep} max={c.maxEP} color="#b8862e" track="rgba(184,134,46,0.15)" />
            </div>
          </div>
        </div>

        {/* 基础信息 */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            ['移动', `${c.mov}`],
            ['攻击', `${c.atr}`],
            ['站位', c.gridId >= 0 ? `#${c.gridId}` : '未上场'],
            ['物品', `${usableItems.length}/${c.items.length}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-ink-800/10 bg-parchment-100/60 px-2 py-1.5 text-center">
              <div className="text-[9.5px] text-ink-400">{k}</div>
              <div className="font-mono text-[12.5px] font-semibold text-ink-700">{v}</div>
            </div>
          ))}
        </div>

        {/* ---------- 全部属性（可收缩） ---------- */}
        <div className="space-y-1.5">
          <SectionHead
            title="全部属性"
            count={`${attrEntries.length} 项`}
            open={openAttr}
            onToggle={() => setOpenAttr((v) => !v)}
            hint={openAttr ? '收起' : '力量 / 敏捷 / 智力 …'}
          />
          {openAttr ? (
            attrEntries.length === 0 ? (
              <div className="px-1 text-[11px] text-ink-400">服务端未下发属性数据</div>
            ) : (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {attrEntries.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-2 rounded-lg border border-ink-800/10 bg-parchment-100/50 px-2 py-1">
                    <span className="shrink-0 text-[10.5px] text-ink-500">{k}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-right font-mono text-[10.5px] text-ink-700">{v}</span>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>

        {/* ---------- 装备栏（可收缩 + 名称可点开描述） ---------- */}
        <div className="space-y-1.5">
          <SectionHead
            title="装备栏"
            count={`${equipments.length} 件`}
            open={openEquip}
            onToggle={() => setOpenEquip((v) => !v)}
            hint={openEquip ? '点装备名看描述' : '展开'}
          />
          {openEquip ? (
            equipments.length === 0 ? (
              <div className="px-1 text-[11px] text-ink-400">该角色没有装备</div>
            ) : (
              <div className="space-y-1.5">
                {equipments.map((e) => {
                  const on = equipDetail === e.guid
                  return (
                    <div key={e.guid} className={`rounded-xl border px-2.5 py-1.5 transition-all ${on ? 'border-gold-500/60 bg-gold-300/15' : 'border-ink-800/10 bg-parchment-100/60'}`}>
                      <button onClick={() => setEquipDetail((g) => (g === e.guid ? null : e.guid))} className="flex w-full items-center gap-1.5 text-left">
                        <span className="shrink-0 rounded-md bg-ink-800/8 px-1.5 py-[1px] text-[10px] text-ink-500">{e.slotLabel}</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-800">{e.name}</span>
                        {e.weaponTypeName ? <span className="shrink-0 text-[10px] text-ink-400">{e.weaponTypeName}</span> : null}
                        <span className={`shrink-0 text-[10px] transition-transform ${on ? 'rotate-90 text-gold-600' : 'text-ink-400'}`}>›</span>
                      </button>
                      {on ? (
                        <p className="mt-1 whitespace-pre-wrap border-t border-ink-800/10 pt-1 text-[11px] leading-relaxed text-ink-600">
                          {e.description || '该装备没有描述'}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          ) : null}
        </div>

        {/* ---------- 状态效果（可点开描述） ---------- */}
        {effects.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[10.5px] font-medium text-ink-500">状态效果（{effects.length}）· 点击查看描述</div>
            <div className="flex flex-wrap gap-1">
              {effects.map((e, i) => {
                const key = `${e.name}-${i}`
                const on = effectDetail === key
                return (
                  <button
                    key={key}
                    onClick={() => setEffectDetail((k) => (k === key ? null : key))}
                    className={`rounded-md border px-1.5 py-[2px] text-[10.5px] transition-all ${
                      on
                        ? 'border-purple-500/60 bg-purple-500/25 text-purple-800'
                        : e.isDebuff
                          ? 'border-horde-500/35 bg-horde-500/10 text-horde-700'
                          : 'border-purple-500/30 bg-purple-500/10 text-purple-700'
                    }`}
                  >
                    {e.isDebuff ? '▼ ' : '▲ '}
                    {e.name}
                    {e.remainDurationTurn > 0 ? ` (${e.remainDurationTurn}回合)` : e.remainDuration > 0 ? ` (${fmt(e.remainDuration)}s)` : ''}
                  </button>
                )
              })}
            </div>
            {effectDetail ? (
              (() => {
                const idx = Number(effectDetail.split('-').pop())
                const e = effects[idx]
                if (!e) return null
                return (
                  <div className={`rounded-xl border px-2.5 py-2 ${e.isDebuff ? 'border-horde-500/40 bg-horde-500/8' : 'border-purple-500/40 bg-purple-500/8'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-bold text-ink-800">{e.name}</span>
                      <span className="rounded-md bg-ink-800/8 px-1 py-[1px] font-mono text-[10px] text-ink-500">{e.effectType}</span>
                      <span className={`rounded-md px-1 py-[1px] text-[10px] ${e.isDebuff ? 'bg-horde-500/15 text-horde-700' : 'bg-purple-500/15 text-purple-700'}`}>
                        {e.isDebuff ? '减益' : '增益'}
                      </span>
                      {e.isDurative ? (
                        <span className="font-mono text-[10px] text-ink-500">
                          {e.remainDurationTurn > 0 ? `剩余 ${e.remainDurationTurn} 回合` : e.remainDuration > 0 ? `剩余 ${fmt(e.remainDuration)} 秒` : '持续中'}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-600">{e.description || '该状态没有描述'}</p>
                  </div>
                )
              })()
            ) : null}
          </div>
        ) : null}

        {/* 技能 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10.5px] font-medium text-ink-500">技能（可用 {usableSkills.length} / 共 {activeSkills.length}）</span>
          </div>
          <div className="space-y-1.5">
            {activeSkills.length === 0 ? <div className="text-[11px] text-ink-400">无主动技能</div> : null}
            {activeSkills.map((s) => {
              const tag = s.isSuperSkill ? '爆发' : s.isMagic ? '魔法' : '战技'
              const tagColor = s.isSuperSkill ? '#9333ea' : s.isMagic ? '#2563eb' : '#a3741f'
              return (
                <div
                  key={s.guid}
                  className={`rounded-xl border px-2.5 py-1.5 ${
                    s.usable ? 'border-gold-500/30 bg-parchment-100/70' : 'border-ink-400/15 bg-ink-800/5 opacity-70'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded-md px-1.5 py-[1px] text-[10px] font-bold text-white" style={{ backgroundColor: tagColor }}>
                      {tag}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${s.usable ? 'text-ink-800' : 'text-ink-500'}`}>
                      {s.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-ink-800/8 px-1 py-[1px] font-mono text-[10px] text-ink-500">Lv.{s.level}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-500">
                    <span className="text-amber-700">{s.castAnywhere ? '射程 全图' : `射程 ${s.castRange}`}</span>
                    {s.realMPCost > 0 ? <span className="text-alliance-600">{fmt(s.realMPCost)} MP</span> : null}
                    {s.realEPCost > 0 ? <span className="text-gold-600">{fmt(s.realEPCost)} EP</span> : null}
                    {s.realCD > 0 ? <span>CD {fmt(s.realCD)}</span> : null}
                    {s.currentCD > 0 ? <span className="text-horde-600">冷却中 {fmt(s.currentCD)}</span> : null}
                    <span>
                      目标：
                      {[s.canSelectEnemy ? '敌方' : null, s.canSelectTeammate ? '友方' : null, s.canSelectSelf ? '自身' : null]
                        .filter(Boolean)
                        .join('/') || '—'}
                    </span>
                  </div>
                  {s.description ? <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-500">{s.description}</p> : null}
                  {!s.usable && s.unusableReason ? (
                    <p className="mt-1 text-[10.5px] font-medium text-horde-600">不可用：{s.unusableReason}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {/* 物品 */}
        <div>
          <div className="mb-1 text-[10.5px] font-medium text-ink-500">物品（可用 {usableItems.length} / 共 {c.items.length}）</div>
          <div className="space-y-1.5">
            {c.items.length === 0 ? <div className="text-[11px] text-ink-400">无物品</div> : null}
            {c.items.map((i) => (
              <div
                key={i.guid}
                className={`rounded-xl border px-2.5 py-1.5 ${
                  i.usable ? 'border-parchment-500/50 bg-parchment-200/50' : 'border-ink-400/15 bg-ink-800/5 opacity-70'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-700">{i.name}</span>
                  {i.castRange > 0 ? <span className="shrink-0 font-mono text-[10px] text-amber-700">{i.castAnywhere ? '全图' : `射程 ${i.castRange}`}</span> : null}
                  {i.remainUseTimes > 0 ? (
                    <span className="shrink-0 font-mono text-[10px] text-ink-500">剩余 ×{i.remainUseTimes}</span>
                  ) : null}
                </div>
                {i.description ? <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-500">{i.description}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SoloModal>
  )
}
