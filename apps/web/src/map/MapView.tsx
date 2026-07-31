import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import type { City } from '@game/domain'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../game/store.js'
import { THEME } from '../theme.js'
import { buildLayers, type LoadLink } from './layers.js'
import { basemapById, hidePlaceLabels, loadStyle, PLAIN_STYLE } from './mapStyle.js'

// Nur unsere eigene Quelle. Die Herkunft der Basiskarte liefert der jeweilige
// Stil selbst mit - bei den OSM-Stilen ist das die von der ODbL geforderte
// Nennung der OpenStreetMap-Mitwirkenden.
const ATTRIBUTION = 'Städte <a href="https://www.geonames.org/">GeoNames</a> (CC BY 4.0)'

export interface MapViewProps {
  readonly view: { readonly centre: readonly [number, number]; readonly zoom: number }
}

export function MapView({ view }: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Nur fuer die Beschriftungsdichte; erst nach Ende der Bewegung aktualisiert,
  // damit waehrend des Zoomens keine Layer neu gebaut werden.
  const [zoom, setZoom] = useState(view.zoom)

  const state = useGame((s) => s.state)
  const demand = useGame((s) => s.demand)
  const selectedCityId = useGame((s) => s.selectedCityId)
  const selectedLineId = useGame((s) => s.selectedLineId)
  const draft = useGame((s) => s.draft)
  const showDemand = useGame((s) => s.showDemand)
  const showLoad = useGame((s) => s.showLoad)
  const mapMode = useGame((s) => s.mapMode)
  const selectedTrackId = useGame((s) => s.selectedTrackId)
  const trackDraft = useGame((s) => s.trackDraft)
  const hoverPoint = useGame((s) => s.hoverPoint)
  const basemapId = useGame((s) => s.basemap)
  const basemap = basemapById(basemapId)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Aktueller Modus ueber ein Ref, damit der Karten-Effekt nur einmal laeuft.
  const actions = useRef({ mapMode })
  actions.current = { mapMode }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: PLAIN_STYLE,
      center: [view.centre[0], view.centre[1]],
      zoom: view.zoom,
      minZoom: 3,
      maxZoom: 14,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }))
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    const overlay = new MapboxOverlay({
      interleaved: false,
      getTooltip: ({ object }: PickingInfo<City | LoadLink>) =>
        object && (('population' in object) || ('load' in object))
          ? {
              html:
                'load' in object
                  ? `<strong>${object.lineName}</strong><br/>${object.from} → ${object.to}<br/>${Math.round(object.load * 100)} % ausgelastet`
                  : `<strong>${object.name}</strong><br/>${object.population.toLocaleString('de-DE')} Einwohner`,
              style: {
                background: THEME.surface,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.hairline}`,
                borderRadius: '6px',
                padding: '6px 9px',
                fontSize: '12px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
              },
            }
          : null,
    })
    map.addControl(overlay)
    overlayRef.current = overlay
    mapRef.current = map

    map.on('load', () => setZoom(map.getZoom()))
    map.on('moveend', () => setZoom(map.getZoom()))

    // Alle Zeigerereignisse laufen ueber MapLibre: die deck.gl-Leinwand liegt
    // zwar oben, hat aber pointer-events:none.
    map.on('click', (e) => {
      const store = useGame.getState()
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 6 })
      const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]

      if (store.mapMode === 'place-station') {
        store.placeStation(point)
        return
      }

      if (store.mapMode === 'place-loop') {
        store.placeLoop(point)
        return
      }

      if (store.mapMode === 'draw-track') {
        // Ein Klick auf einen Bahnhof setzt Start oder Ziel, alles andere ist
        // ein Stuetzpunkt der Trasse.
        const station = nearestRailStation(store, point, e.point, map)
        if (station) store.trackClickNode(station.nodeId)
        else store.trackAddWaypoint(point)
        return
      }

      if (!picked) {
        store.selectCity(null)
        store.selectLine(null)
        store.selectTrack(null)
      }
    })

    // Gummiband beim Streckenziehen. Nur im Bauwerkzeug gepflegt, sonst wuerde
    // jede Mausbewegung die Layer neu aufbauen.
    map.on('mousemove', (e) => {
      const store = useGame.getState()
      if (store.mapMode !== 'idle' && store.mapMode !== 'draw-line') {
        store.setHoverPoint([e.lngLat.lng, e.lngLat.lat])
      }
    })

    // Escape bricht das laufende Bauwerkzeug ab, Rücktaste nimmt einen
    // Stuetzpunkt zurueck.
    const onKey = (ev: KeyboardEvent): void => {
      const store = useGame.getState()
      if (store.mapMode !== 'draw-track' && store.mapMode !== 'place-station') return
      if (ev.key === 'Escape') store.cancelBuild()
      if (ev.key === 'Backspace') {
        ev.preventDefault()
        store.trackUndoWaypoint()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
    // Absichtlich nur einmal: die Startansicht ist kein reaktiver Zustand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stilwechsel. Das deck.gl-Overlay haengt als Control an der Karte und
  // ueberlebt setStyle, es muss also nicht neu aufgebaut werden.
  useEffect(() => {
    let cancelled = false
    loadStyle(basemap)
      .then((style) => {
        const map = mapRef.current
        if (cancelled || !map) return
        map.setStyle(style)
        map.once('styledata', () => hidePlaceLabels(map))
      })
      .catch((err: unknown) => {
        useGame.getState().notify(`Kartenstil "${basemap.label}" nicht ladbar: ${String(err)}`)
      })
    return () => {
      cancelled = true
    }
  }, [basemap])

  const layers = useMemo(() => {
    if (!state || !demand) return []
    const cities = [...state.cities.values()]

    return buildLayers({
      state,
      demand,
      cities,
      zoom,
      selectedCityId,
      selectedLineId,
      draft,
      showDemand,
      showLoad,
      tone: basemap.tone,
      selectedTrackId,
      trackDraft: trackDraft ? { from: trackDraft.from, waypoints: trackDraft.waypoints } : null,
      hoverPoint: mapMode === 'draw-track' ? hoverPoint : null,
      onPickTrack: (id) => useGame.getState().selectTrack(id),
      onPickLine: (id) => useGame.getState().selectLine(id),
      onPickCity: (city) => {
        const store = useGame.getState()
        if (!city) {
          store.selectCity(null)
          return
        }
        // Im Zeichenmodus ist ein Klick auf eine erschlossene Stadt das
        // Hinzufuegen zur Linie, nicht das Oeffnen der Stadtdetails.
        if (actions.current.mapMode === 'draw-line') {
          const rail = store.draftMode === 'rail'
          const stop = [...store.state!.network.stations.values()].find(
            (s) => s.cityId === city.id && (rail ? s.mode !== 'bus' : s.mode !== 'rail'),
          )
          if (stop) store.toggleDraftStop(stop.id)
          else store.notify(`${city.name} hat ${rail ? 'noch keinen Bahnhof' : 'noch keine Haltestelle'}.`)
          return
        }
        store.selectCity(city.id)
      },
    })
  }, [state, demand, zoom, selectedCityId, selectedLineId, draft, showDemand, showLoad, basemap.tone, selectedTrackId, trackDraft, hoverPoint, mapMode])

  useEffect(() => {
    overlayRef.current?.setProps({ layers })
  }, [layers])

  const picking = mapMode !== 'idle'
  return <div ref={containerRef} className={`map${picking ? ' map--picking' : ''}`} />
}

/**
 * Bahnhof unter dem Zeiger. Die Suche laeuft ueber Bildschirmentfernung und
 * nicht ueber deck.gl-Picking, weil die Bahnhofspunkte klein sind und beim
 * Trassenziehen ein grosszuegigerer Fangbereich viel angenehmer ist.
 */
function nearestRailStation(
  store: ReturnType<typeof useGame.getState>,
  point: [number, number],
  screen: { x: number; y: number },
  map: maplibregl.Map,
): { nodeId: import('@game/domain').NodeId } | null {
  const state = store.state
  if (!state) return null

  const SNAP_PX = 18
  let best: { nodeId: import('@game/domain').NodeId; distance: number } | null = null

  for (const station of state.network.stations.values()) {
    if (station.mode === 'bus') continue
    const projected = map.project([station.position[0], station.position[1]])
    const dx = projected.x - screen.x
    const dy = projected.y - screen.y
    const distance = Math.hypot(dx, dy)
    if (distance <= SNAP_PX && (!best || distance < best.distance)) {
      best = { nodeId: station.nodeId, distance }
    }
  }
  void point
  return best ? { nodeId: best.nodeId } : null
}
