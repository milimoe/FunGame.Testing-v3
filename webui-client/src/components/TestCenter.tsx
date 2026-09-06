import { useMemo, useState } from 'react'
import { api } from '../api'
import { useServer } from '../store'
import { TEST_CASES, TEST_GROUPS } from '../testCases'
import type { TestCase } from '../types'
import TestResultCard from './TestResultCard'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

export default function TestCenter() {
  const { baseUrl, token, wsStatus, wsSend, records, addRecord, updateRecord, clearRecords } = useServer()
  const [activeGroup, setActiveGroup] = useState(TEST_GROUPS[0])
  const [runningId, setRunningId] = useState<string | null>(null)

  // 手动请求构造器
  const [manualMethod, setManualMethod] = useState<(typeof METHODS)[number]>('GET')
  const [manualPath, setManualPath] = useState('/api/auth/me')
  const [manualBody, setManualBody] = useState('')
  const [manualRunning, setManualRunning] = useState(false)

  const groupCases = useMemo(() => TEST_CASES.filter((c) => c.group === activeGroup), [activeGroup])

  const runRestCase = async (tc: TestCase) => {
    const record = addRecord({
      kind: 'rest',
      name: tc.name,
      method: tc.method,
      path: tc.path,
      requestBody: tc.bodyText ? parseJson(tc.bodyText) : undefined,
      status: 'running',
    })
    setRunningId(tc.id)
    const result = await api.request(baseUrl, tc.path ?? '', {
      method: tc.method,
      body: tc.bodyText ? parseJson(tc.bodyText) : undefined,
      token,
    })
    updateRecord(record.id, {
      status: result.ok ? 'success' : 'fail',
      elapsedMs: result.elapsedMs,
      responseBody: result.raw ? result.body : undefined,
      error: result.error,
    })
    setRunningId(null)
  }

  const runWsCase = async (tc: TestCase) => {
    if (wsStatus !== 'open') {
      addRecord({ kind: 'ws', name: tc.name, wsType: tc.wsType, status: 'fail', elapsedMs: 0, error: 'WebSocket 未连接，请先在顶部连接' })
      return
    }
    const record = addRecord({
      kind: 'ws',
      name: tc.name,
      wsType: tc.wsType,
      requestBody: tc.wsData,
      status: 'running',
    })
    setRunningId(tc.id)
    try {
      const result = await wsSend(tc.wsType ?? '', tc.wsData)
      updateRecord(record.id, {
        status: result.ok ? 'success' : 'fail',
        elapsedMs: result.elapsedMs,
        responseBody: result.envelope,
        error: result.error,
      })
    } catch (e) {
      updateRecord(record.id, { status: 'fail', error: e instanceof Error ? e.message : String(e) })
    }
    setRunningId(null)
  }

  const runManual = async () => {
    if (!manualPath) return
    const record = addRecord({
      kind: 'rest',
      name: '手动请求',
      method: manualMethod,
      path: manualPath,
      requestBody: manualBody ? parseJson(manualBody) : undefined,
      status: 'running',
    })
    setManualRunning(true)
    const result = await api.request(baseUrl, manualPath, {
      method: manualMethod,
      body: manualBody ? parseJson(manualBody) : undefined,
      token,
    })
    updateRecord(record.id, {
      status: result.ok ? 'success' : 'fail',
      elapsedMs: result.elapsedMs,
      responseBody: result.raw ? result.body : undefined,
      error: result.error,
    })
    setManualRunning(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      {/* 用例选择区 */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
        <div className="panel-dark gold-frame rounded-2xl p-3">
          <div className="mb-2 text-[13px] font-semibold text-gold-600">预设测试用例</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {TEST_GROUPS.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGroup(g)}
                className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  activeGroup === g
                    ? 'bg-gold-500/20 text-gold-600 ring-1 ring-gold-500/50'
                    : 'bg-parchment-200/60 text-ink-600 hover:bg-parchment-300/70 hover:text-ink-800'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            {groupCases.map((tc) => (
              <button
                key={tc.id}
                onClick={() => (tc.kind === 'rest' ? runRestCase(tc) : runWsCase(tc))}
                disabled={runningId === tc.id}
                className="group flex w-full items-center gap-2 rounded-xl border border-ink-400/15 bg-parchment-200/40 px-3 py-2 text-left transition-colors hover:border-gold-500/50 hover:bg-gold-500/10 disabled:opacity-60"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    tc.kind === 'rest' ? 'bg-sky-500/15 text-sky-700' : 'bg-violet-500/15 text-violet-700'
                  }`}
                >
                  {tc.kind === 'rest' ? tc.method : 'WS'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink-800">{tc.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-400">
                    {tc.kind === 'rest' ? tc.path : tc.wsType}
                  </span>
                </span>
                {runningId === tc.id && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />}
              </button>
            ))}
          </div>
        </div>

        {/* 手动请求构造器 */}
        <div className="panel-dark gold-frame rounded-2xl p-3">
          <div className="mb-2 text-[13px] font-semibold text-gold-600">手动请求</div>
          <div className="flex gap-1.5">
            <select
              value={manualMethod}
              onChange={(e) => setManualMethod(e.target.value as (typeof METHODS)[number])}
              className="shrink-0 rounded-lg border border-ink-400/25 bg-parchment-100 px-2 py-1.5 font-mono text-[12px] text-ink-800 outline-none focus:border-gold-500/60"
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/api/auth/me"
              className="min-w-0 flex-1 rounded-lg border border-ink-400/25 bg-parchment-100 px-2.5 py-1.5 font-mono text-[12px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
            />
          </div>
          <textarea
            value={manualBody}
            onChange={(e) => setManualBody(e.target.value)}
            placeholder='请求体 JSON（可选），如 {"username":"admin","password":"admin123456"}'
            rows={3}
            className="mt-1.5 w-full resize-y rounded-lg border border-ink-400/25 bg-parchment-100 px-2.5 py-1.5 font-mono text-[12px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
          />
          <button
            onClick={runManual}
            disabled={manualRunning}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-gold-400 to-gold-300 px-3 py-1.5 text-[13px] font-semibold text-ink-900 shadow-sm shadow-gold-500/25 transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {manualRunning ? '发送中…' : '发送请求'}
          </button>
          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-500">
            <span>
              WS 状态：
              <span
                className={
                  wsStatus === 'open'
                    ? 'text-emerald-700'
                    : wsStatus === 'connecting'
                      ? 'text-amber-700'
                      : 'text-ink-400'
                }
              >
                {wsStatus}
              </span>
            </span>
            <button onClick={clearRecords} className="rounded px-1.5 py-0.5 hover:bg-ink-400/15 hover:text-ink-700">
              清空结果
            </button>
          </div>
        </div>
      </div>

      {/* 结果流 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink-700">
            测试结果 <span className="text-ink-400">（{records.length}）</span>
          </span>
          <span className="text-[11px] text-ink-400">点击卡片展开请求 / 响应详情</span>
        </div>
        {records.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-gold-500/40 bg-parchment-200/40 text-center text-ink-500">
            <div className="mb-1 text-2xl text-gold-500/60">⚔</div>
            <div className="text-[13px] font-medium">从左侧选择测试用例开始</div>
            <div className="text-[11px]">REST 用例走 /api，WS 用例走 /ws（需先连接）</div>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <TestResultCard key={r.id} record={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function parseJson(text: string): unknown | undefined {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
