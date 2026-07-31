import { PathLayer, ScatterplotLayer, TextLayer, LineLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import { capacityFactor, type City, type CityId, type GameState, type LineId, type LngLat, type NodeId, type StationId, type TrackId } from '@game/domain'
import type { DemandMatrix } from '@game/demand'
import { distanceKm } from '@game/geo'
import { MARKS, loadColor, rgba, type MarkPalette, type Tone } from '../theme.js'

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

/**
 * Einmal gerechnete Bögen je Nachfragematrix.
 *
 * Die Kartenschichten werden bei jeder Zustandsänderung neu gebaut, also bei
 * jedem simulierten Tag. Über Bayerns 3 857 Relationen zu laufen war dabei
 * nicht zu bemerken; über Deutschlands 141 146 schon. Die Matrix ändert sich
 * während eines Spiels nie — sie wird beim Start gebaut und beim Laden ersetzt.
 * Genau dafür ist die Identität des Objekts der richtige Schlüssel.
 */
const arcCache = new WeakMap<DemandMatrix, DemandArc[]>()

/** Die staerksten Relationen, Hin- und Rueckrichtung zusammengefasst. */
export function topDemandArcs(state: GameState, demand: DemandMatrix): DemandArc[] {
  const cached = arcCache.get(demand)
  if (cached) return cached

  const arcs = computeDemandArcs(state, demand)
  arcCache.set(demand, arcs)
  return arcs
}

function computeDemandArcs(state: GameState, demand: DemandMatrix): DemandArc[] {
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

/** Ein Abschnitt zwischen zwei Halten, mit der Auslastung von gestern. */
export interface LoadLink {
  readonly lineId: LineId
  readonly lineName: string
  readonly from: string
  readonly to: string
  readonly load: number
  readonly path: [number, number][]
}

/**
 * Die Auslastung je Abschnitt, für die Karte.
 *
 * Sie steht schon in jedem Linienpanel — nur eben je Linie, und dort ist der
 * Engpass eine Zeile in einer Tabelle. Ein Engpass ist aber eine **Ortsfrage**:
 * welcher Korridor ist voll, und was liegt daneben. Genau die beantwortet eine
 * Tabelle nicht.
 *
 * Gezeichnet werden nur Abschnitte, auf denen gestern jemand saß. Ein Netz, in
 * dem jede Linie einen blassen Streifen bekommt, wäre voller Farbe ohne
 * Information.
 */
export function loadLinks(state: GameState): LoadLink[] {
  const out: LoadLink[] = []
  for (const result of state.lastDay?.lines ?? []) {
    const line = state.lines.get(result.lineId)
    if (!line || !result.linkLoadFactors) continue

    const stations = line.stops.map((stop) => state.network.stations.get(stop.stationId))
    for (let i = 0; i < result.linkLoadFactors.length; i++) {
      const load = result.linkLoadFactors[i] ?? 0
      const a = stations[i]
      const b = stations[i + 1]
      if (load <= 0 || !a || !b) continue
      out.push({
        lineId: line.id,
        lineName: line.name,
        from: a.name,
        to: b.name,
        load,
        path: [
          [a.position[0], a.position[1]],
          [b.position[0], b.position[1]],
        ],
      })
    }
  }
  // Die vollsten zuletzt, damit sie bei Ueberlagerung obenauf liegen.
  return out.sort((x, y) => x.load - y.load)
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
  /** Auslastungs-Heatmap ueber den eigenen Linien. */
  readonly showLoad: boolean
  readonly tone: Tone
  readonly selectedTrackId: TrackId | null
  /** Entwurf einer Strecke: Startknoten, Stuetzpunkte und Zeigerposition. */
  readonly trackDraft: { readonly from: NodeId | null; readonly waypoints: readonly LngLat[] } | null
  readonly hoverPoint: LngLat | null
  readonly onPickTrack: (id: TrackId) => void
  readonly onPickCity: (city: City | null) => void
  readonly onPickLine: (id: LineId) => void
}

/** Strichstärke eines Abschnitts. Über 100 Prozent wächst sie weiter. */
function loadWidth(load: number): number {
  return 3 + 7 * Math.min(1, load) + (load > 1 ? 4 * Math.min(1, load - 1) : 0)
}

export function buildLayers(ctx: LayerContext): Layer[] {
  const { state, cities, zoom, selectedCityId, selectedLineId, draft, showDemand } = ctx
  const c: MarkPalette = MARKS[ctx.tone]
  const labelled = declutter(cities, zoom)
  const characterSet = new Set<string>()
  for (const c of labelled) for (const ch of c.name) characterSet.add(ch)

  const stations = [...state.network.stations.values()]
  const stationCities = stations
    .filter((s) => s.mode !== 'rail')
    .map((s) => state.cities.get(s.cityId))
    .filter((x): x is City => Boolean(x))

  const railStations = stations
    .filter((s) => s.mode !== 'bus')
    .map((s) => ({ position: [s.position[0], s.position[1]] as [number, number], platforms: s.platforms }))

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

  const tracks = [...state.network.tracks.values()].map((t) => ({
    id: t.id,
    path: t.geometry.map((p) => [p[0], p[1]] as [number, number]),
    // Eine im Bau befindliche Strecke wird gestrichelt wirkend duenner und
    // blasser gezeichnet - Form und Deckkraft, nicht Farbe, damit die
    // Unterscheidung auch ohne Farbsehen funktioniert.
    building: capacityFactor(t, state.day) < 1,
    tracks: t.tracks,
  }))

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

  if (tracks.length > 0) {
    layers.push(
      new PathLayer<(typeof tracks)[number]>({
        id: 'rail-casing',
        data: tracks,
        getPath: (d) => d.path,
        getColor: rgba(c.casing, 200),
        getWidth: (d) => (d.id === ctx.selectedTrackId ? 10 : 6 + d.tracks),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
        updateTriggers: { getWidth: ctx.selectedTrackId },
      }),
      new PathLayer<(typeof tracks)[number]>({
        id: 'rail-tracks',
        data: tracks,
        getPath: (d) => d.path,
        getColor: (d) =>
          d.id === ctx.selectedTrackId ? rgba(c.selected) : rgba(c.track, d.building ? 110 : 255),
        // Die Gleiszahl steckt in der Strichstaerke - mehr Gleise, breitere Trasse.
        getWidth: (d) => (d.id === ctx.selectedTrackId ? 6 : 2.5 + d.tracks * 0.9),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onClick: ({ object }) => {
          if (object) ctx.onPickTrack(object.id)
          return true
        },
        updateTriggers: { getColor: ctx.selectedTrackId, getWidth: ctx.selectedTrackId },
      }),
    )
  }

  // Streckenentwurf mit Gummiband zur Zeigerposition.
  if (ctx.trackDraft?.from) {
    const start = state.network.nodes.get(ctx.trackDraft.from)
    if (start) {
      const path: [number, number][] = [
        [start.position[0], start.position[1]],
        ...ctx.trackDraft.waypoints.map((p) => [p[0], p[1]] as [number, number]),
        ...(ctx.hoverPoint ? [[ctx.hoverPoint[0], ctx.hoverPoint[1]] as [number, number]] : []),
      ]
      if (path.length >= 2) {
        layers.push(
          new PathLayer<{ path: [number, number][] }>({
            id: 'track-draft',
            data: [{ path }],
            getPath: (d) => d.path,
            getColor: rgba(c.selected, 220),
            getWidth: 3,
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            pickable: false,
          }),
        )
      }
      layers.push(
        new ScatterplotLayer<LngLat>({
          id: 'track-draft-points',
          data: [start.position, ...ctx.trackDraft.waypoints] as LngLat[],
          getPosition: (d) => [d[0], d[1]],
          getRadius: 4,
          radiusUnits: 'pixels',
          filled: true,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1.5,
          getFillColor: rgba(c.selected),
          getLineColor: rgba(c.casing),
          pickable: false,
        }),
      )
    }
  }

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

  // Ueber den Linien, damit der Engpass nicht unter seiner eigenen Linie
  // verschwindet, aber unter Staedten und Beschriftung.
  if (ctx.showLoad) {
    const links = loadLinks(state)
    if (links.length > 0) {
      layers.push(
        new PathLayer<LoadLink>({
          id: 'load-casing',
          data: links,
          getPath: (d) => d.path,
          getColor: rgba(c.casing, 190),
          getWidth: (d) => loadWidth(d.load) + 3,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
        new PathLayer<LoadLink>({
          id: 'load-links',
          data: links,
          getPath: (d) => d.path,
          getColor: (d) => loadColor(c.load, d.load),
          // Die Strichstaerke sagt dasselbe wie die Farbe noch einmal - wer
          // Farben nicht unterscheidet, sieht den Engpass trotzdem.
          getWidth: (d) => loadWidth(d.load),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onClick: ({ object }) => {
            if (object) ctx.onPickLine(object.lineId)
            return true
          },
        }),
      )
    }
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
    // Bahnhoefe liegen frei in der Stadt - eigener Punkt, nicht der Stadtpunkt.
    new ScatterplotLayer<(typeof railStations)[number]>({
      id: 'rail-stations',
      data: railStations,
      getPosition: (d) => d.position,
      getRadius: (d) => 3.5 + d.platforms * 0.7,
      radiusUnits: 'pixels',
      filled: true,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getFillColor: rgba(c.track),
      getLineColor: rgba(c.casing),
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
