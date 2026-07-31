import { SEGMENTS, type CityId } from '@game/domain'
import { busStopCost, formatMoney } from '@game/economy'
import { useGame } from '../game/store.js'

const de = (n: number): string => n.toLocaleString('de-DE')

export function CityPanel({ cityId }: { readonly cityId: CityId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const demand = useGame((s) => s.demand)
  const dispatch = useGame((s) => s.dispatch)
  const selectCity = useGame((s) => s.selectCity)
  if (!state) return null

  const city = state.cities.get(cityId)
  if (!city) return null

  const stop = [...state.network.stations.values()].find((s) => s.cityId === cityId)
  const cost = busStopCost(city.population)

  // Erzeugte Reisen: Stufe 1 des Nachfragemodells, direkt aus den Potenzialen.
  const generated = Object.values(SEGMENTS).map((s) => ({
    label: s.label,
    trips: Math.round(city.potential?.[s.id].origin ?? 0),
  }))
  const totalTrips = generated.reduce((n, g) => n + g.trips, 0)

  // Staerkste Ziele dieser Stadt - die Vorlage fuer die naechste Linie.
  const destinations = demand
    ? demand.pairs
        .filter((p) => p.from === cityId)
        .slice(0, 6)
        .map((p) => ({
          name: state.cities.get(p.to)?.name ?? '?',
          trips: Math.round(p.totalTrips),
          km: Math.round(p.distanceKm),
        }))
    : []

  return (
    <aside className="panel" aria-label={`Details zu ${city.name}`}>
      <header className="panel__head">
        <div>
          <h2>{city.name}</h2>
          <p className="muted">{city.country}</p>
        </div>
        <button type="button" className="panel__close" onClick={() => selectCity(null)} aria-label="Schließen">
          ×
        </button>
      </header>

      <dl className="facts">
        <div>
          <dt>Einwohner</dt>
          <dd className="num">{de(city.population)}</dd>
        </div>
        <div>
          <dt>Stadtradius</dt>
          <dd className="num">{city.radiusKm.toFixed(1)} km</dd>
        </div>
        <div>
          <dt>Erzeugte Reisen</dt>
          <dd className="num">{de(totalTrips)} / Tag</dd>
        </div>
      </dl>

      {stop ? (
        <p className="ok small">✓ Haltestelle vorhanden · Unterhalt {formatMoney(stop.upkeepPerDay)}/Tag</p>
      ) : (
        <button
          type="button"
          className="primary wide"
          disabled={state.cash < cost}
          onClick={() => dispatch({ kind: 'place_bus_stop', cityId })}
        >
          Haltestelle bauen · {formatMoney(cost)}
        </button>
      )}

      {destinations.length > 0 && (
        <section>
          <h3>Stärkste Ziele</h3>
          <table className="segments">
            <tbody>
              {destinations.map((d) => (
                <tr key={d.name}>
                  <th scope="row">{d.name}</th>
                  <td className="num">{de(d.trips)}</td>
                  <td className="num muted">{d.km} km</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Reisen pro Tag in diese Richtung, über alle Verkehrsmittel.</p>
        </section>
      )}

      <section>
        <h3>Reisende nach Segment</h3>
        <table className="segments">
          <tbody>
            {generated.map((g) => (
              <tr key={g.label}>
                <th scope="row">{g.label}</th>
                <td className="num">{de(g.trips)}</td>
                <td className="bar">
                  <span style={{ width: `${totalTrips > 0 ? (g.trips / totalTrips) * 100 : 0}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  )
}
