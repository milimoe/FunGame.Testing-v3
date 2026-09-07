import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSoloGameClient, type SoloGameClient, type SoloStartOptions } from './soloClient'
import type {
  SoloCharacterDto,
  SoloConnStatus,
  SoloDecisionReply,
  SoloDecisionRequest,
  SoloDecisionKind,
  SoloDecisionPayload,
  SoloDpDto,
  SoloInboundEvent,
  SoloMapDto,
  SoloQueueEntryDto,
  SoloRankingDto,
} from './soloTypes'

export interface SoloUiState {
  conn: SoloConnStatus
  gameId: string | null
  started: boolean
  running: boolean
  finished: boolean
  round: number
  totalTime: number
  map: SoloMapDto | null
  characters: SoloCharacterDto[]
  charByGuid: ReadonlyMap<string, SoloCharacterDto>
  queue: SoloQueueEntryDto[]
  playerDP: SoloDpDto | null
  playerGuid: string | null
  roundRewards: Record<string, string[]>
  log: string[]
  decision: SoloDecisionRequest | null
  ranking: SoloRankingDto[] | null
  winnerName: string | null
}

export interface SoloGameController {
  state: SoloUiState
  /** 建立连接；返回是否成功 */
  connect: () => Promise<boolean>
  disconnect: () => void
  start: (options: SoloStartOptions) => void
  submit: (payload: SoloDecisionReply) => void
  cancel: () => void
  end: () => void
}

const initialState: SoloUiState = {
  conn: 'idle',
  gameId: null,
  started: false,
  running: false,
  finished: false,
  round: 0,
  totalTime: 0,
  map: null,
  characters: [],
  charByGuid: new Map(),
  queue: [],
  playerDP: null,
  playerGuid: null,
  roundRewards: {},
  log: [],
  decision: null,
  ranking: null,
  winnerName: null,
}

export function useSoloGame(baseUrl: string): SoloGameController {
  const clientRef = useRef<SoloGameClient | null>(null)
  const [state, setState] = useState<SoloUiState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  // ==================== 事件处理 ====================
  const applyEvent = useCallback((ev: SoloInboundEvent) => {
    if (ev.type === 'gaming.state') {
      const s = ev.data.state
      setState((prev) => {
        const characters = s.characters ?? []
        const charByGuid = new Map(characters.map((c) => [c.guid, c]))
        const log = [...prev.log]
        for (const line of ev.data.log ?? []) log.push(line)
        while (log.length > 4000) log.shift()
        return {
          ...prev,
          gameId: s.gameId ?? prev.gameId,
          running: s.running,
          finished: prev.finished || s.gameOver,
          round: s.round,
          totalTime: s.totalTime,
          map: s.map,
          characters,
          charByGuid,
          queue: s.queue ?? [],
          playerDP: s.playerDP ?? null,
          playerGuid: s.playerGuid ?? prev.playerGuid,
          roundRewards: s.roundRewards ?? {},
          log,
        }
      })
    } else if (ev.type === 'gaming.request') {
      // 服务端下发 { requestId, kind, payload }，kind 位于顶层。
      // 归一化：把 kind 一并注入 payload，使各 UI 组件可继续用 payload.kind 做判别联合收窄。
      const raw = ev.data.payload as (Partial<SoloDecisionPayload> & Record<string, unknown>) | null
      const kind = (ev.data.kind ?? (raw as { kind?: SoloDecisionKind } | null)?.kind) as SoloDecisionKind
      const payload = { ...(raw ?? {}), kind } as SoloDecisionPayload
      setState((prev) => ({ ...prev, decision: { requestId: ev.data.requestId, kind, payload } }))
    } else if (ev.type === 'gaming.resolved') {
      setState((prev) => (prev.decision?.requestId === ev.data.requestId ? { ...prev, decision: null } : prev))
    } else if (ev.type === 'gaming.over') {
      setState((prev) => ({
        ...prev,
        running: false,
        finished: true,
        started: false,
        decision: null,
        ranking: ev.data.ranking ?? [],
        winnerName: ev.data.winnerName ?? null,
        log: [...prev.log, `--- 游戏结束：${ev.data.totalRound} 回合 · ${(ev.data.totalTime ?? 0).toFixed(1)} 秒 ---`],
      }))
    } else if (ev.type === 'gaming.start') {
      setState((prev) => ({ ...prev, running: true, finished: false, started: true }))
    } else if (ev.type === 'gaming.round') {
      setState((prev) => ({ ...prev, round: Math.max(prev.round, ev.data.round) }))
    }
  }, [])

  // ==================== 客户端生命周期 ====================
  useEffect(() => {
    const client = createSoloGameClient(baseUrl)
    clientRef.current = client
    const unsub = client.subscribe(applyEvent)
    setState((prev) => ({ ...prev, conn: 'idle' }))
    return () => {
      unsub()
      client.disconnect()
      if (clientRef.current === client) clientRef.current = null
    }
  }, [baseUrl, applyEvent])

  const connect = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current
    if (!client) return false
    setState((prev) => ({ ...prev, conn: 'connecting' }))
    const ok = await client.connect()
    setState((prev) => ({ ...prev, conn: ok ? 'open' : 'error' }))
    return ok
  }, [])

  // 连接状态监视 + 对局中自动重连（断线期间服务器由 AI 托管玩家角色）
  useEffect(() => {
    const poll = window.setInterval(() => {
      const client = clientRef.current
      if (!client) return
      const cur = client.status
      const s = stateRef.current
      if (cur !== s.conn) setState((prev) => ({ ...prev, conn: cur }))
      if ((cur === 'closed' || cur === 'error') && s.started && !s.finished) {
        // 对局未结束：尝试接回（服务器持续运行，AI 托管中）
        void client.connect().then((ok) => {
          if (ok) setState((prev) => ({ ...prev, conn: 'open' }))
        })
      }
    }, 1500)
    return () => window.clearInterval(poll)
  }, [])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    setState((prev) => ({ ...prev, conn: 'closed' }))
  }, [])

  const start = useCallback((options: SoloStartOptions) => {
    const client = clientRef.current
    if (!client) return
    setState({ ...initialState, conn: 'open', started: true, running: true })
    client.startGame(options)
  }, [])

  const submit = useCallback((payload: SoloDecisionReply) => {
    const s = stateRef.current
    const client = clientRef.current
    if (!client || !s.decision) return
    client.sendDecision(s.decision.requestId, payload)
    setState((prev) => ({ ...prev, decision: null }))
  }, [])

  const cancel = useCallback(() => {
    const s = stateRef.current
    const client = clientRef.current
    if (!client || !s.decision) return
    const kind = s.decision.kind ?? s.decision.payload.kind
    if (kind === 'Skill' || kind === 'Item' || kind === 'Targets' || kind === 'TargetGrid' || kind === 'TargetGrids' || kind === 'Inquiry') {
      client.sendDecision(s.decision.requestId, { cancelled: true })
      setState((prev) => ({ ...prev, decision: null }))
    }
  }, [])

  const end = useCallback(() => {
    clientRef.current?.endGame()
    clientRef.current?.disconnect()
    setState({ ...initialState })
  }, [])

  const controller = useMemo<SoloGameController>(
    () => ({ state, connect, disconnect, start, submit, cancel, end }),
    [state, connect, disconnect, start, submit, cancel, end],
  )

  return controller
}
