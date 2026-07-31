import { useEffect } from 'react'
import { useCityDataset } from './data/dataset.js'
import { SPEED_INTERVAL_MS, useGame, type Tab } from './game/store.js'
import { MapView } from './map/MapView.js'
import { CityPanel } from './ui/CityPanel.js'
import { FinanceTab } from './ui/FinanceTab.js'
import { FleetTab } from './ui/FleetTab.js'
import { Legend } from './ui/Legend.js'
import { NetworkTab } from './ui/NetworkTab.js'
import { TopBar } from './ui/TopBar.js'

const REGION = import.meta.env['VITE_REGION'] ?? 'bavaria'

const TABS: { readonly id: Tab; readonly label: string }[] = [
  { id: 'network', label: 'Netz' },
  { id: 'fleet', label: 'Fuhrpark' },
  { id: 'finance', label: 'Finanzen' },
]

export function App(): React.JSX.Element {
  const dataset = useCityDataset(REGION)
  const ready = useGame((s) => s.ready)
  const start = useGame((s) => s.start)
  const tab = useGame((s) => s.tab)
  const setTab = useGame((s) => s.setTab)
  const speed = useGame((s) => s.speed)
  const step = useGame((s) => s.step)
  const selectedCityId = useGame((s) => s.selectedCityId)
  const message = useGame((s) => s.message)
  const notify = useGame((s) => s.notify)

  useEffect(() => {
    if (dataset.status === 'ready' && !ready) start(dataset.data.cities)
  }, [dataset, ready, start])

  // Spieluhr. Bewusst ein einfacher Timer: ein Betriebstag rechnet in wenigen
  // Millisekunden, ein Web Worker waere hier noch verfrueht.
  useEffect(() => {
    if (speed === 0) return
    const id = setInterval(() => step(1), SPEED_INTERVAL_MS[speed])
    return () => clearInterval(id)
  }, [speed, step])

  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => notify(null), 4000)
    return () => clearTimeout(id)
  }, [message, notify])

  if (dataset.status === 'loading') {
    return <p className="notice">Städte werden geladen …</p>
  }
  if (dataset.status === 'error') {
    return (
      <div className="notice notice--error">
        <p>{dataset.message}</p>
        <pre>pnpm data:cities</pre>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {ready && <MapView view={dataset.data.view} />}
        <Legend />
        {selectedCityId && <CityPanel cityId={selectedCityId} />}

        <aside className="sidebar">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="sidebar__body">
            {tab === 'network' && <NetworkTab />}
            {tab === 'fleet' && <FleetTab />}
            {tab === 'finance' && <FinanceTab />}
          </div>
        </aside>

        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </main>
    </div>
  )
}
