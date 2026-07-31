import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import type { City } from '@game/domain'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../game/store.js'
import { THEME } from '../theme.js'
import { buildLayers } from './layers.js'
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
  const mapMode = useGame((s) => s.mapMode)
  const basemapId = useGame((s) => s.basemap)
  const basemap = basemapById(basemapId)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Aktionen ueber ein Ref, damit der Karten-Effekt nur einmal laeuft.
  const actions = useRef({ mapMode, draft })
  actions.current = { mapMode, draft }

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
      getTooltip: ({ object }: PickingInfo<City>) =>
        object && 'population' in object
          ? {
              html: `<strong>${object.name}</strong><br/>${object.population.toLocaleString('de-DE')} Einwohner`,
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

    // Klick ins Leere hebt die Auswahl auf. Der Handler haengt an MapLibre und
    // nicht an deck.gl: die deck.gl-Leinwand liegt zwar oben, hat aber
    // pointer-events:none - alle Zeigerereignisse laufen ueber MapLibre.
    map.on('click', (e) => {
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4 })
      if (!picked) {
        useGame.getState().selectCity(null)
        useGame.getState().selectLine(null)
      }
    })

    return () => {
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
      tone: basemap.tone,
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
          const stop = [...store.state!.network.stations.values()].find((s) => s.cityId === city.id)
          if (stop) store.toggleDraftStop(stop.id)
          else store.notify(`${city.name} hat noch keine Haltestelle.`)
          return
        }
        store.selectCity(city.id)
      },
    })
  }, [state, demand, zoom, selectedCityId, selectedLineId, draft, showDemand, basemap.tone])

  useEffect(() => {
    overlayRef.current?.setProps({ layers })
  }, [layers])

  return <div ref={containerRef} className={`map${mapMode === 'draw-line' ? ' map--picking' : ''}`} />
}
