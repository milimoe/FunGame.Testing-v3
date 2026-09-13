/**
 * 空投轮换回归：验证 WebAPI 按游戏时间（秒）执行 FunGameSimulation.DropItems 轮换空投。
 * 记录每次「空投」日志行到达时的对局总时长（totalTime），应落在间隔的整数倍附近。
 *
 * 用法：node dropitems-check.mjs [watchSeconds]
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:5099/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 60)

const send = (ws, t, d) => ws.send(JSON.stringify({ t, d, ts: Date.now() }))
const log = []
const dropTimes = []
let totalTime = 0
let started = false

const ws = new WebSocket(WS_URL)
ws.onopen = () => {
  console.log('connected, starting game (initialQuality=3, interval=10 game-seconds, no team)')
  send(ws, 'gaming.start', {
    characterCount: 4,
    teamMode: false,
    teamSize: 2,
    level: 60,
    skillLevel: 6,
    normalAttackLevel: 8,
    maxRound: 999,
    maxRespawnTimes: 1,
    roundDelayMs: 0,
    decisionTimeoutSeconds: 5,
    initialItemQuality: 3,
    dropItemsIntervalSeconds: 10,
  })
}
ws.onmessage = (ev) => {
  let m
  try { m = JSON.parse(ev.data) } catch { return }
  if (m.t === 'gaming.request') {
    const { requestId, kind, payload } = m.d
    if (kind === 'SelectCharacter') {
      started = true
      send(ws, 'gaming.action', { requestId, payload: { characterGuid: payload.characters[0].guid } })
    } else {
      // 其余决策直接取消：服务端按 EndTurn 兜底，回合照常推进
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    }
  } else if (m.t === 'gaming.state') {
    if (!started) return
    totalTime = m.d.state?.totalTime ?? totalTime
    for (const line of m.d.log ?? []) {
      log.push(line)
      if (line.includes('空投') || line.includes('品质')) dropTimes.push({ at: totalTime, line })
    }
  }
}
ws.onclose = () => console.log('ws closed')

setTimeout(() => {
  console.log(`结束时对局总时长（游戏秒）：${totalTime.toFixed(1)}s`)
  console.log('=== 空投日志（附送达时的对局时长） ===')
  for (const d of dropTimes.slice(0, 12)) console.log(`[t≈${d.at.toFixed(1)}s] ${d.line}`)
  console.log(`空投日志共 ${dropTimes.length} 条`)
  process.exit(0)
}, WATCH_SECONDS * 1000)
