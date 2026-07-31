import { PathLayer, ScatterplotLayer, TextLayer, LineLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { City, CityId, GameState, LineId, StationId } from '@game/domain'
import type { DemandMatrix } from '@game/demand'
import { distanceKm } from '@game/geo'
import { MARKS, rgba, type MarkPalette, type Tone } from '../theme.js'

/** Punktradius in Pixeln. Einwohnerzahl per Wurzelskala auf die Flaeche abgebildet. */
export function dotRadius(population: number): number {
  return 3.2 + 17 * Math.sqrt(Math.min(population, 4_000_000) / 4_000_000)
}

const LABEL_THRESHOLD = 40_000
const LABEL_SEPARATION_PX = 95
/** Wie viele Relationen das Nachfrage-Overlay hoechstens zeigt. */
const DEMAND_TOP_N = 80

/**
 * Meter pro Bildschirmpixel im Web-Mercator. Das `+ 1` im Exponenten ist kein
 * Schreibfehler: MapLibre definiert seinen Zoom ueber 512-px-Kacheln.
 */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** (zoom + 1)
}

/**
 * Beschriftungen entzerren: absteigend nach Einwohnerzahl, ein Name wird nur
 * gesetzt, wenn er weit genug von allen bereits gesetzten entfernt ist.
 */
export function declutter(cities: readonly City[], zoom: number): City[] {
  const candidates = cities
    .filter((c) => c.population >= LABEL_THRESHOLD)
    .sort((a, b) => b.population - a.population)

  const accepted: City[] = []
  for (const city of candidates) {
    const minDistanceKm = (LABEL_SEPARATION_PX * metresPerPixel(zoom, city.centre[1])) / 1000
    if (accepted.every((a) => distanceKm(a.centre, city.centre) >= minDistanceKm)) accepted.push(city)
  }
  return accepted
}

interface DemandArc {
  readonly from: [number, number]
  readonly to: [number, number]
  readonly trips: number
}

/** Die staerksten Relationen, Hin- und Rueckrichtung zusammengefasst. */
export function topDemandArcs(state: GameState, demand: DemandMatrix): DemandArc[] {
  const merged = new Map<string, { from: CityId; to: CityId; trips: number }>()
  for (const pair of demand.pairs) {
    const key = [pair.from, pair.to].sort().join('|')
    const existing = merged.get(key)
    if (existing) existing.trips += pair.totalTrips
    else merged.set(key, { from: pair.from, to: pair.to, trips: pair.totalTrips })
  }

  return [...merged.values()]
    .sort((a, b) => b.trips - a.trips)
    .slice(0, DEMAND_TOP_N)
    .flatMap((m) => {
      const a = state.cities.get(m.from)
      const b = state.cities.get(m.to)
      if (!a || !b) return []
      return [{ from: [a.centre[0], a.centre[1]] as [number, number], to: [b.centre[0], b.centre[1]] as [number, number], trips: m.trips }]
    })
}

export interface LayerContext {
  readonly state: GameState
  readonly demand: DemandMatrix
  readonly cities: readonly City[]
  readonly zoom: number
  readonly selectedCityId: CityId | null
  readonly selectedLineId: LineId | null
  readonly draft: readonly StationId[]
  readonly showDemand: boolean
  readonly tone: Tone
  readonly onPickCity: (city: City | null) => void
  readonly onPickLine: (id: LineId) => void
}

export function buildLayers(ctx: LayerContext): Layer[] {
  const { state, cities, zoom, selectedCityId, selectedLineId, draft, showDemand } = ctx
  const c: MarkPalette = MARKS[ctx.tone]
  const labelled = declutter(cities, zoom)
  const characterSet = new Set<string>()
  for (const c of labelled) for (const ch of c.name) characterSet.add(ch)

  const stations = [...state.network.stations.values()]
  const stationCities = stations
    .map((s) => state.cities.get(s.cityId))
    .filter((c): c is City => Boolean(c))

  const linePaths = [...state.lines.values()].flatMap((line) => {
    const path = line.stops
      .map((stop) => state.network.stations.get(stop.stationId))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => [s.position[0], s.position[1]] as [number, number])
    return path.length >= 2 ? [{ id: line.id, name: line.name, path }] : []
  })

  const draftPath = draft
    .map((id) => state.network.stations.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => [s.position[0], s.position[1]] as [number, number])

  const layers: Layer[] = []

  if (showDemand) {
    const arcs = topDemandArcs(state, ctx.demand)
    const maxTrips = Math.max(1, ...arcs.map((a) => a.trips))
    layers.push(
      new LineLayer<DemandArc>({
        id: 'demand-arcs',
        data: arcs,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getColor: rgba(c.demand, 150),
        // Hoher Exponent: schwache Relationen sollen verschwinden, nicht das Bild fuellen.
        getWidth: (d) => 0.6 + 7 * (d.trips / maxTrips) ** 0.75,
        widthUnits: 'pixels',
        pickable: false,
      }),
    )
  }

  layers.push(
    // Einzugsgebiet in echten Metern.
    new ScatterplotLayer<City>({
      id: 'city-catchment',
      data: cities as City[],
      getPosition: (d) => [d.centre[0], d.centre[1]],
      getRadius: (d) => d.radiusKm * 1000,
      radiusUnits: 'meters',
      filled: true,
      stroked: false,
      getFillColor: rgba(c.city, ctx.tone === 'light' ? 26 : 16),
      pickable: false,
    }),
  )

  if (linePaths.length > 0) {
    // Umrandung zuerst, dann die farbige Linie darauf. Auf einer detaillierten
    // OSM-Karte hat keine einzelne Farbe garantierten Kontrast - der Untergrund
    // reicht von Weiss ueber Waldgruen bis Wasserblau. Die Umrandung loest das
    // unabhaengig davon, worueber die Linie gerade verlaeuft.
    layers.push(
      new PathLayer<(typeof linePaths)[number]>({
        id: 'bus-lines-casing',
        data: linePaths,
        getPath: (d) => d.path,
        getColor: rgba(c.casing, 190),
        getWidth: (d) => (d.id === selectedLineId ? 8.5 : 6.5),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
        updateTriggers: { getWidth: selectedLineId },
      }),
      new PathLayer<(typeof linePaths)[number]>({
        id: 'bus-lines',
        data: linePaths,
        getPath: (d) => d.path,
        getColor: (d) => (d.id === selectedLineId ? rgba(c.selected) : rgba(c.line)),
        getWidth: (d) => (d.id === selectedLineId ? 5 : 3.5),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onClick: ({ object }) => {
          if (object) ctx.onPickLine(object.id)
          return true
        },
        updateTriggers: { getColor: selectedLineId, getWidth: selectedLineId },
      }),
    )
  }

  if (draftPath.length >= 2) {
    layers.push(
      new PathLayer<{ path: [number, number][] }>({
        id: 'draft-line',
        data: [{ path: draftPath }],
        getPath: (d) => d.path,
        getColor: rgba(c.selected, 210),
        getWidth: 3,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
    )
  }

  layers.push(
    new ScatterplotLayer<City>({
      id: 'city-dot',
      data: cities as City[],
      getPosition: (d) => [d.centre[0], d.centre[1]],
      getRadius: (d) => dotRadius(d.population),
      radiusUnits: 'pixels',
      filled: true,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (d.id === selectedCityId ? 2.5 : 2),
      getFillColor: rgba(c.city),
      getLineColor: (d) => (d.id === selectedCityId ? rgba(c.selected) : rgba(c.casing, 220)),
      pickable: true,
      autoHighlight: true,
      highlightColor: ctx.tone === 'light' ? [0, 0, 0, 60] : [255, 255, 255, 70],
      onClick: ({ object }) => {
        ctx.onPickCity(object ?? null)
        return true
      },
      updateTriggers: { getLineColor: selectedCityId, getLineWidth: selectedCityId },
    }),
    // Haltestellenring: sitzt auf dem Stadtpunkt und macht sofort sichtbar,
    // welche Staedte bereits erschlossen sind.
    new ScatterplotLayer<City>({
      id: 'stop-ring',
      data: stationCities,
      getPosition: (d) => [d.centre[0], d.centre[1]],
      getRadius: (d) => dotRadius(d.population) + 4,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.6,
      getLineColor: rgba(c.line, 245),
      pickable: false,
    }),
    new TextLayer<City>({
      id: 'city-label',
      data: labelled,
      characterSet: [...characterSet],
      getPosition: (d) => [d.centre[0], d.centre[1]],
      getText: (d) => d.name,
      getSize: 11,
      sizeUnits: 'pixels',
      getColor: rgba(c.label),
      getPixelOffset: (d) => [0, -(dotRadius(d.population) + 13)],
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      outlineWidth: 3,
      outlineColor: rgba(c.labelHalo, 235),
      fontSettings: { sdf: true },
      pickable: false,
    }),
  )

  return layers
}
