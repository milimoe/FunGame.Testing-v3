// 验证：match.start 后行动记录中的技能名（证明技能装配生效）
const BASE = 'http://localhost:5000'

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456', device: 'e2e' }),
  }).then((r) => r.json())
  const token = login.data.accessToken

  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?access_token=${encodeURIComponent(token)}`)
  let seq = 0
  const pending = new Map()
  const send = (t, d = {}) => new Promise((resolve) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }) }, 10000)
    pending.set(id, (env) => { clearTimeout(timer); resolve({ ok: env.ok, env }) })
    ws.send(JSON.stringify({ t, i: id, d }))
  })
  await new Promise((res) => (ws.onopen = res))

  const rounds = []
  ws.onmessage = (ev) => {
    const env = JSON.parse(ev.data)
    if (env.i && pending.has(env.i)) { pending.get(env.i)(env); pending.delete(env.i); return }
    if (env.t === 'gaming.round') rounds.push(env.d)
    if (env.t === 'gaming.over') finish()
  }

  const match = await send('match.start', { mode: 'example', count: 5 })
  console.log('match.start:', match.ok ? 'OK' : 'FAIL', match.error || '')
  const gameId = match.env?.d?.gameId

  await new Promise((r) => setTimeout(r, 2500))

  const last = rounds[rounds.length - 1]
  if (last) {
    const round = last.round || last
    console.log('收到回合数:', rounds.length, '| 回合号:', round.Round)
    const all = round.AllCharacters || []
    console.log('对局角色:', all.map((c) => c.NickName || c.Name).join(' / '))

    // 从 Actions 收集出现过的技能名
    const skillNames = new Set()
    const actorNames = new Set()
    for (const r of rounds) {
      const rr = r.round || r
      if (rr.Actor?.NickName) actorNames.add(rr.Actor.NickName)
      for (const a of rr.Actions || []) {
        if (a.Skill?.Name) skillNames.add(a.Skill.Name)
      }
    }
    console.log('行动过的角色:', [...actorNames].join(' / '))
    console.log('使用过的技能（前 30）:', [...skillNames].slice(0, 30).join(' / '))
    const exclusive = [...skillNames].filter((s) => /马|熵灭|心灵|千羽|蚀魂|咒怨|灵能|三相|双生|变幻|零式|少女|绝对领域|暗香|残香|破釜|宿命|累积|极寒|银隼|身心|弱者|饕餮|开宫|放监|八卦|归元|深海|海王星|雇佣|全军|不息|概念|神之因果/.test(s))
    const common = [...skillNames].filter((s) => /征服者|致命节奏|强攻|电刑|黑暗收割|迅捷步法|贪欲猎手/.test(s))
    const supers = [...skillNames].filter((s) => /樱花|漆黑之牙|女王之怒|裁决塔罗|光明之环|圣星光旋/.test(s))
    console.log('专属技能命中:', exclusive.join(' / ') || '（无）')
    console.log('通用被动命中:', common.join(' / ') || '（无）')
    console.log('通用大招命中:', supers.join(' / ') || '（无）')
    console.log('技能总数:', skillNames.size)
  } else {
    console.log('未收到回合数据')
  }

  let done = false
  async function finish() {
    if (done) return
    done = true
    console.log('对局结束')
    if (gameId) await fetch(`${BASE}/api/admin/server/games/${gameId}/end`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    process.exit(0)
  }
  setTimeout(finish, 20000)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
