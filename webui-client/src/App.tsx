import { useEffect, useState } from 'react'
import BattleView from './components/BattleView'
import ReplayPanel from './components/ReplayPanel'
import RoomPanel from './components/RoomPanel'
import TestCenter from './components/TestCenter'
import TopBar from './components/TopBar'

// 单人模式已拆成独立项目 webui-solo（见仓库根目录），本客户端不再包含该 Tab。
type Tab = 'test' | 'battle' | 'replay' | 'room'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'test', label: '测试中心', icon: '⚗' },
  { id: 'room', label: '房间', icon: '🚪' },
  { id: 'battle', label: '战斗对局', icon: '⚔' },
  { id: 'replay', label: '回放', icon: '📜' },
]

function readInitialTab(): Tab {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'battle' || hash === 'replay' || hash === 'test' || hash === 'room') return hash
  return 'test'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readInitialTab)

  useEffect(() => {
    const onHash = () => {
      const next = readInitialTab()
      setTab(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    setTab(t)
    if (window.location.hash !== `#${t}`) window.history.replaceState(null, '', `#${t}`)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <TopBar />

      {/* Tab 切换（窄屏可横向滑动，不换行挤压） */}
      <nav className="flex shrink-0 flex-nowrap gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-4 py-2 text-[13px] font-medium transition-all ${
              tab === t.id
                ? 'border-gold-500/60 bg-gradient-to-b from-gold-300/25 to-gold-500/10 text-gold-600 shadow-sm shadow-gold-500/15'
                : 'border-ink-400/20 bg-parchment-200/50 text-ink-500 hover:bg-parchment-300/60 hover:text-ink-700'
            }`}
          >
            <span className="text-[14px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* 内容区 */}
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === 'test' && <TestCenter />}
        {tab === 'room' && <RoomPanel />}
        {tab === 'battle' && <BattleView />}
        {tab === 'replay' && <ReplayPanel />}
      </main>

      <footer className="shrink-0 text-center text-[11px] text-ink-400">
        <span className="font-fantasy">FunGame Server</span> 测试客户端 · 面向 FunGame.Core v3 战斗系统 · React + Tailwind CSS
      </footer>
    </div>
  )
}
