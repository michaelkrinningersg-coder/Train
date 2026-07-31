import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import type { City, CityId } from '@game/domain'
import { distanceKm } from '@game/geo'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rgba, THEME } from '../theme.js'
import { resolveStyle } from './mapStyle.js'

const ATTRIBUTION =
  'Basiskarte © <a href="https://maplibre.org/">MapLibre</a> · ' +
  'Staedte <a href="https://www.geonames.org/">GeoNames</a> (CC BY 4.0)'

/** Punktradius in Pixeln. Einwohnerzahl per Wurzelskala auf die Flaeche abgebildet. */
function dotRadius(population: number): number {
  return 3.2 + 17 * Math.sqrt(Math.min(population, 4_000_000) / 4_000_000)
}

/** Ab welcher Einwohnerzahl der Name ueberhaupt fuer eine Beschriftung infrage kommt. */
const LABEL_THRESHOLD = 40_000
/** Mindestabstand zweier Beschriftungen auf dem Bildschirm. */
const LABEL_SEPARATION_PX = 95

/**
 * Meter pro Bildschirmpixel im Web-Mercator. Das `+ 1` im Exponenten ist kein
 * Schreibfehler: MapLibre definiert seinen Zoom ueber 512-px-Kacheln, nicht ueber
 * die klassischen 256-px-Kacheln. Ohne den Term liegt der Massstab um Faktor 2 daneben.
 */
function metresPerPixel(zoom: number, latitude: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** (zoom + 1)
}

/**
 * Beschriftungen entzerren: absteigend nach Einwohnerzahl, ein Name wird nur
 * gesetzt, wenn er weit genug von allen bereits gesetzten entfernt ist. Im
 * Ballungsraum Nuernberg/Fuerth/Erlangen gewinnt so die groesste Stadt, statt
 * dass sich drei Namen uebereinanderlegen.
 *
 * Bewusst selbst gerechnet statt per CollisionFilterExtension: die Extension
 * verwirft unter MapboxOverlay saemtliche Labels.
 */
function declutter(cities: readonly City[], zoom: number): City[] {
  const candidates = cities
    .filter((c) => c.population >= LABEL_THRESHOLD)
    .sort((a, b) => b.population - a.population)

  const accepted: City[] = []
  for (const city of candidates) {
    const minDistanceKm = (LABEL_SEPARATION_PX * metresPerPixel(zoom, city.centre[1])) / 1000
    if (accepted.every((a) => distanceKm(a.centre, city.centre) >= minDistanceKm)) {
      accepted.push(city)
    }
  }
  return accepted
}

export interface MapViewProps {
  readonly cities: readonly City[]
  readonly view: { readonly centre: readonly [number, number]; readonly zoom: number }
  readonly selectedId: CityId | null
  readonly onSelect: (city: City | null) => void
}

export function MapView({ cities, view, selectedId, onSelect }: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  // Nur fuer die Beschriftungsdichte. Wird erst nach Ende der Bewegung
  // aktualisiert, damit waehrend des Zoomens keine Layer neu gebaut werden.
  const [zoom, setZoom] = useState(view.zoom)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: resolveStyle(),
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
        object
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

    // 'load' synchronisiert den Startwert, falls MapLibre den Zoom anpasst.
    map.on('load', () => setZoom(map.getZoom()))
    map.on('moveend', () => setZoom(map.getZoom()))

    // Klick ins Leere hebt die Auswahl auf. Der Handler haengt an MapLibre und
    // nicht an deck.gl: die deck.gl-Leinwand liegt zwar oben, hat aber
    // pointer-events:none - alle Zeigerereignisse laufen ueber MapLibre.
    map.on('click', (e) => {
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4 })
      if (!picked) selectRef.current(null)
    })

    return () => {
      overlayRef.current = null
      map.remove()
    }
    // Absichtlich nur einmal: die Startansicht ist kein reaktiver Zustand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layers = useMemo<Layer[]>(() => {
    const labelled = declutter(cities, zoom)
    // deck.gl rendert nur Zeichen aus dem Atlas - Umlaute muessen mit hinein.
    const characterSet = new Set<string>()
    for (const c of labelled) for (const ch of c.name) characterSet.add(ch)

    return [
      // Einzugsgebiet in echten Metern: zeigt, wie weit ein Bahnhof hier traegt.
      new ScatterplotLayer<City>({
        id: 'city-catchment',
        data: cities as City[],
        getPosition: (d) => [d.centre[0], d.centre[1]],
        getRadius: (d) => d.radiusKm * 1000,
        radiusUnits: 'meters',
        filled: true,
        stroked: true,
        lineWidthMinPixels: 1,
        getFillColor: rgba(THEME.city, 22),
        getLineColor: rgba(THEME.city, 55),
        pickable: false,
      }),
      new ScatterplotLayer<City>({
        id: 'city-dot',
        data: cities as City[],
        getPosition: (d) => [d.centre[0], d.centre[1]],
        getRadius: (d) => dotRadius(d.population),
        radiusUnits: 'pixels',
        filled: true,
        stroked: true,
        // 2px Flaechenring, damit sich ueberlappende Punkte trennen.
        lineWidthUnits: 'pixels',
        getLineWidth: (d) => (d.id === selectedId ? 2.5 : 2),
        getFillColor: rgba(THEME.city),
        getLineColor: (d) => (d.id === selectedId ? rgba(THEME.textPrimary) : rgba(THEME.surface)),
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 70],
        onClick: ({ object }) => {
          selectRef.current(object ?? null)
          return true
        },
        updateTriggers: { getLineColor: selectedId, getLineWidth: selectedId },
      }),
      new TextLayer<City>({
        id: 'city-label',
        data: labelled,
        characterSet: [...characterSet],
        getPosition: (d) => [d.centre[0], d.centre[1]],
        getText: (d) => d.name,
        getSize: 11,
        sizeUnits: 'pixels',
        getColor: rgba(THEME.textSecondary),
        getPixelOffset: (d) => [0, -(dotRadius(d.population) + 13)],
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        outlineWidth: 3,
        outlineColor: rgba(THEME.plane, 220),
        fontSettings: { sdf: true },
        pickable: false,
      }),
    ]
  }, [cities, selectedId, zoom])

  useEffect(() => {
    overlayRef.current?.setProps({ layers })
  }, [layers])

  return <div ref={containerRef} className="map" />
}
