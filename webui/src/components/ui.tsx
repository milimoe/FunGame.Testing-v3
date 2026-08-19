import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { charColor, charName, fmt, type CharLike } from '../util'

// ===== 通用数据获取 Hook =====
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fn()
      .then(d => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, error, loading, refetch }
}

// ===== 卡片区块 =====
export function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-rose-100 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

// ===== 角色徽章（头像色块 + 昵称）=====
export function CharChip({ char, size = 'md' }: { char?: CharLike | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!char) return <span className="text-xs text-slate-400">未知角色</span>
  const guid = char.Guid ?? char.guid ?? ''
  const color = charColor(guid)
  const sizes = { sm: 'h-5 w-5 text-[10px]', md: 'h-7 w-7 text-xs', lg: 'h-9 w-9 text-sm' }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex ${sizes[size]} shrink-0 items-center justify-center rounded-full font-bold text-white ring-1 ring-white/60`}
        style={{ backgroundColor: color }}
      >
        {charName(char).slice(0, 1)}
      </span>
      <span className={size === 'lg' ? 'text-sm font-semibold text-slate-800' : 'text-xs text-slate-600'}>
        {charName(char)}
      </span>
    </span>
  )
}

// ===== 横向条形图（对比用）=====
export function HBar({
  label,
  value,
  max,
  color,
  format,
  labelWidth = 'w-24',
}: {
  label: string
  value: number
  max: number
  color?: string
  format?: (n: number) => string
  labelWidth?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className={`${labelWidth} shrink-0 truncate text-right text-xs text-slate-500`}>{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-rose-100">
        <div
          className="h-full rounded transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color ?? '#fb7185' }}
        />
      </div>
      <span className="w-28 shrink-0 text-left text-xs tabular-nums text-slate-500">
        {format ? format(value) : fmt(value, 0)}
      </span>
    </div>
  )
}

// ===== 数值条（HP/MP 等）=====
export function ValueBar({
  label,
  value,
  max,
  color,
  digits = 0,
}: {
  label: string
  value: number
  max: number
  color: string
  digits?: number
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-700">
          {fmt(value, digits)} / {fmt(max, digits)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-rose-100">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

// ===== 标签 =====
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'red' | 'green' | 'amber' | 'indigo' | 'cyan' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-red-100 text-red-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-violet-100 text-violet-700',
    cyan: 'bg-pink-100 text-pink-700',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

// ===== 加载 / 错误 =====
export function Spinner() {
  return <div className="flex h-64 items-center justify-center text-slate-400">加载中…</div>
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="flex h-64 items-center justify-center px-6 text-center text-red-500">加载失败：{message}</div>
}

// ===== 空态 =====
export function EmptyBox({ message }: { message: string }) {
  return <div className="flex h-40 items-center justify-center text-sm text-slate-400">{message}</div>
}

// ===== 描述文本（直接展示，保留换行）=====
export function DescText({ text }: { text: string }) {
  return (
    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
      {text}
    </p>
  )
}
