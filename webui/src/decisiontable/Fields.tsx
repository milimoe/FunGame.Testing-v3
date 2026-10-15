import { useEffect, useId, useState, type ReactNode } from 'react'
import { parseJson, type Resource } from './model'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="dt-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Select({ value, options, onChange, label }: {
  value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; label?: string
}) {
  return <select aria-label={label} className="dt-input" value={value} onChange={event => onChange(event.target.value)}>
    {!options.some(([key]) => key === value) && <option value={value}>{value || '请选择'}</option>}
    {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select>
}

export function ResourceField({ kind, value, resources, onChange }: {
  kind: '技能' | '物品'; value?: number; resources: Resource[]; onChange: (value?: number) => void
}) {
  const [query, setQuery] = useState('')
  const matches = resources.filter(resource => `${resource.id} ${resource.name}`.toLowerCase().includes(query.toLowerCase()))
  const selected = resources.find(resource => resource.id === value)
  return <div className="space-y-2">
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={`${kind} ID`}>
        <input className="dt-input" aria-label={`${kind} ID`} type="number" step="1" value={value ?? ''}
          onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} placeholder="输入 ID 或从目录选择" />
      </Field>
      <Field label={`搜索${kind}目录`}>
        <input className="dt-input" aria-label={`搜索${kind}目录`} value={query} onChange={event => setQuery(event.target.value)} placeholder="名称或 ID" />
      </Field>
    </div>
    <select className="dt-input" aria-label={`选择${kind}`} value={resources.some(resource => resource.id === value) ? String(value) : ''}
      onChange={event => { if (event.target.value) onChange(Number(event.target.value)) }}>
      <option value="">{resources.length ? '从当前模组目录选择…' : '目录未连接，可手动输入 ID'}</option>
      {selected && !matches.includes(selected) && <option value={selected.id}>{selected.name} · {selected.id}</option>}
      {matches.map(resource => <option key={resource.id} value={resource.id}>{resource.name} · {resource.id}</option>)}
    </select>
    {selected && <p className="text-xs text-rose-600">已选：{selected.name} <span className="text-slate-400">#{selected.id}</span></p>}
  </div>
}

export function Parameters({ value, onChange, onValidityChange }: {
  value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; onValidityChange: (id: string, valid: boolean) => void
}) {
  const id = useId()
  const json = JSON.stringify(value ?? {}, null, 2)
  const [text, setText] = useState(json)
  const [error, setError] = useState('')
  useEffect(() => { setText(json); setError(''); onValidityChange(id, true) }, [json, id, onValidityChange])
  useEffect(() => () => onValidityChange(id, true), [id, onValidityChange])
  return <details className="rounded-lg border border-rose-100 p-3">
    <summary className="cursor-pointer text-xs text-slate-500">扩展参数（JSON 对象）</summary>
    <textarea aria-label="扩展参数" className="dt-input mt-2 min-h-24 font-mono text-xs" value={text} onChange={event => {
      const next = event.target.value
      setText(next)
      try {
        const parsed = parseJson(next)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数需要是 JSON 对象。')
        setError(''); onValidityChange(id, true); onChange(parsed as Record<string, unknown>)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'JSON 无效。'); onValidityChange(id, false)
      }
    }} />
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </details>
}
