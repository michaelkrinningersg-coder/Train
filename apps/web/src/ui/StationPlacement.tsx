import { cityRadiusKm, stationCatchment } from '@game/domain'
import { formatMoney, landPriceFactor, railStationCost, railStationUpkeep } from '@game/economy'
import { distanceKm } from '@game/geo'
import { useGame } from '../game/store.js'

const PLATFORMS = [1, 2, 4, 6, 8] as const

/**
 * Bahnhofsplatzierung. Das ist die zentrale Abwägung der Bauphase: zentral
 * bedeutet viele Fahrgäste und teures Grundstück, am Stadtrand billig und nur
 * die Hälfte der Nachfrage.
 */
export function StationPlacement(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const draft = useGame((s) => s.stationDraft)
  const hoverPoint = useGame((s) => s.hoverPoint)
  const setPlatforms = useGame((s) => s.setStationPlatforms)
  const cancel = useGame((s) => s.cancelBuild)
  if (!state || !draft) return null

  const city = state.cities.get(draft.cityId)
  if (!city) return null

  const radius = cityRadiusKm(city.population)
  const distance = hoverPoint ? distanceKm(city.centre, hoverPoint) : 0
  const inRange = distance <= radius * 2
  const catchment = stationCatchment(distance, radius)
  const cost = railStationCost(city.population, distance, draft.platforms)

  return (
    <aside className="panel" aria-label="Bahnhof platzieren">
      <header className="panel__head">
        <div>
          <h2>Bahnhof in {city.name}</h2>
          <p className="muted">Standort auf der Karte anklicken</p>
        </div>
        <button type="button" className="panel__close" onClick={cancel} aria-label="Abbrechen">
          ×
        </button>
      </header>

      <div className="field">
        <span className="field__label">Bahnsteiggleise</span>
        <div className="segmented">
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className={draft.platforms === p ? 'on' : ''} onClick={() => setPlatforms(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <dl className="facts">
        <div>
          <dt>Abstand zum Zentrum</dt>
          <dd className={`num ${inRange ? '' : 'neg'}`}>{distance.toFixed(1)} km</dd>
        </div>
        <div>
          <dt>Einzugsgrad</dt>
          <dd className="num">{Math.round(catchment * 100)} %</dd>
        </div>
        <div>
          <dt>Grundstückspreis</dt>
          <dd className="num">×{landPriceFactor(distance, radius).toFixed(2)}</dd>
        </div>
        <div>
          <dt>Baukosten</dt>
          <dd className={`num ${cost > state.cash ? 'neg' : ''}`}>{formatMoney(cost, { compact: true })}</dd>
        </div>
        <div>
          <dt>Unterhalt</dt>
          <dd className="num">{formatMoney(railStationUpkeep(draft.platforms))} / Tag</dd>
        </div>
      </dl>

      {!inRange && <p className="warn small">⚠ Zu weit von {city.name} entfernt — höchstens {(radius * 2).toFixed(1)} km.</p>}
      {cost > state.cash && (
        <p className="warn small">
          ⚠ Nicht genug Kapital — {formatMoney(cost - state.cash, { compact: true })} fehlen. Weiter außerhalb oder mit
          weniger Bahnsteiggleisen wird es günstiger.
        </p>
      )}
      <p className="muted small">
        Zentral heißt viele Fahrgäste und teures Land, am Stadtrand billig und nur ein Teil der Nachfrage. Der Kreis auf
        der Karte zeigt das Stadtgebiet.
      </p>
    </aside>
  )
}
