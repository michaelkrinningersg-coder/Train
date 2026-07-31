import type { City } from '@game/domain'
import { useMemo, useState } from 'react'
import { useGame } from '../game/store.js'

/**
 * Städtesuche.
 *
 * In Bayern waren es 65 Städte, und jede war auf der Karte zu finden. In
 * Deutschland sind es 694, im Ruhrgebiet liegen zehn Großstädte auf achtzig
 * Kilometern, und ein Auftrag, der „Duisburg – Dortmund verbinden" verlangt,
 * schickte den Spieler bis hierher auf die Suche nach zwei unbeschrifteten
 * Punkten in einem Klumpen aus zweihundert.
 *
 * Sortiert wird nach Einwohnerzahl und nicht alphabetisch: wer „Frank" tippt,
 * meint Frankfurt am Main und nicht Frankfurt (Oder). Treffer am Wortanfang
 * stehen vor Treffern in der Mitte, damit „Essen" nicht hinter „Bad Essen"
 * verschwindet.
 */

const MAX_HITS = 8

export function CitySearch(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const focusCity = useGame((s) => s.focusCity)
  const [query, setQuery] = useState('')

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2 || !state) return []

    const scored: { city: City; rank: number }[] = []
    for (const city of state.cities.values()) {
      const name = city.name.toLowerCase()
      const at = name.indexOf(needle)
      if (at < 0) continue
      scored.push({ city, rank: at === 0 ? 0 : 1 })
    }
    scored.sort((a, b) => a.rank - b.rank || b.city.population - a.city.population)
    return scored.slice(0, MAX_HITS).map((s) => s.city)
  }, [query, state])

  if (!state) return null

  const pick = (city: City): void => {
    focusCity(city.id)
    setQuery('')
  }

  return (
    <div className="search">
      <input
        type="search"
        className="search__input"
        placeholder="Stadt suchen …"
        value={query}
        aria-label="Stadt suchen"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0])
          if (e.key === 'Escape') setQuery('')
        }}
      />
      {hits.length > 0 && (
        <ul className="search__hits">
          {hits.map((city) => (
            <li key={city.id}>
              <button type="button" onClick={() => pick(city)}>
                <span>{city.name}</span>
                <span className="muted num">{Math.round(city.population / 1000).toLocaleString('de-DE')} Tsd.</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
