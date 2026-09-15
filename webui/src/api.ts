import type { MetaDto, RoundRecord, RoundSummaryDto, StatsDto } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {
      /* 非 JSON 响应，忽略 */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const fetchMeta = () => request<MetaDto>('/api/meta')

export const fetchStats = () => request<StatsDto>('/api/statistics')

export const fetchSummary = (from?: number, to?: number) => {
  const params = new URLSearchParams()
  if (from !== undefined) params.set('from', String(from))
  if (to !== undefined) params.set('to', String(to))
  const qs = params.toString()
  return request<RoundSummaryDto[]>(`/api/rounds/summary${qs ? `?${qs}` : ''}`)
}

export const fetchRound = (n: number) => request<RoundRecord>(`/api/rounds/${n}`)

export const reload = () => request<{ ok: boolean; roundCount: number }>('/api/reload', { method: 'POST' })

export interface SimulateResult {
  ok: boolean
  roundCount: number
  elapsedSeconds: number
  /** 本局实际使用的随机种子（未指定时由服务端随机生成） */
  seed: number
}

/**
 * 跑一局团队模拟。
 * @param seed 指定随机种子则固定（同种子可复现整局）；传 undefined / null 则由服务端随机生成
 */
export const simulateTeam = (seed?: number | null) =>
  request<SimulateResult>(`/api/simulate/team${seed === undefined || seed === null ? '' : `?seed=${seed}`}`, {
    method: 'POST',
  })
