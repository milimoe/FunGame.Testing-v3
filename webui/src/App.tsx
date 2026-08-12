import { useState } from 'react'
import Layout from './components/Layout'
import StatsPanel from './components/StatsPanel'
import ReplayPanel from './components/ReplayPanel'
import SnapshotPanel from './components/SnapshotPanel'

export type PanelKey = 'stats' | 'replay' | 'snapshot'

export default function App() {
  const [panel, setPanel] = useState<PanelKey>('stats')
  return (
    <Layout panel={panel} onSelect={setPanel}>
      {panel === 'stats' && <StatsPanel />}
      {panel === 'replay' && <ReplayPanel />}
      {panel === 'snapshot' && <SnapshotPanel />}
    </Layout>
  )
}
