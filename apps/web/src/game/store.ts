import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_RUNTIME_RESERVE,
  DEFAULT_SERVICE_WINDOW,
  type City,
  type CityId,
  type Command,
  type FarePolicy,
  type GameState,
  type LineId,
  type TrackSpec,
  type LngLat,
  type NodeId,
  type StationId,
  type TrackId,
} from '@game/domain'
import type { ElevationGrid } from '@game/geo'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { advanceDay, applyCommand, createGame } from '@game/sim'
import { DEFAULT_BASEMAP } from '../map/mapStyle.js'
import { create } from 'zustand'

export type Tab = 'rail' | 'network' | 'fleet' | 'finance'
export type Speed = 0 | 1 | 2
export type MapMode = 'idle' | 'draw-line' | 'place-station' | 'draw-track'


/** Standardvorgabe einer neuen Strecke: einfach, unelektrifiziert, 120 km/h. */
export const DEFAULT_TRACK_SPEC: TrackSpec = {
  maxSpeed: 120,
  electrified: false,
  tracks: 1,
  signalling: 'classic',
}

/** Millisekunden je Spieltag je Geschwindigkeitsstufe. */
export const SPEED_INTERVAL_MS: Record<Speed, number> = { 0: 0, 1: 900, 2: 180 }

interface GameStore {
  readonly ready: boolean
  readonly state: GameState | null
  readonly demand: DemandMatrix | null

  readonly speed: Speed
  readonly tab: Tab
  readonly mapMode: MapMode
  readonly draft: readonly StationId[]
  readonly selectedCityId: CityId | null
  readonly selectedLineId: LineId | null
  readonly showDemand: boolean
  readonly basemap: string
  readonly message: string | null

  readonly elevation: ElevationGrid | null
  /** Zeigerposition auf der Karte - nur in den Bauwerkzeugen gepflegt. */
  readonly hoverPoint: LngLat | null
  readonly stationDraft: { readonly cityId: CityId; readonly platforms: number } | null
  readonly trackDraft: {
    readonly from: NodeId | null
    readonly waypoints: readonly LngLat[]
    readonly spec: TrackSpec
  } | null
  readonly selectedTrackId: TrackId | null

  start: (cities: readonly City[]) => void
  dispatch: (command: Command) => boolean
  step: (days?: number) => void

  setSpeed: (speed: Speed) => void
  setTab: (tab: Tab) => void
  selectCity: (id: CityId | null) => void
  selectLine: (id: LineId | null) => void
  toggleDemand: () => void
  setBasemap: (id: string) => void
  notify: (message: string | null) => void

  setElevation: (grid: ElevationGrid) => void
  setHoverPoint: (point: LngLat | null) => void

  beginStation: (cityId: CityId) => void
  setStationPlatforms: (platforms: number) => void
  placeStation: (position: LngLat) => void

  beginTrack: () => void
  setTrackSpec: (spec: Partial<TrackSpec>) => void
  trackClickNode: (nodeId: NodeId) => void
  trackAddWaypoint: (point: LngLat) => void
  trackUndoWaypoint: () => void
  cancelBuild: () => void
  selectTrack: (id: TrackId | null) => void

  beginLine: () => void
  toggleDraftStop: (id: StationId) => void
  cancelLine: () => void
  commitLine: (name: string) => void
}

export const useGame = create<GameStore>((set, get) => ({
  ready: false,
  state: null,
  demand: null,
  speed: 0,
  tab: 'network',
  mapMode: 'idle',
  draft: [],
  selectedCityId: null,
  selectedLineId: null,
  showDemand: false,
  basemap: DEFAULT_BASEMAP,
  message: null,

  elevation: null,
  hoverPoint: null,
  stationDraft: null,
  trackDraft: null,
  selectedTrackId: null,

  start: (cities) => {
    // Entwicklungshilfe: mit VITE_STARTING_CASH laesst sich der Bahnbau testen,
    // ohne erst Jahre Busbetrieb durchzuspielen. Im Spiel selbst gilt der
    // Standardwert aus @game/sim.
    const cashOverride = Number(import.meta.env['VITE_STARTING_CASH'] ?? '')
    // Die Potenziale haengen nur an den Staedten, die Matrix nur an den
    // Potenzialen - beides wird einmal beim Start gerechnet und danach nie wieder.
    const enriched = withPotentials(cities)
    set({
      state: createGame({
        cities: enriched,
        ...(Number.isFinite(cashOverride) && cashOverride > 0 ? { startingCash: cashOverride } : {}),
      }),
      demand: buildDemandMatrix(enriched, { minTripsPerDay: 1 }),
      ready: true,
    })
  },

  dispatch: (command) => {
    const { state } = get()
    if (!state) return false

    const result = applyCommand(state, command, { elevation: get().elevation ?? undefined })
    if (!result.ok) {
      set({ message: result.reason })
      return false
    }
    set({ state: result.state, message: null })
    return true
  },

  step: (days = 1) => {
    const { state, demand } = get()
    if (!state || !demand) return
    let next = state
    for (let i = 0; i < days; i++) next = advanceDay(next, demand)
    set({ state: next })
  },

  setElevation: (elevation) => set({ elevation }),
  setHoverPoint: (hoverPoint) => set({ hoverPoint }),

  beginStation: (cityId) =>
    set({ mapMode: 'place-station', stationDraft: { cityId, platforms: 2 }, trackDraft: null }),

  setStationPlatforms: (platforms) =>
    set((s) => (s.stationDraft ? { stationDraft: { ...s.stationDraft, platforms } } : {})),

  placeStation: (position) => {
    const { stationDraft, dispatch } = get()
    if (!stationDraft) return
    const ok = dispatch({
      kind: 'place_station',
      cityId: stationDraft.cityId,
      position,
      platforms: stationDraft.platforms,
    })
    if (ok) set({ mapMode: 'idle', stationDraft: null, hoverPoint: null })
  },

  beginTrack: () =>
    set({
      mapMode: 'draw-track',
      trackDraft: { from: null, waypoints: [], spec: DEFAULT_TRACK_SPEC },
      stationDraft: null,
      selectedTrackId: null,
      tab: 'rail',
    }),

  setTrackSpec: (spec) =>
    set((s) => (s.trackDraft ? { trackDraft: { ...s.trackDraft, spec: { ...s.trackDraft.spec, ...spec } } } : {})),

  trackClickNode: (nodeId) => {
    const { trackDraft, dispatch } = get()
    if (!trackDraft) return

    // Erster Knoten ist der Start, der zweite schliesst die Strecke ab.
    if (!trackDraft.from) {
      set({ trackDraft: { ...trackDraft, from: nodeId } })
      return
    }
    if (trackDraft.from === nodeId) {
      set({ message: 'Start und Ziel dürfen nicht derselbe Knoten sein.' })
      return
    }

    const state = get().state
    const from = state?.network.nodes.get(trackDraft.from)
    const to = state?.network.nodes.get(nodeId)
    if (!from || !to) return

    const ok = dispatch({
      kind: 'build_track',
      from: trackDraft.from,
      to: nodeId,
      geometry: [from.position, ...trackDraft.waypoints, to.position],
      spec: trackDraft.spec,
    })
    if (ok) set({ mapMode: 'idle', trackDraft: null, hoverPoint: null })
  },

  trackAddWaypoint: (point) =>
    set((s) =>
      s.trackDraft?.from ? { trackDraft: { ...s.trackDraft, waypoints: [...s.trackDraft.waypoints, point] } } : {},
    ),

  trackUndoWaypoint: () =>
    set((s) => (s.trackDraft ? { trackDraft: { ...s.trackDraft, waypoints: s.trackDraft.waypoints.slice(0, -1) } } : {})),

  cancelBuild: () => set({ mapMode: 'idle', stationDraft: null, trackDraft: null, hoverPoint: null }),

  selectTrack: (selectedTrackId) => set({ selectedTrackId, tab: 'rail' }),

  setSpeed: (speed) => set({ speed }),
  setTab: (tab) => set({ tab }),
  selectCity: (selectedCityId) => set({ selectedCityId }),
  selectLine: (selectedLineId) => set({ selectedLineId, tab: 'network' }),
  toggleDemand: () => set((s) => ({ showDemand: !s.showDemand })),
  setBasemap: (basemap) => set({ basemap }),
  notify: (message) => set({ message }),

  beginLine: () => set({ mapMode: 'draw-line', draft: [], selectedLineId: null, tab: 'network' }),

  toggleDraftStop: (id) =>
    set((s) => ({
      draft: s.draft.includes(id) ? s.draft.filter((d) => d !== id) : [...s.draft, id],
    })),

  cancelLine: () => set({ mapMode: 'idle', draft: [] }),

  commitLine: (name) => {
    const { draft, dispatch, state } = get()
    if (draft.length < 2 || !state) {
      set({ message: 'Eine Linie braucht mindestens zwei Haltestellen.' })
      return
    }

    const created = dispatch({
      kind: 'create_line',
      line: {
        name,
        mode: 'bus',
        stops: draft.map((stationId) => ({ stationId, dwellSeconds: 120, serves: true })),
        path: { kind: 'road' },
        fare: DEFAULT_BUS_FARE,
        runtimeReserve: DEFAULT_RUNTIME_RESERVE,
      },
    })
    if (!created) return

    // Die neue Linie ist die zuletzt eingefuegte.
    const after = get().state
    const line = after ? [...after.lines.values()].at(-1) : undefined
    if (!line) return

    get().dispatch({
      kind: 'set_pattern',
      pattern: {
        lineId: line.id,
        direction: 'forward',
        vehicleIds: [],
        days: DAYS_ALL,
        headway: { everyMinutes: 60, ...DEFAULT_SERVICE_WINDOW },
      },
    })

    set({ mapMode: 'idle', draft: [], selectedLineId: line.id })
  },
}))

/** Bequemer Zugriff auf den Fahrplan einer Linie. */
export function patternOf(state: GameState, lineId: LineId) {
  return [...state.patterns.values()].find((p) => p.lineId === lineId)
}

export function setFare(lineId: LineId, fare: FarePolicy): void {
  useGame.getState().dispatch({ kind: 'set_fare', lineId, fare })
}
