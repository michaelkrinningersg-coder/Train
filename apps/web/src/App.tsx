import type { City, CityId } from '@game/domain'
import { useMemo, useState } from 'react'
import { useCityDataset } from './data/dataset.js'
import { MapView } from './map/MapView.js'
import { CityPanel } from './ui/CityPanel.js'
import { Legend } from './ui/Legend.js'

const REGION = import.meta.env['VITE_REGION'] ?? 'bavaria'

export function App(): React.JSX.Element {
  const state = useCityDataset(REGION)
  const [selectedId, setSelectedId] = useState<CityId | null>(null)

  const cities = state.status === 'ready' ? state.data.cities : []
  const selected = useMemo(() => cities.find((c) => c.id === selectedId) ?? null, [cities, selectedId])

  const totalPopulation = useMemo(() => cities.reduce((n, c) => n + c.population, 0), [cities])

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">Rail &amp; Road</span>
        {state.status === 'ready' && (
          <>
            <span className="topbar__region">{state.data.label}</span>
            <span className="topbar__stat">
              <b className="num">{cities.length}</b> Staedte
            </span>
            <span className="topbar__stat">
              <b className="num">{totalPopulation.toLocaleString('de-DE')}</b> Einwohner
            </span>
            <span className="topbar__stat muted">
              ab {state.data.minPopulation.toLocaleString('de-DE')} Einwohnern
            </span>
          </>
        )}
        <span className="topbar__phase">Phase 0</span>
      </header>

      <main className="stage">
        {state.status === 'loading' && <p className="notice">Staedte werden geladen …</p>}
        {state.status === 'error' && (
          <div className="notice notice--error">
            <p>{state.message}</p>
            <pre>pnpm data:cities</pre>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <MapView
              cities={cities}
              view={state.data.view}
              selectedId={selectedId}
              onSelect={(city: City | null) => setSelectedId(city?.id ?? null)}
            />
            <Legend />
            <CityPanel city={selected} onClose={() => setSelectedId(null)} />
          </>
        )}
      </main>
    </div>
  )
}
