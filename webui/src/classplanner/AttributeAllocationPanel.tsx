// 核心属性分配面板：1 级初始分配（30 点 + 3.0 成长，受模板上下限）与 4 / 9 级数值提升（9 点 + 0.9 成长，不受限）
// 小字注：额度与校验口径对齐内核 ClassAttributeBudget / ClassAttributeLimit 与 EquilibriumConstant
import { useMemo, useState } from 'react'
import { allocateInitial, describeAllocation, initialLimitOf, takeNumericBoost, type PlanAction } from './engine'
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

/** 通用分配编辑器：6 个输入 + 实时余额 + 额度校验 */
function AllocationEditor({ title, badge, badgeClass, hint, budget, limit, disabled, submitLabel, onSubmit }: EditorProps) {
  const [allocation, setAllocation] = useState<AttributeAllocation>(emptyAllocation())
  const points = allocationPoints(allocation)
  const growth = allocationGrowth(allocation)
  const check = useMemo(() => checkAllocation(allocation, budget, limit), [allocation, budget, limit])
  const remainPoints = budget.attributePoints - points
  const remainGrowth = budget.growthPoints - growth
  const isEmpty = points <= 0 && growth <= 0
  const canSubmit = !disabled && check.ok && !isEmpty

  const setField = (key: keyof AttributeAllocation, raw: string) => {
    const value = Number(raw)
    setAllocation(prev => ({ ...prev, [key]: Number.isFinite(value) ? Math.max(0, value) : 0 }))
  }

  return (
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
            title={disabled ? '当前不可用' : isEmpty ? '请至少分配 1 点' : check.ok ? '' : check.error}
            onClick={() => { onSubmit(allocation); setAllocation(emptyAllocation()) }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  plan: PlanState
  onAction: (r: PlanAction) => void
  hasClasses: boolean
}

/** 属性分配总面板：初始分配 + 数值提升 */
export default function AttributeAllocationPanel({ plan, onAction, hasClasses }: Props) {
  const limit = useMemo(() => initialLimitOf(plan), [plan])
  const applied = plan.appliedAttribute

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
            onSubmit={a => onAction(allocateInitial(plan, a))}
          />
          <AllocationEditor
            title="数值提升（4 / 9 级）"
            badge={`${RULES.numericBoostBudget.attributePoints} 点 + ${RULES.numericBoostBudget.growthPoints} 成长 · 不受限`}
            badgeClass="bg-amber-100 text-amber-600"
            hint="路线图 4 / 9 级档位发放，可替代被动选择；任意分配到三项属性与成长，不受模板上下限约束。"
            budget={RULES.numericBoostBudget}
            limit={null}
            disabled={plan.numericBoosts < 1}
            submitLabel={plan.numericBoosts > 0 ? `兑换（剩 ${plan.numericBoosts}）` : '无可用次数'}
            onSubmit={a => onAction(takeNumericBoost(plan, a))}
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
