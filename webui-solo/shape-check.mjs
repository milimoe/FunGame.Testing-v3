/**
 * 非指向性技能形状选取回归：
 * 验证 TargetGrids 决策带形状信息（shapeRangeType/shapeRadius 等），
 * 玩家只提交一个中心格，服务端按形状权威展开（日志出现「以 #X 为中心选取…区域」），
 * 施法完成后技能进入冷却（后续负载中该技能 usable=false）。
 *
 * 前置：FunGameService.Skills 已临时注入非指向性技能「转换战斗天赋」。
 * 用法：node shape-check.mjs [watchSeconds]
 */
const WS_URL = process.env.SOLO_WS || 'ws://127.0.0.1:5099/ws/solo'
const WATCH_SECONDS = Number(process.argv[2] || 90)
const SKILL = '转换战斗天赋'

const send = (ws, t, d) => ws.send(JSON.stringify({ t, d, ts: Date.now() }))
let gridOccupied = new Map() // gridId -> bool
let phase = 'find' // find → casting(已提交技能) → picked(已提交中心格)
let gridsPayload = null
let pickedCenter = null
let castLogSeen = false
let cdProof = false
let attempts = 0
let turnSeen = 0
let games = 0
const log = []

const startGame = () => {
  games++
  turnSeen = 0
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
    initialItemQuality: 5,
    dropItemsIntervalSeconds: 40,
  })
}

const ws = new WebSocket(WS_URL)
ws.onopen = () => {
  console.log('connected, starting game (#' + 1 + ')')
  startGame()
}
ws.onmessage = (ev) => {
  let m
  try { m = JSON.parse(ev.data) } catch { return }
  if (m.t === 'gaming.state') {
    for (const g of m.d.state?.map?.grids ?? []) gridOccupied.set(g.id, (g.characters ?? []).length > 0)
    for (const line of m.d.log ?? []) {
      log.push(line)
      if (line.includes('为中心选取')) castLogSeen = true
      if (process.env.SHAPE_DEBUG && (line.includes('转换战斗天赋') || line.includes('无法') || line.includes('没有目标') || line.includes('超配额') || line.includes('决策点不足'))) console.log(`[log] ${line}`)
    }
    return
  }
  if (m.t !== 'gaming.request') return
  const { requestId, kind, payload } = m.d
  if (process.env.SHAPE_DEBUG) console.log(`[req] kind=${kind}${payload?.skillName ? ` skill=${payload.skillName}` : ''}`)

  if (kind === 'SelectCharacter') {
    send(ws, 'gaming.action', { requestId, payload: { characterGuid: payload.characters[0].guid } })
    return
  }

  if (kind === 'ActionType') {
    const usable = (payload.skills ?? []).filter((s) => s.usable && !s.isSuperSkill)
    if (phase === 'find' && usable.some((s) => s.name === SKILL)) {
      attempts++
      if (attempts <= 3 || attempts % 10 === 0) console.log(`[found] 第${games}局 第${turnSeen + 1}回合 找到 ${SKILL}，尝试施法 (#${attempts})`)
      send(ws, 'gaming.action', { requestId, payload: { actionType: 'PreCastSkill' } })
    } else if (phase === 'picked' && !cdProof && attempts < 500) {
      // 已提交中心格：再进一次技能选择，验证技能是否进入冷却（= 施法成功）
      attempts++
      send(ws, 'gaming.action', { requestId, payload: { actionType: 'PreCastSkill' } })
    } else {
      // 抽不到目标技能就重开局（换一批角色）；超过 8 个回合决策还没遇到就换
      turnSeen++
      if (phase === 'find' && turnSeen >= 8) {
        send(ws, 'gaming.end', { ts: Date.now() })
        setTimeout(() => startGame(), 800)
        return
      }
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } }) // = EndTurn
    }
    return
  }

  if (kind === 'Skill') {
    const target = (payload.skills ?? []).find((s) => s.name === SKILL)
    if (phase === 'picked') {
      // 提交中心格之后的技能选择：目标技能应已进入冷却（施法成功）
      cdProof = !!target && !target.usable
      console.log(`[cd-check] ${SKILL} ${target ? `usable=${target.usable}${target.usable ? '' : `（${target.unusableReason}）`}` : '不在负载中'}`)
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
      return
    }
    if (target && target.usable) {
      send(ws, 'gaming.action', { requestId, payload: { skillGuid: target.guid } })
    } else {
      send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
    }
    return
  }

  if (kind === 'TargetGrids') {
    gridsPayload = {
      shapeRangeType: payload.shapeRangeType,
      shapeRadius: payload.shapeRadius,
      sectorAngle: payload.sectorAngle,
      includeCharacterGrid: payload.includeCharacterGrid,
      gridCount: (payload.gridIds ?? []).length,
    }
    // SelectIncludeCharacterGrid=false → 优先选空格；否则随便选第一个范围内的
    const ids = payload.gridIds ?? []
    const empty = ids.find((id) => !gridOccupied.get(id))
    pickedCenter = empty ?? ids[0]
    phase = 'picked'
    send(ws, 'gaming.action', { requestId, payload: { gridIds: [pickedCenter] } })
    return
  }

  // Inquiry / Targets / TargetGrid / Continue：默认/取消走兜底
  if (kind === 'Inquiry' && payload.defaultChoice) {
    send(ws, 'gaming.action', { requestId, payload: { choices: [payload.defaultChoice] } })
  } else if (kind === 'Inquiry' && payload.inquiryType === 'NumberInput') {
    send(ws, 'gaming.action', { requestId, payload: { number: payload.defaultNumber ?? 0 } })
  } else {
    send(ws, 'gaming.action', { requestId, payload: { cancelled: true } })
  }
}

setTimeout(() => {
  console.log(`共开局 ${games} 局 · 技能选取尝试次数：${attempts}`)
  console.log(`TargetGrids 负载：${gridsPayload ? JSON.stringify(gridsPayload) : '(未收到)'}`)
  console.log(`提交的中心格：#${pickedCenter ?? '(未提交)'}`)
  const castLine = log.find((l) => l.includes('为中心选取'))
  console.log(`服务端形状展开日志：${castLine ?? '(未出现)'}`)
  console.log(`施法后进入冷却（后续负载 usable=false）：${cdProof ? '✅' : '❌'}`)
  const ok = gridsPayload && pickedCenter !== null && castLogSeen && cdProof
  console.log(ok ? '\n✅ 形状选取链路验证通过' : '\n❌ 链路未走通')
  process.exit(0)
}, WATCH_SECONDS * 1000)
