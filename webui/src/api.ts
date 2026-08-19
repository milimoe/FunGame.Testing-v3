import type { GameDataDto, MetaDto, RoundRecord, RoundSummaryDto, StatsDto } from './types'

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

export const fetchGameData = () => request<GameDataDto>('/api/gamedata')

export const fetchSummary = (from?: number, to?: number) => {
  const params = new URLSearchParams()
  if (from !== undefined) params.set('from', String(from))
  if (to !== undefined) params.set('to', String(to))
  const qs = params.toString()
  return request<RoundSummaryDto[]>(`/api/rounds/summary${qs ? `?${qs}` : ''}`)
}

export const fetchRound = (n: number) => request<RoundRecord>(`/api/rounds/${n}`)

export const reload = () => request<{ ok: boolean; roundCount: number }>('/api/reload', { method: 'POST' })

export const simulateTeam = () =>
  request<{ ok: boolean; roundCount: number; elapsedSeconds: number }>('/api/simulate/team', { method: 'POST' })
