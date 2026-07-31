import type { City } from '@game/domain'
import { SEGMENTS } from '@game/domain'

const de = (n: number): string => n.toLocaleString('de-DE')

export interface CityPanelProps {
  readonly city: City | null
  readonly onClose: () => void
}

export function CityPanel({ city, onClose }: CityPanelProps): React.JSX.Element | null {
  if (!city) return null

  // Grobe Vorschau des Quellpotenzials. Die belastbare Rechnung kommt in Phase 1
  // mit @game/demand - hier nur Stufe 1 (Verkehrserzeugung), damit die Groessen-
  // ordnungen frueh sichtbar und diskutierbar sind.
  const generated = Object.values(SEGMENTS).map((s) => ({
    label: s.label,
    trips: Math.round(city.population * s.populationShare * s.tripsPerPersonDay),
  }))
  const totalTrips = generated.reduce((n, g) => n + g.trips, 0)

  return (
    <aside className="panel" aria-label={`Details zu ${city.name}`}>
      <header className="panel__head">
        <div>
          <h2>{city.name}</h2>
          <p className="muted">{city.country}</p>
        </div>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Schliessen">
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
          <dt>Position</dt>
          <dd className="num">
            {city.centre[1].toFixed(3)}° N, {city.centre[0].toFixed(3)}° O
          </dd>
        </div>
      </dl>

      {city.absorbed && city.absorbed.length > 0 && (
        <section>
          <h3>Zur Agglomeration gerechnet</h3>
          <ul className="chips">
            {city.absorbed.map((a) => (
              <li key={a.name}>
                {a.name} <span className="muted num">+{de(a.population)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Erzeugte Reisen pro Tag</h3>
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
        <p className="muted small">
          Stufe 1 des Nachfragemodells (Verkehrserzeugung). Verteilung und Verkehrsmittelwahl folgen in Phase 1.
        </p>
      </section>
    </aside>
  )
}
