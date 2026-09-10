/**
 * 单人模式「玩家不响应」回归脚本
 *
 * 目的：验证——当玩家 UI 完全不回传决策时，服务端能否在 decisionTimeout 后
 * 把玩家角色交 AI 托管，使回合继续推进（而不是永久卡死）。
 *
 * 用法：node solo-stall-check.mjs [watchSeconds]
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:11030/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 75)
const DECISION_TIMEOUT = 10 // 故意设短，加速暴露"不推进"问题

const M = {
  start: 'gaming.start',
  action: 'gaming.action',
}

function send(ws, t, d) {
  ws.send(JSON.stringify({ t, d, ts: Date.now() }))
}

const ws = new WebSocket(WS_URL)
let lastRound = -1
let lastAdvanceAt = Date.now()
let selectedCharacter = false
let maxStall = 0
let aiEscalatedSeen = false
const startedAt = Date.now()

const timer = setInterval(() => {
  const stall = ((Date.now() - lastAdvanceAt) / 1000).toFixed(1)
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(0)}s] 回合=${lastRound} 距上次推进=${stall}s 托管=${aiEscalatedSeen}`)
}, 10000)

ws.onopen = () => {
  console.log('connected ->', WS_URL)
  send(ws, M.start, {
    characterCount: 10,
    maxRound: 500,
    requireContinue: false,
    decisionTimeoutSeconds: DECISION_TIMEOUT,
    roundDelayMs: 0,
  })
  console.log('gaming.start sent (玩家此后将完全不响应决策)')
}

ws.onmessage = (ev) => {
  let env
  try {
    env = JSON.parse(ev.data)
  } catch {
    return
  }
  const { t, d } = env
  if (!d) return

  if (t === 'gaming.state') {
    const s = d.state
    if (!s) return
    if (typeof s.aiEscalated === 'boolean' && s.aiEscalated) aiEscalatedSeen = true
    if (typeof s.round === 'number' && s.round !== lastRound) {
      lastRound = s.round
      lastAdvanceAt = Date.now()
      maxStall = Math.max(maxStall, 0)
    }
    return
  }

  if (t === 'gaming.request') {
    const kind = d.kind ?? d.payload?.kind
    // 只回应开局选角色；此后一律不回，模拟"UI 没弹出菜单 / 玩家看不到轮到自己"
    if (kind === 'SelectCharacter' && !selectedCharacter) {
      const first = d.payload?.characters?.[0] ?? d.payload?.options?.[0]
      const guid = first?.guid ?? first?.Guid
      if (guid) {
        selectedCharacter = true
        send(ws, M.action, { requestId: d.requestId, payload: { characterGuid: guid } })
        console.log(`已选择角色 ${guid}，之后不再响应任何决策`)
      }
    }
    return
  }

  if (t === 'gaming.over') {
    console.log('gaming.over 收到：对局结束，回合=', lastRound)
    finish(true)
  }
}

ws.onerror = (e) => {
  console.error('ws error', e?.message ?? e)
}

ws.onclose = () => {
  console.log('ws closed')
  finish(false)
}

function finish(over) {
  clearInterval(timer)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const stallSinceLast = ((Date.now() - lastAdvanceAt) / 1000).toFixed(1)
  console.log('================ 结果 ================')
  console.log(`总时长        : ${elapsed}s`)
  console.log(`最终回合      : ${lastRound}`)
  console.log(`最后推进间隔  : ${stallSinceLast}s`)
  console.log(`出现过 AI 托管: ${aiEscalatedSeen ? '是' : '否'}`)
  const advanced = Number(stallSinceLast) < DECISION_TIMEOUT * 3
  console.log(advanced ? '[PASS] 玩家不响应时对局仍在推进（托管生效）' : '[FAIL] 对局停滞 —— 托管未生效')
  try {
    ws.close()
  } catch {}
  process.exit(advanced ? 0 : 1)
}

setTimeout(() => {
  console.log(`观测窗口 ${WATCH_SECONDS}s 到点`)
  finish(false)
}, WATCH_SECONDS * 1000)
