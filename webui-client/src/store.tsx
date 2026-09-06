import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type RestResult } from './api'
import { createWsClient, type WsClient, type WsStatus } from './ws'
import type {
  AuthProfile,
  BattleCharacter,
  GameEvent,
  GameOverInfo,
  MessageEnvelope,
  TestRecord,
  TestStatus,
} from './types'

export interface BattleState {
  gameId: string | null
  mode: string
  round: number
  characters: BattleCharacter[]
  gameOver: GameOverInfo | null
  running: boolean
  paused: boolean
  speed: 1 | 2
  auto: boolean
}

interface ServerContextValue {
  baseUrl: string
  setBaseUrl: (u: string) => void
  token: string | null
  refreshToken: string | null
  user: AuthProfile | null
  login: (username: string, password: string) => Promise<RestResult>
  register: (username: string, password: string, nickname?: string) => Promise<RestResult>
  logout: () => Promise<void>
  wsStatus: WsStatus
  ws: WsClient | null
  connectWs: (token: string) => Promise<boolean>
  disconnectWs: () => void
  wsSend: (t: string, d?: Record<string, unknown>, timeoutMs?: number) => Promise<{
    ok: boolean
    elapsedMs: number
    envelope: MessageEnvelope | null
    raw: string
    error?: string
  }>
  records: TestRecord[]
  addRecord: (partial: Omit<TestRecord, 'id' | 'timestamp' | 'status' | 'elapsedMs'> & { status?: TestStatus; elapsedMs?: number }) => TestRecord
  updateRecord: (id: string, patch: Partial<TestRecord>) => void
  clearRecords: () => void
  events: GameEvent[]
  addEvent: (type: string, data: unknown) => void
  clearEvents: () => void
  battle: BattleState
  resetBattle: () => void
  patchBattle: (patch: Partial<BattleState>) => void
  handleIncoming: (envelope: MessageEnvelope) => void
}

const ServerContext = createContext<ServerContextValue | null>(null)

export function ServerProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:5000')
  const [token, setToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthProfile | null>(null)
  const [wsStatus, setWsStatus] = useState<WsStatus>('idle')
  const [records, setRecords] = useState<TestRecord[]>([])
  const [events, setEvents] = useState<GameEvent[]>([])
  const [battle, setBattle] = useState<BattleState>({
    gameId: null,
    mode: '',
    round: 0,
    characters: [],
    gameOver: null,
    running: false,
    paused: false,
    speed: 1,
    auto: false,
  })
  const wsRef = useRef<WsClient | null>(null)
  const seqRef = useRef(0)

  // ---- WS 实例（引用稳定）----
  const createWs = useCallback(() => {
    const client = createWsClient({
      onStatus: setWsStatus,
      onMessage: (envelope, raw) => {
        if (!envelope) return
        // 广播关联响应（供 wsSend 关联）
        window.dispatchEvent(new CustomEvent('message', { detail: { envelope, raw } }))
        handleIncomingRef.current(envelope)
      },
      onClosed: () => {
        /* 状态由 onStatus 更新 */
      },
    })
    wsRef.current = client
    return client
  }, [])

  // ---- 入站协议处理（对局事件 → 战斗面板）----
  const handleIncoming = useCallback((envelope: MessageEnvelope) => {
    const { t, d } = envelope
    if (t === 'gaming.start') {
      setBattle((b) => ({
        ...b,
        gameId: (d.gameId as string) ?? b.gameId,
        mode: (d.mode as string) ?? b.mode,
        running: true,
        gameOver: null,
        round: 0,
        characters: [],
      }))
      addEvent('gaming.start', d)
    } else if (t === 'gaming.round') {
      setBattle((b) => ({ ...b, round: b.round + 1 }))
      addEvent('gaming.round', d)
    } else if (t === 'gaming.over') {
      const over: GameOverInfo = {
        gameId: d.gameId as string,
        mode: d.mode as string,
        totalRound: (d.totalRound as number) ?? 0,
        totalTime: (d.totalTime as number) ?? 0,
        gameResult: d.gameResult,
      }
      setBattle((b) => ({ ...b, running: false, paused: false, gameOver: over, gameId: over.gameId }))
      addEvent('gaming.over', d)
    } else if (t === 'system.kick') {
      addEvent('system.kick', d)
    } else if (t === 'room.event') {
      addEvent('room.event', d)
    } else if (t === 'room.chat') {
      addEvent('room.chat', d)
    } else if (t === 'system.notice') {
      addEvent('system.notice', d)
    }
    // 其他类型（请求响应）不做全局处理，由 wsSend 关联
  }, [])
  const handleIncomingRef = useRef(handleIncoming)
  handleIncomingRef.current = handleIncoming

  // ---- 认证 ----
  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.post<{
        data: { accessToken: string; refreshToken: string; username: string; userId: number; roles: string[]; permissions: string[] }
      }>(baseUrl, '/api/auth/login', { username, password, device: 'webui-client' })
      if (result.ok && result.body) {
        const d = result.body.data
        setToken(d.accessToken)
        setRefreshToken(d.refreshToken)
        setUser({ userId: d.userId, username: d.username, roles: d.roles, permissions: d.permissions })
      }
      return result
    },
    [baseUrl],
  )

  const register = useCallback(
    async (username: string, password: string, nickname = '') => {
      const result = await api.post<{
        data: { accessToken: string; refreshToken: string; username: string; userId: number; roles: string[]; permissions: string[] }
      }>(baseUrl, '/api/auth/register', { username, password, nickname, device: 'webui-client' })
      if (result.ok && result.body) {
        const d = result.body.data
        setToken(d.accessToken)
        setRefreshToken(d.refreshToken)
        setUser({ userId: d.userId, username: d.username, roles: d.roles, permissions: d.permissions })
      }
      return result
    },
    [baseUrl],
  )

  const logout = useCallback(async () => {
    if (token) {
      await api.post(baseUrl, '/api/auth/logout', { refreshToken }, token)
    }
    wsRef.current?.close()
    setToken(null)
    setRefreshToken(null)
    setUser(null)
  }, [baseUrl, token, refreshToken])

  // ---- WebSocket ----
  const connectWs = useCallback(
    async (accessToken: string) => {
      const client = wsRef.current ?? createWs()
      const url = `${baseUrl.replace(/^http/, 'ws')}/ws?access_token=${encodeURIComponent(accessToken)}`
      return client.connect(url)
    },
    [baseUrl, createWs],
  )

  const disconnectWs = useCallback(() => {
    wsRef.current?.close()
  }, [])

  const wsSend = useCallback(
    (t: string, d: Record<string, unknown> = {}, timeoutMs?: number) => {
      const client = wsRef.current
      if (!client) return Promise.reject(new Error('WebSocket 未初始化'))
      const id = ++seqRef.current
      return client.send({ t, i: id, d }, timeoutMs)
    },
    [],
  )

  // ---- 测试记录 ----
  const addRecord = useCallback(
    (partial: Omit<TestRecord, 'id' | 'timestamp' | 'status' | 'elapsedMs'> & { status?: TestStatus; elapsedMs?: number }) => {
      const record: TestRecord = {
        ...partial,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        elapsedMs: partial.elapsedMs ?? 0,
        status: partial.status ?? 'idle',
      }
      setRecords((prev) => [record, ...prev])
      return record
    },
    [],
  )

  const updateRecord = useCallback((id: string, patch: Partial<TestRecord>) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const clearRecords = useCallback(() => setRecords([]), [])

  // ---- 对局事件 ----
  const addEvent = useCallback((type: string, data: unknown) => {
    setEvents((prev) =>
      [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, time: Date.now(), data }, ...prev].slice(0, 300),
    )
  }, [])
  const clearEvents = useCallback(() => setEvents([]), [])

  // ---- 战斗状态 ----
  const resetBattle = useCallback(() => {
    setBattle({ gameId: null, mode: '', round: 0, characters: [], gameOver: null, running: false, paused: false, speed: 1, auto: false })
  }, [])
  const patchBattle = useCallback((patch: Partial<BattleState>) => {
    setBattle((b) => ({ ...b, ...patch }))
  }, [])

  const value = useMemo<ServerContextValue>(
    () => ({
      baseUrl,
      setBaseUrl,
      token,
      refreshToken,
      user,
      login,
      register,
      logout,
      wsStatus,
      ws: wsRef.current,
      connectWs,
      disconnectWs,
      wsSend,
      records,
      addRecord,
      updateRecord,
      clearRecords,
      events,
      addEvent,
      clearEvents,
      battle,
      resetBattle,
      patchBattle,
      handleIncoming,
    }),
    [
      baseUrl, token, refreshToken, user, login, register, logout, wsStatus, connectWs, disconnectWs, wsSend,
      records, addRecord, updateRecord, clearRecords, events, addEvent, clearEvents,
      battle, resetBattle, patchBattle, handleIncoming,
    ],
  )

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error('useServer 必须在 ServerProvider 内使用')
  return ctx
}
