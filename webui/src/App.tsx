import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import StatsPanel from './components/StatsPanel'
import ReplayPanel from './components/ReplayPanel'
import SnapshotPanel from './components/SnapshotPanel'

export type PanelKey = 'stats' | 'replay' | 'snapshot'

const PANEL_PATHS: Record<PanelKey, string> = {
  stats: '/stats',
  replay: '/replay',
  snapshot: '/snapshot',
}

function panelFromPath(pathname: string): PanelKey {
  if (pathname === '/snapshot' || /^\/snapshot\/\d+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot'
  if (pathname === '/replay' || /^\/replay\/\d+$/.test(pathname)) return 'replay'
  const entry = (Object.entries(PANEL_PATHS) as [PanelKey, string][]).find(([, path]) => path === pathname)
  return entry?.[0] ?? 'stats'
}

function snapshotRoundFromPath(pathname: string): number | undefined {
  const match = /^\/snapshot\/(\d+)(?:\/[^/]+)?$/.exec(pathname)
  return match ? Number(match[1]) : undefined
}

function snapshotCharacterFromPath(pathname: string): string | undefined {
  const match = /^\/snapshot\/\d+\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : undefined
}

function replayRoundFromPath(pathname: string): number | undefined {
  const match = /^\/replay\/(\d+)$/.exec(pathname)
  return match ? Number(match[1]) : undefined
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const panel = panelFromPath(pathname)
  const snapshotRound = snapshotRoundFromPath(pathname)
  const snapshotCharacter = snapshotCharacterFromPath(pathname)
  const replayRound = replayRoundFromPath(pathname)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)

    const normalizedPath = (panel === 'snapshot' && snapshotRound !== undefined) || (panel === 'replay' && replayRound !== undefined)
      ? pathname
      : PANEL_PATHS[panel]
    if (pathname !== normalizedPath) {
      window.history.replaceState(null, '', normalizedPath)
      setPathname(normalizedPath)
    }

    return () => window.removeEventListener('popstate', handlePopState)
  }, [panel, pathname, snapshotRound, replayRound])

  const selectSnapshotRound = (round: number) => {
    const nextPath = `/snapshot/${round}`
    window.history.pushState(null, '', nextPath)
    setPathname(nextPath)
  }

  const selectSnapshotCharacter = (characterId: string | null, round?: number) => {
    const targetRound = round ?? snapshotRound
    if (targetRound === undefined) return
    const nextPath = characterId
      ? `/snapshot/${targetRound}/${encodeURIComponent(characterId)}`
      : `/snapshot/${targetRound}`
    window.history.pushState(null, '', nextPath)
    setPathname(nextPath)
  }

  const selectReplayRound = (round: number) => {
    const nextPath = `/replay/${round}`
    window.history.pushState(null, '', nextPath)
    setPathname(nextPath)
  }

  return (
    <Layout panel={panel} panelPaths={PANEL_PATHS}>
      {panel === 'stats' && <StatsPanel />}
      {panel === 'replay' && <ReplayPanel requestedRound={replayRound} onRoundChange={selectReplayRound} />}
      {panel === 'snapshot' && (
        <SnapshotPanel
          requestedRound={snapshotRound}
          requestedCharacterId={snapshotCharacter}
          onRoundChange={selectSnapshotRound}
          onCharacterChange={selectSnapshotCharacter}
        />
      )}
    </Layout>
  )
}
