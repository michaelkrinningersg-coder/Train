import { useGame } from '../game/store.js'
import { basemapById } from '../map/mapStyle.js'
import { MARKS } from '../theme.js'

/** Größenlegende: die Einwohnerzahl ist über den Radius kodiert, nicht über die Farbe. */
const SAMPLES = [
  { population: 50_000, label: '50 Tsd.' },
  { population: 250_000, label: '250 Tsd.' },
  { population: 1_500_000, label: '1,5 Mio.' },
] as const

function dotRadius(population: number): number {
  return 3.2 + 17 * Math.sqrt(Math.min(population, 4_000_000) / 4_000_000)
}

export function Legend(): React.JSX.Element {
  const showDemand = useGame((s) => s.showDemand)
  const showLoad = useGame((s) => s.showLoad)
  const tone = basemapById(useGame((s) => s.basemap)).tone
  const maxDiameter = dotRadius(Math.max(...SAMPLES.map((s) => s.population))) * 2

  return (
    <div className="legend" aria-label="Legende">
      <span className="legend__title">Einwohner</span>
      {SAMPLES.map((s) => (
        <span key={s.population} className="legend__item">
          <span className="legend__swatch" style={{ width: maxDiameter, height: maxDiameter }}>
            <span style={{ width: dotRadius(s.population) * 2, height: dotRadius(s.population) * 2 }} />
          </span>
          {s.label}
        </span>
      ))}
      <span className="legend__sep" />
      <span className="legend__item">
        <span className="legend__ring legend__ring--stop" /> Haltestelle
      </span>
      <span className="legend__item">
        <span className="legend__stroke legend__stroke--line" /> Linie
      </span>
      {showDemand && (
        <span className="legend__item">
          <span className="legend__stroke legend__stroke--demand" /> Nachfrage
        </span>
      )}
      {showLoad && (
        <>
          <span className="legend__sep" />
          <span className="legend__item">
            leer
            <span
              className="legend__ramp"
              style={{ background: `linear-gradient(to right, ${MARKS[tone].load.join(', ')})` }}
            />
            voll
          </span>
        </>
      )}
    </div>
  )
}
