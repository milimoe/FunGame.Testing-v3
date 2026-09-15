import { useEffect, useState, type ReactNode } from 'react'
import type { PanelKey } from '../App'
import { fetchMeta, reload, simulateTeam } from '../api'

const NAV: { key: PanelKey; label: string; icon: string; desc: string }[] = [
  { key: 'home', label: '门户', icon: '🏠', desc: '模拟器整合入口' },
  { key: 'classplanner', label: '职业规划', icon: '⚔️', desc: '职业规划模拟器' },
  { key: 'stats', label: '赛后统计', icon: '🏆', desc: 'Rating 排行榜与战斗数据' },
  { key: 'replay', label: '回合回放', icon: '🎞️', desc: '逐回合浏览战斗过程' },
  { key: 'snapshot', label: '状态快照', icon: '📋', desc: '检查点回合角色状态' },
]

export default function Layout({
  panel,
  panelPaths,
  children,
}: {
  panel: PanelKey
  panelPaths: Record<PanelKey, string>
  children: ReactNode
}) {
  const [reloading, setReloading] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [seedInput, setSeedInput] = useState('')
  const [useFixedSeed, setUseFixedSeed] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const [toastTimer, setToastTimer] = useState<number | null>(null)

  // 存档里记录了上一局的种子，进入页面时回填到文本框（旧存档 seed=0 表示未记录，保持空）
  useEffect(() => {
    let cancelled = false
    fetchMeta()
      .then(meta => {
        if (!cancelled && meta.seed) setSeedInput(String(meta.seed))
      })
      .catch(() => {
        /* 存档缺失等情况忽略，保持空输入 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    if (toastTimer) window.clearTimeout(toastTimer)
    setToastTimer(window.setTimeout(() => setToast(null), 3500))
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      await reload()
      window.location.reload()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '重载失败', 'error')
      setReloading(false)
    }
  }

  const handleSimulate = async () => {
    setConfirming(false)
    setSimulating(true)
    try {
      // 勾选「指定种子」且填了合法整数才固定种子，否则交给服务端随机生成
      const parsed = Number.parseInt(seedInput.trim(), 10)
      const seed = useFixedSeed && Number.isFinite(parsed) ? parsed : null
      const result = await simulateTeam(seed)
      // 回填本局实际使用的种子（未指定时即服务端随机生成的值），便于再次复现
      setSeedInput(String(result.seed))
      showToast(`✅ 模拟完成：${result.roundCount} 回合，耗时 ${result.elapsedSeconds} 秒，本局种子 ${result.seed}，正在刷新…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '模拟失败', 'error')
      setSimulating(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-rose-50 text-slate-700 lg:flex-row">
      {/* 侧栏（移动端横向 / 桌面纵向） */}
      <aside className="shrink-0 border-b border-rose-100 bg-white/80 lg:flex lg:w-56 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-rose-100 px-4 py-3 lg:block lg:px-5 lg:py-4">
          <h1 className="text-base font-black tracking-wide text-rose-500">🎮 FunGame 测试台</h1>
          <p className="hidden text-[11px] text-slate-400 lg:mt-0.5 lg:block">模拟 · 回放 · 职业规划</p>
        </div>

        {/* 全局操作 */}
        <div className="flex flex-wrap gap-2 border-b border-rose-100 p-3 lg:block lg:space-y-2 lg:border-b-0 lg:pb-1">
          {confirming ? (
            <>
              <button
                onClick={handleSimulate}
                disabled={simulating}
                className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-400 disabled:opacity-50 lg:w-full"
              >
                确认开始团队模拟？
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={simulating}
                className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs text-slate-500 transition-colors hover:border-rose-400 hover:text-rose-600 lg:w-full"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={simulating}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors lg:w-full ${
                simulating ? 'bg-rose-300' : 'bg-rose-500 hover:bg-rose-400'
              } disabled:cursor-wait`}
            >
              {simulating ? '⏳ 模拟中…' : '⚔️ 跑一局团队模拟'}
            </button>
          )}
          <button
            onClick={handleReload}
            disabled={reloading || simulating}
            className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs text-slate-500 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 lg:w-full"
          >
            {reloading ? '重载中…' : '🔄 重新加载存档'}
          </button>

          {/* 种子输入：勾选后按文本框里的种子跑（同种子可复现），不勾选或留空则服务端随机生成 */}
          <div className="flex w-full shrink-0 items-center gap-2 lg:mt-1.5">
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={useFixedSeed}
                onChange={e => setUseFixedSeed(e.target.checked)}
                disabled={simulating}
                className="h-3.5 w-3.5 cursor-pointer accent-rose-500"
              />
              指定种子
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              placeholder="留空 = 随机"
              title="勾选「指定种子」后按此种子跑一局（同种子可复现）；不勾选或留空则服务端随机生成，跑完会把实际种子填回这里"
              disabled={simulating}
              className={`min-w-0 flex-1 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none transition-colors placeholder:text-slate-300 focus:border-rose-400 disabled:opacity-50 lg:w-full ${
                useFixedSeed ? '' : 'opacity-70'
              }`}
            />
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:space-y-1 lg:p-3">
          {NAV.map(item => (
            <a
              key={item.key}
              href={panelPaths[item.key]}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors lg:w-full lg:gap-3 lg:px-3 lg:py-2.5 lg:text-left ${
                panel === item.key
                  ? 'bg-rose-500/10 text-rose-600 ring-1 ring-rose-400/40'
                  : 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>
                <span className="block whitespace-nowrap font-semibold">{item.label}</span>
                <span className="hidden text-[11px] font-normal opacity-60 lg:block">{item.desc}</span>
              </span>
            </a>
          ))}
        </nav>
      </aside>

      {/* 内容区 */}
      <main className="min-w-0 flex-1">{children}</main>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 w-[90%] max-w-md -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ring-1 ${
            toast.tone === 'success' ? 'bg-emerald-600 ring-emerald-400/50' : 'bg-red-600 ring-red-400/50'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
