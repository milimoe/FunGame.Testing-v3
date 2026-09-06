import type { MessageEnvelope } from './types'

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface WsResult {
  ok: boolean
  elapsedMs: number
  envelope: MessageEnvelope | null
  raw: string
  error?: string
}

export interface WsCallbacks {
  onStatus?: (status: WsStatus) => void
  onMessage?: (envelope: MessageEnvelope | null, raw: string) => void
  onClosed?: () => void
}

export interface WsClient {
  connect: (url: string) => Promise<boolean>
  close: () => void
  status: () => WsStatus
  send: (envelope: { t: string; i?: number; d?: Record<string, unknown> }, timeoutMs?: number) => Promise<WsResult>
  rawSend: (text: string) => void
}

const PING_INTERVAL_MS = 15000

export function createWsClient(callbacks: WsCallbacks = {}): WsClient {
  let socket: WebSocket | null = null
  let currentStatus: WsStatus = 'idle'
  let pingTimer: number | null = null
  let seq = 0

  const setStatus = (s: WsStatus) => {
    currentStatus = s
    callbacks.onStatus?.(s)
  }

  const heartbeat = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: 'system.ping', i: ++seq, d: { ts: Date.now() } }))
    }
  }

  const connect = (url: string) =>
    new Promise<boolean>((resolve) => {
      close()
      setStatus('connecting')
      try {
        socket = new WebSocket(url)
      } catch (e) {
        setStatus('error')
        resolve(false)
        return
      }
      socket.onopen = () => {
        setStatus('open')
        if (pingTimer !== null) window.clearInterval(pingTimer)
        pingTimer = window.setInterval(heartbeat, PING_INTERVAL_MS)
        resolve(true)
      }
      socket.onmessage = (ev) => {
        let envelope: MessageEnvelope | null = null
        try {
          envelope = JSON.parse(ev.data as string) as MessageEnvelope
        } catch {
          /* 非 JSON 帧 */
        }
        callbacks.onMessage?.(envelope, ev.data as string)
      }
      socket.onclose = () => {
        setStatus('closed')
        if (pingTimer !== null) window.clearInterval(pingTimer)
        pingTimer = null
        callbacks.onClosed?.()
      }
      socket.onerror = () => {
        setStatus('error')
      }
    })

  const close = () => {
    if (pingTimer !== null) window.clearInterval(pingTimer)
    pingTimer = null
    if (socket) {
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
      socket = null
    }
    setStatus('closed')
  }

  const send = (envelope: { t: string; i?: number; d?: Record<string, unknown> }, timeoutMs = 8000) =>
    new Promise<WsResult>((resolve) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, elapsedMs: 0, envelope: null, raw: '', error: 'WebSocket 未连接' })
        return
      }
      const id = envelope.i || ++seq
      const payload: MessageEnvelope = { t: envelope.t, i: id, ok: true, d: envelope.d ?? {}, ts: Date.now() }
      const started = performance.now()
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', onWindow)
        resolve({ ok: false, elapsedMs: performance.now() - started, envelope: null, raw: '', error: `等待响应超时（${timeoutMs}ms）` })
      }, timeoutMs)

      const onWindow = (ev: MessageEvent) => {
        // 通过 ws 客户端广播的关联响应（i 匹配）
        const detail = (ev as unknown as { detail?: { envelope: MessageEnvelope | null; raw: string } }).detail
        if (!detail || detail.envelope?.i !== id) return
        window.removeEventListener('message', onWindow)
        window.clearTimeout(timer)
        resolve({
          ok: detail.envelope.ok !== false,
          elapsedMs: performance.now() - started,
          envelope: detail.envelope,
          raw: detail.raw,
          error: detail.envelope.ok ? undefined : detail.envelope.error?.message || detail.envelope.error?.code || '未知错误',
        })
      }
      window.addEventListener('message', onWindow)

      try {
        socket.send(JSON.stringify(payload))
      } catch (e) {
        window.removeEventListener('message', onWindow)
        window.clearTimeout(timer)
        resolve({ ok: false, elapsedMs: performance.now() - started, envelope: null, raw: '', error: e instanceof Error ? e.message : String(e) })
      }
    })

  const rawSend = (text: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(text)
  }

  return { connect, close, status: () => currentStatus, send, rawSend }
}
