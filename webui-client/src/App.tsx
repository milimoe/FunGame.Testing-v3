import { useEffect, useState } from 'react'
import BattleView from './components/BattleView'
import ReplayPanel from './components/ReplayPanel'
import RoomPanel from './components/RoomPanel'
import SoloPanel from './components/solo/SoloPanel'
import TestCenter from './components/TestCenter'
import TopBar from './components/TopBar'

type Tab = 'test' | 'battle' | 'replay' | 'room' | 'solo'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'test', label: '测试中心', icon: '⚗' },
  { id: 'room', label: '房间', icon: '🚪' },
  { id: 'solo', label: '单人模式', icon: '🎮' },
  { id: 'battle', label: '战斗对局', icon: '⚔' },
  { id: 'replay', label: '回放', icon: '📜' },
]

function readInitialTab(): Tab {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'battle' || hash === 'replay' || hash === 'test' || hash === 'room' || hash === 'solo') return hash
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

      {/* Tab 切换 */}
      <nav className="flex shrink-0 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-[13px] font-medium transition-all ${
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
        {tab === 'solo' && <SoloPanel />}
        {tab === 'battle' && <BattleView />}
        {tab === 'replay' && <ReplayPanel />}
      </main>

      <footer className="shrink-0 text-center text-[11px] text-ink-400">
        <span className="font-fantasy">FunGame Server</span> 测试客户端 · 面向 FunGame.Core v3 战斗系统 · React + Tailwind CSS
      </footer>
    </div>
  )
}
