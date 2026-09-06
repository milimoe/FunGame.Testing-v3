import { useState } from 'react'
import { api } from '../api'
import { useServer } from '../store'

export default function TopBar() {
  const { baseUrl, setBaseUrl, token, user, login, register, logout, wsStatus, connectWs, disconnectWs } = useServer()
  const [showAuth, setShowAuth] = useState(false)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123456')
  const [nickname, setNickname] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMsg, setAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [connMsg, setConnMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const testConnection = async () => {
    setConnMsg(null)
    // 匿名请求受保护端点：401 说明服务器可达且认证生效
    const result = await api.request(baseUrl, '/api/auth/me')
    if (result.status === 401) setConnMsg({ ok: true, text: `服务器可达（认证保护正常，HTTP 401），耗时 ${result.elapsedMs.toFixed(0)}ms` })
    else if (result.status > 0) setConnMsg({ ok: true, text: `服务器可达（HTTP ${result.status}），耗时 ${result.elapsedMs.toFixed(0)}ms` })
    else setConnMsg({ ok: false, text: `连接失败：${result.error ?? '网络错误'}` })
  }

  const doAuth = async (mode: 'login' | 'register') => {
    setAuthBusy(true)
    setAuthMsg(null)
    const result = mode === 'login' ? await login(username, password) : await register(username, password, nickname)
    setAuthMsg(result.ok ? { ok: true, text: `${mode === 'login' ? '登录' : '注册'}成功` } : { ok: false, text: result.error ?? '失败' })
    setAuthBusy(false)
  }

  return (
    <header className="gold-frame flex flex-wrap items-center gap-2 rounded-2xl bg-parchment-100/80 px-3 py-2.5 backdrop-blur">
      {/* 服务器地址 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="hidden text-[12px] text-ink-500 sm:inline">服务器</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-44 rounded-lg border border-ink-400/25 bg-parchment-50 px-2.5 py-1.5 font-mono text-[12px] text-ink-800 outline-none focus:border-gold-500/60 sm:w-56"
        />
        <button
          onClick={testConnection}
          className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-2.5 py-1.5 text-[12px] font-medium text-gold-600 transition-colors hover:bg-gold-500/20"
        >
          测试连接
        </button>
        {connMsg && (
          <span className={`hidden text-[11px] lg:inline ${connMsg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{connMsg.text}</span>
        )}
      </div>

      <div className="mx-1 hidden h-6 w-px bg-ink-400/25 sm:block" />

      {/* 认证区 */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {!token ? (
          <>
            <button
              onClick={() => setShowAuth((s) => !s)}
              className="rounded-lg bg-gradient-to-r from-gold-400 to-gold-300 px-3 py-1.5 text-[12px] font-semibold text-ink-900 shadow-sm shadow-gold-500/25 hover:opacity-90"
            >
              登录 / 注册
            </button>
            {showAuth && (
              <div className="absolute left-1/2 top-16 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-gold-500/40 bg-parchment-50 p-4 shadow-2xl shadow-ink-900/20">
                <div className="mb-3 text-[13px] font-semibold text-gold-600">连接服务器并获取 JWT</div>
                <div className="space-y-2">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用户名（默认 admin / admin123456）"
                    className="w-full rounded-lg border border-ink-400/25 bg-parchment-100 px-3 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="密码"
                    className="w-full rounded-lg border border-ink-400/25 bg-parchment-100 px-3 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
                  />
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="昵称（仅注册需要）"
                    className="w-full rounded-lg border border-ink-400/25 bg-parchment-100 px-3 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => doAuth('login')}
                      disabled={authBusy}
                      className="flex-1 rounded-lg bg-gradient-to-r from-gold-400 to-gold-300 px-3 py-2 text-[13px] font-semibold text-ink-900 shadow-sm shadow-gold-500/25 hover:opacity-90 disabled:opacity-60"
                    >
                      {authBusy ? '处理中…' : '登录'}
                    </button>
                    <button
                      onClick={() => doAuth('register')}
                      disabled={authBusy}
                      className="flex-1 rounded-lg border border-gold-500/50 bg-gold-500/10 px-3 py-2 text-[13px] font-medium text-gold-600 hover:bg-gold-500/20 disabled:opacity-60"
                    >
                      注册
                    </button>
                  </div>
                  {authMsg && (
                    <div className={`text-[12px] ${authMsg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{authMsg.text}</div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="hidden items-center gap-1.5 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="max-w-32 truncate text-[12px] font-medium text-ink-800">{user?.username ?? '已登录'}</span>
              {user && user.roles.length > 0 && (
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{user.roles.join(',')}</span>
              )}
            </span>
            <span
              className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium ${
                wsStatus === 'open'
                  ? 'border-emerald-600/50 bg-emerald-500/15 text-emerald-700'
                  : wsStatus === 'connecting'
                    ? 'border-amber-600/50 bg-amber-500/15 text-amber-700'
                    : 'border-ink-400/35 bg-ink-400/10 text-ink-600'
              }`}
            >
              WS · {wsStatus}
            </span>
            {wsStatus !== 'open' ? (
              <button
                onClick={() => token && connectWs(token)}
                className="rounded-lg border border-sky-600/50 bg-sky-500/15 px-2.5 py-1.5 text-[12px] font-medium text-sky-700 hover:bg-sky-500/25"
              >
                连接 WS
              </button>
            ) : (
              <button
                onClick={disconnectWs}
                className="rounded-lg border border-ink-400/35 px-2.5 py-1.5 text-[12px] text-ink-600 hover:bg-ink-400/15"
              >
                断开 WS
              </button>
            )}
            <button
              onClick={() => logout()}
              className="rounded-lg border border-red-600/50 bg-red-500/10 px-2.5 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-500/20"
            >
              登出
            </button>
          </>
        )}
      </div>
    </header>
  )
}
