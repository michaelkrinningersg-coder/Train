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
  type StationId,
} from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { advanceDay, applyCommand, createGame } from '@game/sim'
import { DEFAULT_BASEMAP } from '../map/mapStyle.js'
import { create } from 'zustand'

export type Tab = 'network' | 'fleet' | 'finance'
export type Speed = 0 | 1 | 2
export type MapMode = 'idle' | 'draw-line'

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

  start: (cities) => {
    // Die Potenziale haengen nur an den Staedten, die Matrix nur an den
    // Potenzialen - beides wird einmal beim Start gerechnet und danach nie wieder.
    const enriched = withPotentials(cities)
    set({
      state: createGame({ cities: enriched }),
      demand: buildDemandMatrix(enriched, { minTripsPerDay: 1 }),
      ready: true,
    })
  },

  dispatch: (command) => {
    const { state } = get()
    if (!state) return false

    const result = applyCommand(state, command)
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
