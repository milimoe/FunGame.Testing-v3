// 临时联调脚本：登录 → WS → match.start → 检查角色 → pause → resume → end
const BASE = 'http://localhost:5000'

async function main() {
  // 1. 登录
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456', device: 'e2e' }),
  }).then((r) => r.json())
  const token = login.data.accessToken
  console.log('[1] 登录 OK, user:', login.data.username, 'roles:', login.data.roles.join(','))

  // 2. WS 连接
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?access_token=${encodeURIComponent(token)}`)
  let seq = 0
  const pending = new Map()
  const send = (t, d = {}, timeout = 10000) =>
    new Promise((resolve) => {
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }) }, timeout)
      pending.set(id, (env) => { clearTimeout(timer); resolve({ ok: env.ok, env }) })
      ws.send(JSON.stringify({ t, i: id, d }))
    })

  await new Promise((res) => (ws.onopen = res))
  console.log('[2] WS 已连接')

  ws.onmessage = (ev) => {
    const env = JSON.parse(ev.data)
    if (env.i && pending.has(env.i)) {
      pending.get(env.i)(env)
      pending.delete(env.i)
    }
  }

  // 3. 服务器信息
  const info = await send('system.info')
  console.log('[3] system.info:', info.ok ? 'OK' : 'FAIL', info.error || '')

  // 4. match.start（5 人 AI 对战）
  const match = await send('match.start', { mode: 'example', count: 5 })
  const gameId = match.env?.d?.gameId
  console.log('[4] match.start:', match.ok ? `OK gameId=${gameId}` : `FAIL ${match.error}`)

  // 5. 收几个回合，检查角色名
  await new Promise((r) => setTimeout(r, 1500))
  const rounds = []
  const checkTimer = setTimeout(() => {
    const names = [...new Set(rounds.flatMap((r) => (r.round.AllCharacters || []).map((c) => c.NickName || c.Name)))]
    console.log('[5] 收到回合:', rounds.length, '角色:', names.join(' / '))
    console.log('     Oshima 角色出现:', names.some((n) => /シヤ|心音|甘雨|魔女|奈普图恩/i.test(n)))
  }, 100)

  ws.onmessage = (ev) => {
    const env = JSON.parse(ev.data)
    if (env.i && pending.has(env.i)) { pending.get(env.i)(env); pending.delete(env.i); return }
    if (env.t === 'gaming.round') rounds.push(env.d)
    if (env.t === 'gaming.over') {
      clearTimeout(checkTimer)
      console.log('[6] gaming.over 收到, 回合数:', env.d.totalRound)
      finish()
    }
  }

  // 6. REST 控制：暂停 → 恢复 → 强制结束
  const ctrl = async (action) => {
    const r = await fetch(`${BASE}/api/admin/server/games/${gameId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }).then((x) => x.json())
    console.log(`[ctrl] ${action}:`, r.ok ? `OK ${r.message}` : `FAIL ${r.message}`)
    return r.ok
  }

  await new Promise((r) => setTimeout(r, 300))
  if (gameId) {
    await ctrl('pause')
    await new Promise((r) => setTimeout(r, 500))
    const before = rounds.length
    await new Promise((r) => setTimeout(r, 1000))
    console.log('[7] 暂停后 1s 内新回合数:', rounds.length - before, '(期望 0)')
    await ctrl('resume')
    await new Promise((r) => setTimeout(r, 1000))
    const after = rounds.length
    console.log('[8] 恢复后 1s 内新回合数:', after - before, '(期望 >0)')
  }

  let finished = false
  async function finish() {
    if (finished) return
    finished = true
    await new Promise((r) => setTimeout(r, 300))
    await ctrl('end')
    console.log('[9] 联调完成')
    process.exit(0)
  }
  setTimeout(() => { console.log('[timeout] 对局超时，强制结束收尾'); finish() }, 40000)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
