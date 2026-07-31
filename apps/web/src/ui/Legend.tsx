/** Groessenlegende: die Einwohnerzahl ist ueber den Radius kodiert, nicht ueber die Farbe. */
const SAMPLES = [
  { population: 50_000, label: '50 Tsd.' },
  { population: 250_000, label: '250 Tsd.' },
  { population: 1_500_000, label: '1,5 Mio.' },
] as const

function dotRadius(population: number): number {
  return 3.2 + 17 * Math.sqrt(Math.min(population, 4_000_000) / 4_000_000)
}

export function Legend(): React.JSX.Element {
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
      <span className="legend__item legend__item--catch">
        <span className="legend__ring" /> Stadtradius
      </span>
    </div>
  )
}
