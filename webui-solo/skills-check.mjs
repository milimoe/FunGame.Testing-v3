/**
 * 不可用技能展示回归：验证「回合开始时已被引擎过滤（CD/资源不足）」的技能也会出现在
 * 技能决策负载里（usable=false，客户端可勾选查看详情但无法确认）。
 *
 * 流程：第一回合想办法完成一次施法（选射程内目标）→ 结束回合；
 * 之后的回合再次进入技能选择，检查负载里是否存在 usable=false 的条目。
 * 旧实现里这些技能会在回合开始被 GetTurnStartNeedyList 整体过滤、不会下发。
 *
 * 用法：node skills-check.mjs [watchSeconds]
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:5099/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 90)

const send = (ws, t, d) => ws.send(JSON.stringify({ t, d, ts: Date.now() }))
let gridXY = new Map() // gridId -> {x,y}
let round = 0
let castAttempts = 0
let castName = null
let scanned = 0
let proof = null
const skillPayloads = []

const dist = (a, b) => (a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 999)

const ws = new WebSocket(WS_URL)
ws.onopen = () => {
  console.log('connected, starting game')
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
    decisionTimeoutSeconds: 8,
  })
}
ws.onmessage = (ev) => {
  let m
  try { m = JSON.parse(ev.data) } catch { return }
  if (m.t === 'gaming.state') {
    round = m.d.state?.round ?? round
    for (const g of m.d.state?.map?.grids ?? []) gridXY.set(g.id, { x: g.x, y: g.y })
    return
  }
  if (m.t !== 'gaming.request') return
  const { requestId, kind, payload } = m.d

  if (kind === 'SelectCharacter') {
    send(ws, 'gaming.action', { requestId, payload: { characterGuid: payload.characters[0].guid } })
    return
  }

  if (kind === 'ActionType') {
    const usable = (payload.skills ?? []).filter((s) => s.usable && !s.isSuperSkill && !s.isMagic)
    if (castAttempts < 3 && scanned === 0 && usable.length > 0) {
      castAttempts++
      send(ws, 'gaming.action', { requestId, payload: { actionType: 'PreCastSkill' } })
    } else if (scanned < 5) {
      // 已尝试施放：再次进入技能选择，扫描负载中的不可用条目
      if (castAttempts > 0) scanned++
      send(ws, 'gaming.action', { requestId, payload: { actionType: 'PreCastSkill' } })
    } else {
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } }) // = EndTurn
    }
    return
  }

  if (kind === 'Skill') {
    skillPayloads.push(payload.skills.map((s) => `${s.name}:${s.usable ? '可用' : `不可用(${s.unusableReason})`}`))
    const usable = payload.skills.filter((s) => s.usable && !s.isSuperSkill && !s.isMagic)
    if (castName === null && usable.length > 0 && castAttempts > 0) {
      const pick = usable.reduce((a, b) => (b.realCD > a.realCD ? b : a)) // 挑 CD 最长的，方便下回合仍在 CD
      castName = pick.name
      send(ws, 'gaming.action', { requestId, payload: { skillGuid: pick.guid } })
    } else {
      // 后续回合的负载：出现任何 usable=false 的条目即证明（这些技能在回合开始已被引擎过滤）
      const locked = payload.skills.filter((s) => !s.usable)
      if (locked.length > 0) proof = locked
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    }
    return
  }

  if (kind === 'Targets') {
    // 选射程内（曼哈顿距离）的目标，含自己（治疗/增益常以自身为目标）
    const actor = payload.actorGridId
    const range = payload.range ?? -1
    const inRange = (payload.targets ?? []).filter(
      (t) => range < 0 || dist(actor && gridXY.get(actor), gridXY.get(t.gridId)) <= range,
    )
    const t = inRange[0] ?? (payload.targets ?? [])[0]
    if (t) send(ws, 'gaming.action', { requestId, payload: { targetGuids: [t.guid] } })
    else send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    return
  }
  if (kind === 'TargetGrid') {
    const g = (payload.gridIds ?? [])[0]
    if (g !== undefined) send(ws, 'gaming.action', { requestId, payload: { gridId: g } })
    else send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    return
  }
  if (kind === 'TargetGrids') {
    const g = (payload.gridIds ?? [])[0]
    if (g !== undefined) send(ws, 'gaming.action', { requestId, payload: { gridIds: [g] } })
    else send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    return
  }
  if (kind === 'Inquiry') {
    // 有默认选项就按默认走，避免取消中断施法流程
    if (payload.inquiryType === 'NumberInput') {
      send(ws, 'gaming.action', { requestId, payload: { number: payload.defaultNumber ?? 0 } })
    } else if (payload.defaultChoice) {
      send(ws, 'gaming.action', { requestId, payload: { choices: [payload.defaultChoice] } })
    } else if (payload.canCancel) {
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    } else {
      send(ws, 'gaming.action', { requestId, payload: {} })
    }
    return
  }
  send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
}

setTimeout(() => {
  console.log(`尝试施放的技能：${castName ?? '(未进入技能选择)'}`)
  console.log(`技能选择负载数：${skillPayloads.length}`)
  skillPayloads.forEach((p, i) => console.log(`  [${i + 1}] ${p.join(' | ')}`))
  if (proof) {
    console.log(`\n✅ 证据：回合开始被引擎过滤的技能出现在负载里：`)
    for (const s of proof) console.log(`   - ${s.name}（不可用原因：${s.unusableReason}）`)
  } else {
    console.log('\n❌ 未在后续技能负载中找到不可用条目')
  }
  process.exit(0)
}, WATCH_SECONDS * 1000)
