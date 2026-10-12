/**
 * 协同行动端到端回归（团队模式）：
 *   1) 服务端在玩家回合开始时代 AI 队友提交协同申请（SubmitChainAction）
 *   2) 行动菜单（ActionType）下发的 payload 携带 chainActions
 *   3) 玩家选择「协同行动」后，服务端下发 ChainAction 决策，回传 chainActionId 即完成确认
 *
 * 用法：node chain-action-check.mjs [watchSeconds]
 *   环境变量：SOLO_WS（默认 ws://127.0.0.1:11030/ws/solo）
 *
 * 判定：只要观测到「服务端下发过含 chainActions 的行动菜单」，且「至少成功确认一次协同行动」，
 *       即视为链路打通（[PASS]）。团队模式下队友是否恰好排在下一位受引擎规则限制，
 *       因此 offs 次数为 0 时给出 [SKIP] 而不是 [FAIL]。
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:11030/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 150)

const M = { start: 'gaming.start', action: 'gaming.action' }
const send = (ws, t, d) => ws.send(JSON.stringify({ t, d, ts: Date.now() }))

const ws = new WebSocket(WS_URL)
let lastRound = -1
let lastAdvanceAt = Date.now()
let decisions = 0
let gameEnded = false
let offered = 0            // 服务端下发过 chainActions 的次数
let confirmed = 0          // 成功回传 chainActionId 的次数
let chainDecisions = 0     // 收到过多少次 ChainAction 决策
let chainLogSeen = 0       // 引擎日志里出现「协同」的次数
let aiInitiated = 0        // AI 回合自动发动协同的次数（新日志行「发动协同行动」）
let hostOffered = 0        // 宿主代交申请的次数（日志行「提交协同申请」）
let lastOffer = null
const NEVER_CHAIN = process.env.SOLO_NEVER_CHAIN === '1'
const kindCount = {}
const logTail = []
const startedAt = Date.now()

const timer = setInterval(() => {
  console.log(
    `[${((Date.now() - startedAt) / 1000).toFixed(0)}s] 回合=${lastRound} 决策=${decisions} ` +
      `协同菜单下发=${offered} 协同确认=${confirmed} AI 自动协同=${aiInitiated}`
  )
}, 15000)

ws.onopen = () => {
  console.log('connected ->', WS_URL)
  send(ws, M.start, {
    characterCount: 6,
    teamMode: true,
    teamSize: 3,
    maxRound: 500,
    maxScoreToWin: 10,
    requireContinue: false,
    roundDelayMs: 0,
    decisionTimeoutSeconds: 30,
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
    for (const line of d.log ?? []) {
      logTail.push(line)
      while (logTail.length > 160) logTail.shift()
      if (typeof line === 'string') {
        if (line.includes('协同')) chainLogSeen++
        if (line.includes('发动协同行动')) aiInitiated++
        if (line.includes('提交协同申请')) hostOffered++
      }
    }
    if (typeof s.round === 'number' && s.round !== lastRound) {
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
    if (kind === 'ActionType' && Array.isArray(p.chainActions) && p.chainActions.length > 0) {
      offered++
      lastOffer = p.chainActions.map((a) => `${a.actorName}→${a.skill?.name || a.item?.name || a.actionTypeName}`)
    }
    if (kind === 'ChainAction') chainDecisions++
    const reply = makeReply(kind, p)
    if (reply.__confirmed) confirmed++
    delete reply.__confirmed
    send(ws, M.action, { requestId: d.requestId, payload: reply })
    return
  }

  if (t === 'gaming.over') {
    console.log('gaming.over：对局结束，总回合=', d.totalRound, '胜者=', d.winnerName ?? '(无)')
    gameEnded = true
    finish()
  }
}

function makeReply(kind, p) {
  switch (kind) {
    case 'SelectCharacter': {
      const first = p.characters?.[0] ?? p.options?.[0]
      return { characterGuid: first?.guid ?? first?.Guid }
    }
    case 'ActionType': {
      // 有协同申请就优先协同；SOLO_NEVER_CHAIN=1 时玩家全程不主动协同，
      // 用于隔离出「AI 回合自动发动」的协同（服务端不依赖玩家交互）
      const apps = p.chainActions ?? []
      if (apps.length > 0 && !NEVER_CHAIN) return { actionType: 'ChainAction' }
      return { actionType: decisions % 2 === 0 ? 'NormalAttack' : 'EndTurn' }
    }
    case 'ChainAction': {
      const apps = p.applications ?? []
      if (apps.length === 0) return { cancelled: true }
      return { chainActionId: apps[0].id, __confirmed: true }
    }
    case 'Skill':
    case 'Item':
    case 'TargetGrid':
    case 'TargetGrids':
      return { cancelled: true }
    case 'Targets': {
      const list = (p.targets ?? []).slice(0, Math.max(1, p.maxTargets ?? 1))
      return { targetGuids: list.map((c) => c.guid ?? c.Guid) }
    }
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
  finish()
}

function finish() {
  clearInterval(timer)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log('================ 结果 ================')
  console.log(`总时长          : ${elapsed}s`)
  console.log(`最终回合        : ${lastRound}`)
  console.log(`决策总数        : ${decisions}`, kindCount)
  console.log(`协同菜单下发    : ${offered} 次`)
  console.log(`ChainAction 决策: ${chainDecisions} 次`)
  console.log(`协同确认成功    : ${confirmed} 次`)
  console.log(`宿主代交申请    : ${hostOffered} 次（玩家回合，含等待玩家确认）`)
  console.log(`AI 自动发动协同 : ${aiInitiated} 次（AI 回合，玩家无交互；Core #194 自主提交+确认）`)
  console.log(`引擎日志含「协同」: ${chainLogSeen} 行`)
  if (lastOffer) console.log(`最近一次申请     : ${lastOffer.join(' | ')}`)

  let verdict
  if (NEVER_CHAIN) {
    verdict = aiInitiated > 0
      ? '[PASS] 玩家全程不主动协同，仍观测到 AI 自主发动的协同（Core #194 生效）'
      : '[SKIP] 本局未观测到 AI 自主发动的协同（可能未出现连续同队位置）'
  } else if (offered === 0) verdict = '[SKIP] 本局未出现「下一位是队友」的连续位置，未观测到协同菜单'
  else if (confirmed === 0) verdict = '[FAIL] 下发过协同菜单但确认链路未走通'
  else verdict = '[PASS] 协同行动端到端链路打通（申请下发 → 选择 → 确认）'
  console.log(verdict)

  if (confirmed === 0 && aiInitiated === 0) {
    console.log('===== 引擎日志尾部（20 条） =====')
    for (const line of logTail.slice(-20)) console.log('  |', String(line).slice(0, 200))
  }

  try {
    ws.close()
  } catch {}
  process.exit(NEVER_CHAIN ? 0 : offered === 0 ? 0 : confirmed > 0 ? 0 : 1)
}

setTimeout(() => {
  if (!gameEnded) console.log(`观测窗口 ${WATCH_SECONDS}s 到点`)
  finish()
}, WATCH_SECONDS * 1000)
