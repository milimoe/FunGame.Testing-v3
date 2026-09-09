import type { SoloConnStatus, SoloEnvelope, SoloInboundEvent } from './soloTypes'
import { SoloMsg } from './soloTypes'

// ============================================================================
// 单人模式 · 传输层
// SoloGameClient 是「对局通道」抽象：当前实现为直连本地 WebAPI 的 /ws/solo，
// 将来联动 FunGame.Server-v3 联机版时，只需提供另一个实现（对 gaming.action /
// gaming.request / gaming.state 等消息类型语义不变，走 Server-v3 的房间与会话），
// 上层组件（useSoloGame）完全无感。
// ============================================================================

export interface SoloStartOptions {
  characterCount?: number
  level?: number
  skillLevel?: number
  normalAttackLevel?: number
  maxRound?: number
  maxRespawnTimes?: number
  roundDelayMs?: number
  decisionTimeoutSeconds?: number
  requireContinue?: boolean
  /** 回合看门狗诊断（默认关闭）：开启后服务端会把超时未返回的回合状态写入 turn-diag.log */
  enableTurnDiagnostics?: boolean
  /** 随机种子；指定后同种子可复现整局（便于复现偶发卡死） */
  seed?: number
}

export interface SoloGameClient {
  /** 建立连接；成功返回 true */
  connect(url?: string): Promise<boolean>
  disconnect(): void
  readonly status: SoloConnStatus
  /** 发起一局（gaming.start），options 由服务器权威计算使用 */
  startGame(options: SoloStartOptions): void
  /** 回传玩家决策（gaming.action）；requestId 对应服务器下发的决策请求 */
  sendDecision(requestId: string, payload: unknown): boolean
  /** 重连后显式接管仍在运行的对局（服务端据此挂接，避免残留局消息串台） */
  resume(): void
  /** 主动结束对局 */
  endGame(): void
  /** 订阅服务器事件，返回取消订阅函数 */
  subscribe(cb: (ev: SoloInboundEvent) => void): () => void
}

const PING_INTERVAL_MS = 15_000

export function createSoloGameClient(baseUrl: string): SoloGameClient {
  const listeners = new Set<(ev: SoloInboundEvent) => void>()
  let socket: WebSocket | null = null
  let currentStatus: SoloConnStatus = 'idle'
  let pingTimer: number | null = null
  let seq = 0

  const emit = (ev: SoloInboundEvent) => {
    for (const cb of listeners) {
      try {
        cb(ev)
      } catch {
        /* 单个监听器异常不阻断其他监听器 */
      }
    }
  }

  const startHeartbeat = () => {
    stopHeartbeat()
    pingTimer = window.setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: SoloMsg.Ping, i: ++seq, d: { ts: Date.now() } }))
      }
    }, PING_INTERVAL_MS)
  }

  const stopHeartbeat = () => {
    if (pingTimer !== null) {
      window.clearInterval(pingTimer)
      pingTimer = null
    }
  }

  const buildWsUrl = (base: string) => {
    const target = base.replace(/\/+$/, '')
    return `${target.replace(/^http/, 'ws')}/ws/solo`
  }

  const connect = (url?: string) =>
    new Promise<boolean>((resolve) => {
      disconnect()
      currentStatus = 'connecting'
      try {
        socket = new WebSocket(url ?? buildWsUrl(baseUrl))
      } catch {
        currentStatus = 'error'
        resolve(false)
        return
      }
      socket.onopen = () => {
        currentStatus = 'open'
        startHeartbeat()
        resolve(true)
      }
      socket.onmessage = (ev) => {
        let envelope: SoloEnvelope | null = null
        try {
          envelope = JSON.parse(ev.data as string) as SoloEnvelope
        } catch {
          return
        }
        if (!envelope || !envelope.t) return
        const d = envelope.d ?? {}
        switch (envelope.t) {
          case SoloMsg.GamingState:
            emit({ type: 'gaming.state', data: d as never })
            break
          case SoloMsg.GamingOver:
            emit({ type: 'gaming.over', data: d as never })
            break
          case SoloMsg.GamingRound:
            emit({ type: 'gaming.round', data: d as never })
            break
          case SoloMsg.GamingQueue:
            emit({ type: 'gaming.queue', data: d })
            break
          case SoloMsg.GamingRequest:
            emit({ type: 'gaming.request', data: d as never })
            break
          case SoloMsg.GamingResolved:
            emit({ type: 'gaming.resolved', data: d as never })
            break
          case SoloMsg.GamingStart:
            emit({ type: 'gaming.start', data: d })
            break
          case SoloMsg.Pong:
            emit({ type: 'system.pong', data: d })
            break
          default:
            break
        }
      }
      socket.onclose = () => {
        currentStatus = 'closed'
        stopHeartbeat()
      }
      socket.onerror = () => {
        currentStatus = 'error'
      }
    })

  const disconnect = () => {
    stopHeartbeat()
    if (socket) {
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
      socket = null
    }
    currentStatus = 'closed'
  }

  const rawSend = (t: string, d: Record<string, unknown>): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({ t, i: ++seq, d }))
    return true
  }

  const startGame = (options: SoloStartOptions) => {
    rawSend(SoloMsg.GamingStart, { ...options })
  }

  const sendDecision = (requestId: string, payload: unknown): boolean =>
    rawSend(SoloMsg.GamingAction, { requestId, payload })

  const resume = () => {
    rawSend(SoloMsg.GamingResume, { ts: Date.now() })
  }

  const endGame = () => {
    rawSend(SoloMsg.GamingEnd, { ts: Date.now() })
  }

  return {
    connect,
    disconnect,
    get status() {
      return currentStatus
    },
    startGame,
    sendDecision,
    resume,
    endGame,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
