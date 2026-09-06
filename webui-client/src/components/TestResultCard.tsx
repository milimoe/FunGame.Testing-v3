import { useState } from 'react'
import type { TestRecord } from '../types'
import JsonView from './JsonView'

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 border-emerald-600/50',
  fail: 'bg-red-500/15 text-red-700 border-red-600/50',
  running: 'bg-amber-500/15 text-amber-700 border-amber-600/50',
  idle: 'bg-ink-400/15 text-ink-600 border-ink-400/40',
}

const STATUS_TEXT: Record<string, string> = {
  success: '成功',
  fail: '失败',
  running: '进行中',
  idle: '待执行',
}

export default function TestResultCard({ record }: { record: TestRecord }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        record.status === 'success'
          ? 'border-emerald-600/30 bg-emerald-500/8'
          : record.status === 'fail'
            ? 'border-red-600/35 bg-red-500/8'
            : 'border-ink-400/25 bg-parchment-200/50'
      }`}
    >
      <div className="flex cursor-pointer items-center gap-2" onClick={() => setOpen((o) => !o)}>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[record.status]}`}>
          {STATUS_TEXT[record.status]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{record.name}</span>
        <span className="shrink-0 rounded-md bg-parchment-300/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">
          {record.elapsedMs.toFixed(1)} ms
        </span>
        <span className="shrink-0 text-ink-400">{open ? '▾' : '▸'}</span>
      </div>

      {record.error && (
        <div className="mt-2 rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-700">
          {record.error}
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-ink-400/15 px-2 py-0.5 font-mono text-[11px] text-ink-700">
              {record.kind === 'rest'
                ? `${record.method ?? 'GET'} ${record.path ?? ''}`
                : `WS · ${record.wsType ?? ''}`}
            </span>
            <span className="text-[11px] text-ink-500">{new Date(record.timestamp).toLocaleTimeString()}</span>
          </div>

          {record.requestBody !== undefined && (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-gold-600">请求</div>
              <JsonView value={record.requestBody} maxHeight="12rem" />
            </div>
          )}

          <div>
            <div className="mb-1 text-[11px] font-semibold text-sky-700">响应</div>
            {record.responseBody !== undefined && record.responseBody !== null ? (
              <JsonView value={record.responseBody} maxHeight="20rem" />
            ) : (
              <span className="text-[12px] text-ink-500">（无响应体）</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
