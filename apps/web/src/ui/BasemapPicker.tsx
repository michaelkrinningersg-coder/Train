import { BASEMAPS } from '../map/mapStyle.js'
import { useGame } from '../game/store.js'

/**
 * Umschalter für die Basiskarte. „Schlicht" hält die Karte zurück, damit das
 * eigene Netz wirkt; die OSM-Stile zeigen Gelände, Gewässer, Wälder, Straßen
 * und bestehende Bahnstrecken — was man zum Planen einer Trasse braucht.
 */
export function BasemapPicker(): React.JSX.Element {
  const basemap = useGame((s) => s.basemap)
  const setBasemap = useGame((s) => s.setBasemap)

  return (
    <label className="basemap">
      <span className="topbar__label">Karte</span>
      <select value={basemap} onChange={(e) => setBasemap(e.target.value)}>
        {BASEMAPS.map((b) => (
          <option key={b.id} value={b.id} title={b.hint}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
  )
}
