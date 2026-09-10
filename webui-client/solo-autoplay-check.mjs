/**
 * 单人模式自动对战回归：玩家全程响应决策（模拟正常游玩），
 * 用于确认「超时托管」改造没有破坏正常路径。
 *
 * 用法：node solo-autoplay-check.mjs [watchSeconds]
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:11030/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 90)

const M = { start: 'gaming.start', action: 'gaming.action' }
const send = (ws, t, d) => ws.send(JSON.stringify({ t, d, ts: Date.now() }))

const ws = new WebSocket(WS_URL)
let lastRound = -1
let lastAdvanceAt = Date.now()
let maxStall = 0
let aiEscalatedOnce = false
let decisions = 0
const startedAt = Date.now()
const kindCount = {}
const logTail = []
let lastQueue = ''
let gameEnded = false

let holdStart = 0
const timer = setInterval(() => {
  const stall = (Date.now() - lastAdvanceAt) / 1000
  console.log(
    `[${((Date.now() - startedAt) / 1000).toFixed(0)}s] 回合=${lastRound} 停滞=${stall.toFixed(
      1
    )}s 决策数=${decisions} 托管过=${aiEscalatedOnce}`
  )
  // 疑似卡死：已结束推进、未收到 over、且超过决策超时数倍。保持连接挂起（SOLO_HOLD 秒）供外部抓 dump
  if (!holdStart && stall > 20 && !gameEnded) {
    holdStart = Date.now()
    console.log(`>>> 疑似卡死（停滞 ${stall.toFixed(1)}s），保持连接 ${(process.env.SOLO_HOLD ?? 90) / 1000}s 供抓取现场...`)
    console.log(`>>> 现在请执行: dotnet-dump collect -p <服务PID> -o solo-hang.dmp --type Full`)
  }
}, 15000)

ws.onopen = () => {
  console.log('connected ->', WS_URL)
  send(ws, M.start, {
    characterCount: 10,
    maxRound: 500,
    requireContinue: false,
    roundDelayMs: 0,
    // SOLO_DIAG=1 时开启服务端回合看门狗（写入 turn-diag.log）
    enableTurnDiagnostics: process.env.SOLO_DIAG === '1',
  })
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
    if (s.aiEscalated) aiEscalatedOnce = true
    for (const line of d.log ?? []) {
      logTail.push(line)
      while (logTail.length > 120) logTail.shift()
    }
    if (s.queue?.length) lastQueue = s.queue.map((q) => `${q.displayName ?? q.name}(${q.guid?.slice(0, 6)})`).join(' > ')
    if (typeof s.round === 'number' && s.round !== lastRound) {
      const gap = (Date.now() - lastAdvanceAt) / 1000
      if (lastRound >= 0) maxStall = Math.max(maxStall, gap)
      lastRound = s.round
      lastAdvanceAt = Date.now()
    }
    return
  }

  if (t === 'gaming.request') {
    const kind = d.kind ?? d.payload?.kind
    const p = d.payload ?? {}
    decisions++
    kindCount[kind] = (kindCount[kind] ?? 0) + 1
    const reply = makeReply(kind, p)
    send(ws, M.action, { requestId: d.requestId, payload: reply })
    return
  }

  if (t === 'gaming.over') {
    console.log('gaming.over：对局结束，总回合=', d.totalRound, '胜者=', d.winnerName ?? '(无)')
    gameEnded = true
    finish(true)
  }
}

function makeReply(kind, p) {
  switch (kind) {
    case 'SelectCharacter': {
      const first = p.characters?.[0] ?? p.options?.[0]
      return { characterGuid: first?.guid ?? first?.Guid }
    }
    case 'ActionType':
      // 一半普攻一半结束回合，覆盖两条路径
      return { actionType: decisions % 2 === 0 ? 'NormalAttack' : 'EndTurn' }
    case 'Skill':
      return { cancelled: true }
    case 'Item':
      return { cancelled: true }
    case 'Targets': {
      // 服务端字段为 targets: [{ guid, ... }]，取前 maxTargets 个
      const list = (p.targets ?? []).slice(0, Math.max(1, p.maxTargets ?? 1))
      return { targetGuids: list.map((c) => c.guid ?? c.Guid) }
    }
    case 'TargetGrid':
      return { cancelled: true }
    case 'TargetGrids':
      return { cancelled: true }
    case 'Inquiry':
      return { cancel: false }
    case 'Continue':
      return {}
    default:
      return { cancelled: true }
  }
}

ws.onerror = (e) => console.error('ws error', e?.message ?? e)
ws.onclose = () => {
  console.log('ws closed')
  finish(false)
}

function finish(over) {
  clearInterval(timer)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const stall = ((Date.now() - lastAdvanceAt) / 1000).toFixed(1)
  console.log('================ 结果 ================')
  console.log(`总时长        : ${elapsed}s`)
  console.log(`最终回合      : ${lastRound}`)
  console.log(`最长回合间隔  : ${maxStall.toFixed(1)}s`)
  console.log(`决策总数      : ${decisions}`, kindCount)
  console.log(`曾被 AI 托管  : ${aiEscalatedOnce ? '是' : '否'}（自动脚本会选到射程外目标，触发护栏属预期）`)
  // 判定标准：收到 gaming.over 正常结束，或未结束但仍在持续推进（未卡死）
  const ok = gameEnded || Number(stall) < 15
  console.log(ok ? '[PASS] 对局正常推进/结束，未卡死' : '[FAIL] 对局停滞（卡死）')
  console.log('===== 卡死前引擎日志尾部（25 条） =====')
  for (const line of logTail.slice(-25)) console.log('  |', line.slice(0, 200))
  console.log('===== 最后行动顺序 =====')
  console.log('  ', lastQueue ?? '(空)')
  try {
    ws.close()
  } catch {}
  process.exit(ok ? 0 : 1)
}

setTimeout(() => {
  const waitEnd = holdStart + (Number(process.env.SOLO_HOLD) || 90000)
  if (holdStart && Date.now() < waitEnd) {
    console.log('观测窗口到点但卡死中，继续挂起等待外部抓取...')
    setTimeout(() => finish(false), Math.max(0, waitEnd - Date.now()))
  } else {
    console.log(`观测窗口 ${WATCH_SECONDS}s 到点`)
    finish(false)
  }
}, WATCH_SECONDS * 1000)
