// 核心属性分配面板：1 级初始分配（30 点 + 3.0 成长，受模板上下限）与 4 / 9 级数值提升（9 点 + 0.9 成长，不受限）
// 小字注：额度与校验口径对齐内核 ClassAttributeBudget / ClassAttributeLimit 与 EquilibriumConstant
import { useEffect, useMemo, useState } from 'react'
import { allocateInitial, describeAllocation, initialLimitOf, takeNumericBoost, type PlanAction } from './engine'
import { classIdName } from './catalog'
import type { ServerRoute } from './api'
import {
  RULES,
  allocationGrowth,
  allocationPoints,
  checkAllocation,
  emptyAllocation,
  type AttributeAllocation,
  type AttributeBudget,
  type AttributeLimit,
  type PlanState,
} from './types'

const FIELDS: Array<{ key: keyof AttributeAllocation; label: string; step: number }> = [
  { key: 'STR', label: '力量', step: 1 },
  { key: 'AGI', label: '敏捷', step: 1 },
  { key: 'INT', label: '智力', step: 1 },
  { key: 'STRGrowth', label: '力量成长', step: 0.1 },
  { key: 'AGIGrowth', label: '敏捷成长', step: 0.1 },
  { key: 'INTGrowth', label: '智力成长', step: 0.1 },
]

/** 把限值渲染成可读文本（null 表示不限） */
function describeLimit(limit: AttributeLimit | null): string {
  if (!limit) return '无上下限（职业未配置模板限值）'
  const parts: string[] = []
  const push = (name: string, min?: number, max?: number) => {
    if (min === undefined && max === undefined) return
    const range = min === undefined ? `≤${max}` : max === undefined ? `≥${min}` : `${min}~${max}`
    parts.push(`${name}${range}`)
  }
  push('力量', limit.STRMin, limit.STRMax)
  push('敏捷', limit.AGIMin, limit.AGIMax)
  push('智力', limit.INTMin, limit.INTMax)
  push('力量成长', limit.STRGrowthMin, limit.STRGrowthMax)
  push('敏捷成长', limit.AGIGrowthMin, limit.AGIGrowthMax)
  push('智力成长', limit.INTGrowthMin, limit.INTGrowthMax)
  return parts.length ? parts.join(' · ') : '无上下限'
}

interface EditorProps {
  title: string
  badge: string
  badgeClass: string
  hint: string
  budget: AttributeBudget
  limit: AttributeLimit | null
  disabled: boolean
  submitLabel: string
  onSubmit: (allocation: AttributeAllocation) => void
}

/** 通用分配编辑器：6 个输入 + 实时余额 + 额度校验 + 未用完额度的二次确认 */
function AllocationEditor({ title, badge, badgeClass, hint, budget, limit, disabled, submitLabel, onSubmit }: EditorProps) {
  const [allocation, setAllocation] = useState<AttributeAllocation>(emptyAllocation())
  /** 额度未用完时的二次确认弹窗（自绘控件，不使用原生 confirm） */
  const [confirming, setConfirming] = useState(false)
  const points = allocationPoints(allocation)
  const growth = allocationGrowth(allocation)
  const check = useMemo(() => checkAllocation(allocation, budget, limit), [allocation, budget, limit])
  const remainPoints = budget.attributePoints - points
  const remainGrowth = budget.growthPoints - growth
  const isEmpty = points <= 0 && growth <= 0
  const canSubmit = !disabled && check.ok && !isEmpty
  /** 额度是否有剩余（属性点或成长任一未用满） */
  const hasRemainder = remainPoints > 1e-9 || remainGrowth > 1e-9

  const setField = (key: keyof AttributeAllocation, raw: string) => {
    const value = Number(raw)
    setAllocation(prev => ({ ...prev, [key]: Number.isFinite(value) ? Math.max(0, value) : 0 }))
  }

  const doSubmit = () => {
    onSubmit(allocation)
    setAllocation(emptyAllocation())
    setConfirming(false)
  }
  /** 点提交：额度用完直接提交，否则先弹二次确认 */
  const requestSubmit = () => {
    if (!canSubmit) return
    if (hasRemainder) {
      setConfirming(true)
      return
    }
    doSubmit()
  }

  // 编辑器不可用时收起弹窗；弹窗打开时支持 Esc 关闭
  useEffect(() => {
    if (disabled) setConfirming(false)
  }, [disabled])
  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  return (
    <>
      <div className={`pp-card p-4 transition-opacity ${disabled ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-rose-500">{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>{badge}</span>
        <span className="pp-note ml-auto">
          余额 属性 <b className={remainPoints < 0 ? 'text-rose-500' : 'text-emerald-600'}>{remainPoints}</b> / 成长{' '}
          <b className={remainGrowth < 0 ? 'text-rose-500' : 'text-emerald-600'}>{remainGrowth.toFixed(1)}</b>
        </span>
      </div>
      <p className="pp-note mb-2">{hint}</p>
      <p className="pp-note mb-2">模板限值：{budget.limited ? describeLimit(limit) : '不受限（可任意分配）'}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FIELDS.map(f => (
          <label key={f.key} className="flex items-center justify-between gap-2 rounded-lg border border-rose-100 px-2.5 py-1.5">
            <span className="text-xs text-slate-500">{f.label}</span>
            <input
              type="number"
              min={0}
              step={f.step}
              value={allocation[f.key]}
              disabled={disabled}
              onChange={e => setField(f.key, e.target.value)}
              className="w-16 rounded-md border border-rose-200 px-1.5 py-0.5 text-right text-xs font-semibold text-rose-600 outline-none focus:border-rose-400 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${check.ok ? 'text-slate-400' : 'text-rose-500'}`}>
          {check.ok ? `已分配：${describeAllocation(allocation)}` : check.error}
        </span>
        <div className="flex gap-2">
          <button className="pp-btn !py-1" disabled={disabled || isEmpty} onClick={() => setAllocation(emptyAllocation())}>
            清空
          </button>
          <button
            className="pp-btn-primary !py-1"
            disabled={!canSubmit}
            title={disabled ? '当前不可用' : isEmpty ? '请至少分配 1 点' : check.ok ? (hasRemainder ? '额度未用完，提交前会二次确认' : '') : check.error}
            onClick={requestSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>

      {/* 未用完额度的二次确认：自绘控件（不使用原生 confirm），点遮罩或按 Esc 取消 */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-rose-100 bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-600">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-100 text-xs font-black">!</span>
              额度未用完，确认提交？
            </h3>
            <p className="pp-note mt-2">
              「{title}」还剩 <b className="text-amber-600">属性点 {remainPoints}</b> · <b className="text-amber-600">成长 {remainGrowth.toFixed(1)}</b> 未分配。
              提交后本档额度不会保留（每档只能领取一次），剩余部分将直接作废。
            </p>
            <div className="mt-3 space-y-1 rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-xs text-slate-600">
              <div>本次分配：{describeAllocation(allocation)}</div>
              <div className="text-slate-500">本档额度：{budget.attributePoints} 点属性 + {budget.growthPoints} 成长（{budget.limited ? '受模板上下限约束' : '不受限'}）</div>
              <div className="text-slate-500">已用额度：属性点 {points} · 成长 {growth.toFixed(1)}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="pp-btn !py-1" onClick={() => setConfirming(false)}>返回修改</button>
              <button className="pp-btn-primary !py-1" onClick={doSubmit}>确认提交（放弃剩余额度）</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}

interface Props {
  plan: PlanState
  /** 执行动作；route 非空时会同步到服务端（服务端权威） */
  onAction: (r: PlanAction, route?: ServerRoute) => void
  hasClasses: boolean
  /** 是否已在「已学技能管理」里选中「数值提升」（与被动互斥的共享份额） */
  numericArmed: boolean
  /** 数值提升提交成功后回调（用于取消选中态） */
  onNumericApplied: () => void
}

/** 属性分配总面板：初始分配 + 数值提升（数值提升需先在已学技能管理里选中，与被动互斥） */
export default function AttributeAllocationPanel({ plan, onAction, hasClasses, numericArmed, onNumericApplied }: Props) {
  const limit = useMemo(() => initialLimitOf(plan), [plan])
  const applied = plan.appliedAttribute
  /** 主职业（等级最高、同高取 id 最小）的 IdName：属性分配按职业记录记账 */
  const mainClassIdName = useMemo(() => {
    const sorted = Object.entries(plan.classes).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    const first = sorted[0]?.[0]
    return first === undefined ? '' : classIdName(Number(first)) ?? ''
  }, [plan.classes])
  const boostBudget = plan.numericBoostBudget ?? RULES.numericBoostBudget
  /** 与被动严格互斥：同一份 4 / 9 级份额，被动用尽就不能再兑换数值提升 */
  const boostExhausted = plan.numericBoosts < 1 || plan.pendingPassiveChoices < 1
  const boostDisabled = boostExhausted || !numericArmed

  return (
    <div className="space-y-3">
      {!hasClasses && (
        <div className="pp-card p-6 text-center text-sm text-slate-400">请先在第 ① 步选择职业与流派，之后才能分配初始核心属性</div>
      )}
      {hasClasses && (
        <>
          <AllocationEditor
            title="1 级初始分配"
            badge={`${RULES.initialBudget.attributePoints} 点 + ${RULES.initialBudget.growthPoints} 成长 · 受限`}
            badgeClass="bg-rose-100 text-rose-600"
            hint="职业起手的核心属性与成长倾向，可在额度内自由分配到力量 / 敏捷 / 智力及其成长，但需落在职业模板上下限内。"
            budget={RULES.initialBudget}
            limit={limit}
            disabled={!plan.initialAllocationAvailable}
            submitLabel={plan.initialAllocationAvailable ? '确认初始分配' : '已领取'}
            onSubmit={a => onAction(allocateInitial(plan, a), { kind: 'allocate', classId: mainClassIdName, allocation: a, initial: true })}
          />
          <AllocationEditor
            title="数值提升（4 / 9 级 · 与被动互斥）"
            badge={`${boostBudget.attributePoints} 点 + ${boostBudget.growthPoints} 成长 · 不受限${plan.numericBoostBudget ? ' · 路线图自带' : ''}`}
            badgeClass="bg-amber-100 text-amber-600"
            hint={boostExhausted
              ? '暂无可用份额：4 / 9 级发放的是同一份「被动或数值提升」份额（互斥，取其一），被动选择权用尽后就不能再兑换数值提升。'
              : numericArmed
                ? `已选中 1 次份额，请在额度内任意分配到三项属性与成长（不受模板上下限约束），提交即消耗 1 次份额（当前剩余 ${plan.pendingPassiveChoices} 次，与被动共用）。`
                : '请先在上方【已学技能管理】点击「数值提升」选中份额 —— 它与被动互斥，选中后此处才可用。'}
            budget={boostBudget}
            limit={null}
            disabled={boostDisabled}
            submitLabel={boostExhausted ? '无可用份额' : numericArmed ? `兑换数值提升（剩 ${plan.pendingPassiveChoices}）` : '请先选中「数值提升」'}
            onSubmit={a => {
              const r = takeNumericBoost(plan, a)
              onAction(r, { kind: 'allocate', classId: mainClassIdName, allocation: a, initial: false })
              if (r.ok) onNumericApplied()
            }}
          />
        </>
      )}
      <div className="pp-card p-3">
        <h3 className="mb-1 text-xs font-bold text-slate-500">累计已分配属性</h3>
        <p className="text-xs text-slate-600">{describeAllocation(applied)}</p>
        <p className="pp-note mt-1">洗点会把这里的全部分配从角色初始属性与成长上精确扣回（对齐内核 Revoke）。</p>
      </div>
    </div>
  )
}
