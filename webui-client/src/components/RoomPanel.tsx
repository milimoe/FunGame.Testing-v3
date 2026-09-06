import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchGameModules } from '../api'
import { useServer } from '../store'
import type { GameModulesDto } from '../types'

export default function RoomPanel() {
  const { baseUrl, token, wsStatus, wsSend, connectWs, addRecord, patchBattle } = useServer()

  const [modules, setModules] = useState<GameModulesDto | null>(null)
  const [modesError, setModesError] = useState<string | null>(null)
  const [mode, setMode] = useState('example')
  const [maxUsers, setMaxUsers] = useState(2)
  const [isRank, setIsRank] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [roomMsg, setRoomMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [started, setStarted] = useState(false)
  // 内容模组（角色/技能/物品来源）：空 = 全量模组；否则为模组前缀（如 "oshima"）
  const [contentModule, setContentModule] = useState('')

  const loadModules = useCallback(async () => {
    setModesError(null)
    const result = await fetchGameModules(baseUrl)
    if (result.ok && result.body?.data) {
      const d = result.body.data
      setModules(d)
      if (d.modes.length > 0) setMode((m) => (d.modes.some((x) => x.name === m) ? m : d.modes[0].name))
      if (contentModule && !d.modules.some((x) => x.name.startsWith(contentModule + '.'))) setContentModule('')
    } else {
      setModesError(result.error ?? '获取模组列表失败')
    }
  }, [baseUrl, contentModule])

  // 内容模组族（模组名前缀去重，如 example / oshima）
  const contentProviders = useMemo(() => {
    const set = new Set<string>()
    for (const m of modules?.modules ?? []) {
      const p = m.name.split('.')[0]
      if (p) set.add(p)
    }
    return [...set].sort()
  }, [modules])

  useEffect(() => {
    loadModules()
  }, [loadModules])

  const createRoom = async () => {
    if (wsStatus !== 'open') {
      setRoomMsg({ ok: false, text: 'WebSocket 未连接，请先在顶部登录并连接 WS' })
      return
    }
    setBusy(true)
    setRoomMsg(null)
    setStarted(false)
    addRecord({
      kind: 'ws', name: '创建房间', wsType: 'room.create',
      requestBody: { module: mode, contentModule, maxUsers, isRank, password },
      status: 'running',
    })
    try {
      const result = await wsSend('room.create', {
        module: mode,
        contentModule: contentModule || undefined,
        map: '',
        maxUsers,
        isRank,
        password: password || undefined,
      })
      if (result.ok) {
        const d = result.envelope?.d as { roomId?: string; joined?: boolean } | undefined
        setRoomId(d?.roomId ?? null)
        setRoomMsg({ ok: true, text: `房间创建成功：${d?.roomId ?? '?'}` })
      } else {
        setRoomMsg({ ok: false, text: result.error ?? '创建失败' })
      }
      addRecord({
        kind: 'ws', name: '创建房间响应', wsType: 'room.create',
        status: result.ok ? 'success' : 'fail', elapsedMs: result.elapsedMs,
        responseBody: result.envelope, error: result.error,
      })
    } catch (e) {
      setRoomMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
    setBusy(false)
  }

  const startGame = async () => {
    if (!roomId) return
    if (wsStatus !== 'open') {
      setRoomMsg({ ok: false, text: 'WebSocket 未连接' })
      return
    }
    setBusy(true)
    addRecord({ kind: 'ws', name: '开始对局', wsType: 'room.start', requestBody: { roomId }, status: 'running' })
    try {
      const result = await wsSend('room.start', { roomId })
      if (result.ok) {
        const d = result.envelope?.d as { gameId?: string } | undefined
        setStarted(true)
        setRoomMsg({ ok: true, text: `对局已创建：${d?.gameId ?? '?'}（战斗面板将实时推送回合）` })
        if (d?.gameId) patchBattle({ gameId: d.gameId, running: true })
      } else {
        setRoomMsg({ ok: false, text: result.error ?? '开始对局失败' })
      }
      addRecord({
        kind: 'ws', name: '开始对局响应', wsType: 'room.start',
        status: result.ok ? 'success' : 'fail', elapsedMs: result.elapsedMs,
        responseBody: result.envelope, error: result.error,
      })
    } catch (e) {
      setRoomMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
    setBusy(false)
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[400px_1fr]">
      {/* 创建房间表单 */}
      <div className="panel-dark gold-frame rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-gold-600">创建房间</span>
          <button onClick={loadModules} className="rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-400/15 hover:text-ink-700">
            刷新模组列表
          </button>
        </div>

        {modesError && (
          <div className="mb-2 rounded-lg border border-red-600/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-700">{modesError}</div>
        )}

        {/* 模组选择 */}
        <div className="mb-3">
          <div className="mb-1 text-[12px] text-ink-500">游戏模组（由服务器提供列表）</div>
          <div className="space-y-1.5">
            {(modules?.modes ?? []).map((m) => (
              <button
                key={m.name}
                onClick={() => setMode(m.name)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                  mode === m.name ? 'border-gold-500/60 bg-gold-500/10' : 'border-ink-400/20 bg-parchment-200/40 hover:bg-parchment-300/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] font-medium text-ink-800">{m.name}</span>
                  <span className="text-[10px] text-ink-400">v{m.version}</span>
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-ink-600">{m.description}</div>
                <div className="text-[10px] text-ink-400">{m.author}</div>
              </button>
            ))}
            {!modules && !modesError && <div className="text-[12px] text-ink-500">加载模组列表…</div>}
            {modules && modules.modes.length === 0 && (
              <div className="text-[12px] text-ink-500">暂无可用游戏模式（无 ServerPlugin 加载）</div>
            )}
          </div>
        </div>

        {/* 内容模组选择（角色/技能/物品来源） */}
        <div className="mb-3">
          <div className="mb-1 text-[12px] text-ink-500">
            内容模组 <span className="text-ink-400">（角色/技能/物品来源，由服务器提供列表）</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setContentModule('')}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                contentModule === '' ? 'bg-gold-500/20 text-gold-600 ring-1 ring-gold-500/50' : 'bg-parchment-200/60 text-ink-600 hover:bg-parchment-300/70'
              }`}
            >
              全量模组
            </button>
            {contentProviders.map((p) => (
              <button
                key={p}
                onClick={() => setContentModule(p)}
                className={`rounded-lg px-2.5 py-1.5 font-mono text-[12px] transition-colors ${
                  contentModule === p ? 'bg-gold-500/20 text-gold-600 ring-1 ring-gold-500/50' : 'bg-parchment-200/60 text-ink-600 hover:bg-parchment-300/70'
                }`}
              >
                {p}
              </button>
            ))}
            {contentProviders.length === 0 && <span className="text-[12px] text-ink-500">（无内容模组）</span>}
          </div>
        </div>

        {/* 房间参数 */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[12px] text-ink-500">最大人数</div>
            <input
              type="number" min={2} max={10} value={maxUsers}
              onChange={(e) => setMaxUsers(Math.min(10, Math.max(2, Number(e.target.value) || 2)))}
              className="w-full rounded-lg border border-ink-400/25 bg-parchment-50 px-2.5 py-1.5 font-mono text-[13px] text-ink-800 outline-none focus:border-gold-500/60"
            />
          </div>
          <div>
            <div className="mb-1 text-[12px] text-ink-500">是否排位</div>
            <button
              onClick={() => setIsRank((v) => !v)}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                isRank ? 'border-gold-500/60 bg-gold-500/15 text-gold-600' : 'border-ink-400/25 bg-parchment-50 text-ink-500'
              }`}
            >
              {isRank ? '排位' : '普通'}
            </button>
          </div>
        </div>
        <div className="mb-3">
          <div className="mb-1 text-[12px] text-ink-500">密码（可选）</div>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="留空表示无密码"
            className="w-full rounded-lg border border-ink-400/25 bg-parchment-50 px-2.5 py-1.5 text-[13px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
          />
        </div>

        <button
          onClick={createRoom}
          disabled={busy || wsStatus !== 'open'}
          className="w-full rounded-xl bg-gradient-to-r from-gold-400 to-gold-300 px-3 py-2.5 text-[14px] font-semibold text-ink-900 shadow-md shadow-gold-500/25 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '处理中…' : '创建房间'}
        </button>
        {wsStatus !== 'open' && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-amber-700">
            <span>需要登录并连接 WebSocket</span>
            {token && (
              <button onClick={() => connectWs(token)} className="rounded border border-sky-600/50 px-2 py-0.5 font-medium text-sky-700 hover:bg-sky-500/20">
                连接 WS
              </button>
            )}
          </div>
        )}

        {roomMsg && (
          <div className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${roomMsg.ok ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700' : 'border-red-600/40 bg-red-500/10 text-red-700'}`}>
            {roomMsg.text}
          </div>
        )}

        {roomId && !started && (
          <button
            onClick={startGame}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-gold-500/60 bg-gold-500/15 px-3 py-2.5 text-[14px] font-semibold text-gold-600 transition-colors hover:bg-gold-500/25 disabled:opacity-50"
          >
            ▶ 开始对局（房主）
          </button>
        )}
        {started && <div className="mt-2 text-[11px] text-emerald-700">对局进行中，请切换到「战斗对局」面板查看实时回合推送</div>}
      </div>

      {/* 内容模组信息 */}
      <div className="panel-dark gold-frame min-h-0 overflow-y-auto rounded-2xl p-4">
        <div className="mb-3 text-[14px] font-semibold text-gold-600">已加载内容模组（决定对局角色 / 技能 / 物品池）</div>
        <div className="space-y-2">
          {(modules?.modules ?? []).map((m) => (
            <div key={m.name} className="rounded-xl border border-ink-400/15 bg-parchment-200/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] font-medium text-ink-800">{m.name}</span>
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{m.kind}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-600">{m.description}</div>
              <div className="text-[10px] text-ink-400">v{m.version} · {m.author}</div>
            </div>
          ))}
          {modules && modules.modules.length === 0 && <div className="text-[12px] text-ink-500">暂无内容模组</div>}
        </div>
        <div className="mt-3 rounded-lg border border-ink-400/15 bg-parchment-300/40 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">
          对局角色 / 技能 / 物品只从「内容模组」选定的模组族产生（如 oshima → 大島シヤ、心音等 18 角色 + 专属技能）；选「全量模组」则使用全部内容模组（参考 FunGameSimulation 装配技能）。
        </div>
      </div>
    </div>
  )
}
