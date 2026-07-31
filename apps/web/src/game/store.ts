import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_RAIL_FARE,
  DEFAULT_CONNECTION_HOLD_SEC,
  DEFAULT_RUNTIME_RESERVE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
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
  campaignStep,
  scenarioById,
} from '@game/domain'
import type { ElevationGrid } from '@game/geo'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { applyCommand, applyScenarioSetup, createGame, makeSave, readSave, STARTING_CASH } from '@game/sim'
import { createSimClient } from './simClient.js'
import { AUTOSAVE_SLOT, writeSlot } from './storage.js'
import { DEFAULT_BASEMAP } from '../map/mapStyle.js'
import { create } from 'zustand'

export type Tab = 'mission' | 'rail' | 'network' | 'fleet' | 'finance'
export type Speed = 0 | 1 | 2
export type MapMode = 'idle' | 'draw-line' | 'place-station' | 'draw-track' | 'place-loop'


/** Standardvorgabe einer neuen Strecke: einfach, unelektrifiziert, 120 km/h. */
export const DEFAULT_TRACK_SPEC: TrackSpec = {
  maxSpeed: 120,
  electrified: false,
  tracks: 1,
  signalling: 'classic',
}

/** Spieltage zwischen zwei automatischen Speicherungen. */
export const AUTOSAVE_EVERY_DAYS = 30

/** Millisekunden je Spieltag je Geschwindigkeitsstufe. */
export const SPEED_INTERVAL_MS: Record<Speed, number> = { 0: 0, 1: 900, 2: 180 }

/**
 * Der Rechenthread und das bisschen Buchhaltung drumherum.
 *
 * Absichtlich **neben** dem Store und nicht darin: das sind keine Daten, die
 * eine Oberflaeche anzeigen wuerde, und jede Aenderung daran wuerde sonst ein
 * Neuzeichnen ausloesen.
 *
 * `pending` ist der Kern der Sache. Waehrend ein Tag gerechnet wird, kann der
 * Spieler weiterbauen — er soll die Wirkung seines Klicks sofort sehen und
 * nicht neunzig Millisekunden warten. Der Zustand, den der Rechenthread
 * zurueckgibt, kennt diese Befehle aber nicht: er ist aus dem Zustand *vor*
 * dem Klick entstanden. Deshalb werden sie mitgeschrieben und auf das Ergebnis
 * noch einmal angewandt. Ein Befehl ist eine reine Funktion; ihn einen Tag
 * spaeter zu wiederholen ergibt genau denselben Bau, nur mit dem Bauende einen
 * Tag spaeter.
 *
 * `generation` verwirft Antworten, die zu einem abgebrochenen oder geladenen
 * Spiel gehoeren.
 */
const sim = createSimClient()
let inFlight = false
let pending: Command[] = []
let generation = 0

/**
 * Neues Spiel an den Rechenthread uebergeben.
 *
 * Der Zaehler entwertet alles, was vom vorigen Spiel noch unterwegs ist. Ohne
 * ihn koennte die Antwort auf einen Tag, der vor dem Laden abgeschickt wurde,
 * den geladenen Spielstand ueberschreiben - und zwar genau einmal, kurz nach
 * dem Laden, was niemand reproduzieren wuerde.
 */
function handOver(cities: readonly City[]): void {
  generation++
  inFlight = false
  pending = []
  void sim.init(cities)
}

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
  /** Auslastungs-Heatmap ueber den eigenen Linien. */
  readonly showLoad: boolean
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
  /** Wird gerade eine Bus- oder eine Bahnlinie entworfen? */
  readonly draftMode: 'bus' | 'rail'
  /** Bildfahrplan der gewaehlten Bahnlinie einblenden. */
  readonly showTimetable: boolean
  /** Spielstandsverwaltung offen. */
  readonly showSaves: boolean

  /** Startet einen Auftrag. Ohne Kennung den Standardauftrag. */
  start: (cities: readonly City[], scenarioId?: string) => void
  /** Zurueck zur Auftragsauswahl. */
  restart: () => void
  /** Naechster Auftrag im Feldzug - das Netz bleibt stehen. */
  nextScenario: () => void
  /** Ergebnis der Auftragsauswertung wurde zur Kenntnis genommen. */
  dismissOutcome: () => void
  readonly outcomeSeen: boolean
  dispatch: (command: Command) => boolean
  step: (days?: number) => void

  /** Spielstand aus einer Datei oder aus IndexedDB uebernehmen. */
  load: (raw: unknown) => boolean
  /** Tag, an dem zuletzt selbst gespeichert wurde - Grundlage des Autosaves. */
  readonly lastAutosaveDay: number

  setSpeed: (speed: Speed) => void
  setTab: (tab: Tab) => void
  selectCity: (id: CityId | null) => void
  selectLine: (id: LineId | null) => void
  toggleDemand: () => void
  toggleLoad: () => void
  /**
   * Kartenausschnitt auf eine Stadt schwenken.
   *
   * Der Store haelt nur den Wunsch, nicht die Karte: `MapView` sieht ihn und
   * fuehrt ihn aus. Anders herum muesste jede Stelle, die springen will, eine
   * Kartenreferenz kennen - und das waeren am Ende alle.
   */
  focusCity: (id: CityId) => void
  readonly focus: { readonly centre: LngLat; readonly zoom: number; readonly nonce: number } | null
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

  beginLine: (mode: 'bus' | 'rail') => void
  beginLoop: (trackId: TrackId) => void
  placeLoop: (position: LngLat) => void
  toggleTimetable: () => void
  setShowSaves: (open: boolean) => void
  toggleDraftStop: (id: StationId) => void
  cancelLine: () => void
  commitLine: (name: string) => void
}

export const useGame = create<GameStore>((set, get) => ({
  ready: false,
  state: null,
  demand: null,
  speed: 0,
  // Wer einen Auftrag gewaehlt hat, will zuerst lesen, was er bedeutet.
  tab: 'mission',
  mapMode: 'idle',
  draft: [],
  selectedCityId: null,
  selectedLineId: null,
  showDemand: false,
  showLoad: false,
  focus: null,
  basemap: DEFAULT_BASEMAP,
  message: null,

  elevation: null,
  hoverPoint: null,
  stationDraft: null,
  trackDraft: null,
  selectedTrackId: null,
  draftMode: 'bus',
  showTimetable: false,
  showSaves: false,
  lastAutosaveDay: 0,
  outcomeSeen: false,

  start: (cities, scenarioId) => {
    // Entwicklungshilfe: mit VITE_STARTING_CASH laesst sich der Bahnbau testen,
    // ohne erst Jahre Busbetrieb durchzuspielen. Im Spiel selbst gilt der
    // Standardwert aus @game/sim.
    const cashOverride = Number(import.meta.env['VITE_STARTING_CASH'] ?? '')
    // Die Potenziale haengen nur an den Staedten, die Matrix nur an den
    // Potenzialen - beides wird einmal beim Start gerechnet und danach nie wieder.
    const enriched = withPotentials(cities)
    set({
      state: applyScenarioSetup(
        createGame({
          cities: enriched,
          ...(scenarioId ? { scenarioId } : {}),
        // Der Auftrag bestimmt das Startkapital; die Umgebungsvariable sticht
        // ihn nur in der Entwicklung.
        startingCash:
          Number.isFinite(cashOverride) && cashOverride > 0
            ? cashOverride
            : (scenarioById(scenarioId ?? '')?.startingCash ?? STARTING_CASH),
        }),
        scenarioById(scenarioId ?? ''),
      ),
      demand: buildDemandMatrix(enriched, { minTripsPerDay: 1 }),
      ready: true,
      outcomeSeen: false,
      lastAutosaveDay: 0,
      tab: 'mission',
    })
    handOver(enriched)
  },

  restart: () => {
    generation++
    inFlight = false
    pending = []
    set({ ready: false, state: null, demand: null, speed: 0, outcomeSeen: false })
  },

  dismissOutcome: () => set({ outcomeSeen: true }),

  nextScenario: () => {
    const state = get().state
    if (!state) return
    const step = campaignStep(state.scenarioId)
    const nextId = step?.campaign.steps[step.index + 1]
    if (!nextId) return
    const ok = get().dispatch({
      kind: 'begin_scenario',
      scenarioId: nextId,
      grant: scenarioById(nextId)?.grant ?? 0,
    })
    if (ok) set({ outcomeSeen: false, tab: 'mission', speed: 0 })
  },

  load: (raw) => {
    try {
      const state = readSave(raw)
      // Die Nachfragematrix haengt nur an den Staedten und wird deshalb aus dem
      // geladenen Zustand neu gebaut, nicht mitgespeichert.
      set({
        state,
        demand: buildDemandMatrix([...state.cities.values()], { minTripsPerDay: 1 }),
        ready: true,
        speed: 0,
        selectedCityId: null,
        selectedLineId: null,
        selectedTrackId: null,
        mapMode: 'idle',
        draft: [],
        stationDraft: null,
        trackDraft: null,
        showTimetable: false,
        lastAutosaveDay: state.day,
        outcomeSeen: false,
        message: null,
      })
      handOver([...state.cities.values()])
      return true
    } catch (error) {
      set({ message: (error as Error).message })
      return false
    }
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
    // Der laufende Betriebstag kennt diesen Befehl nicht - er wird auf sein
    // Ergebnis noch einmal angewandt. Siehe `pending` oben.
    if (inFlight) pending.push(command)
    return true
  },

  step: (days = 1) => {
    const { state } = get()
    if (!state) return
    // Laeuft noch ein Tag, wird dieser Takt uebersprungen. Auflaufen zu lassen
    // waere schlimmer: die Uhr liefe der Rechnung davon und das Spiel wuerde
    // nach dem Pausieren noch minutenlang weiterrechnen.
    if (inFlight) return

    inFlight = true
    pending = []
    const mine = generation

    void sim
      .advance(state, days)
      .then((computed) => {
        if (mine !== generation) return
        // Was der Spieler waehrend der Rechnung gebaut hat, kennt dieser
        // Zustand noch nicht - also noch einmal darauf anwenden.
        let next = computed
        for (const command of pending) {
          const result = applyCommand(next, command, { elevation: get().elevation ?? undefined })
          if (result.ok) next = result.state
        }
        set({ state: next })

        // Autosave alle AUTOSAVE_EVERY_DAYS Spieltage. Bewusst ohne `await`:
        // ein langsamer Schreibvorgang darf die Spieluhr nicht anhalten, und
        // schlaegt er fehl, ist der naechste in dreissig Tagen.
        if (next.day - get().lastAutosaveDay >= AUTOSAVE_EVERY_DAYS) {
          set({ lastAutosaveDay: next.day })
          void writeSlot(AUTOSAVE_SLOT, makeSave(next, 'Automatisch', new Date().toISOString())).catch(() => {
            set({ message: 'Automatisches Speichern fehlgeschlagen — Spielstand notfalls exportieren.' })
          })
        }
      })
      .catch((error: unknown) => {
        if (mine === generation) set({ message: `Die Simulation ist gescheitert: ${String(error)}`, speed: 0 })
      })
      .finally(() => {
        if (mine === generation) inFlight = false
        pending = []
      })
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
  draftMode: 'bus',
  showTimetable: false,
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
  selectLine: (selectedLineId) =>
    set((s) => {
      // Der Reiter richtet sich nach der Linienart. Beim Abwaehlen bleibt er
      // stehen - sonst spraenge man beim Zurueckgehen aus der Schiene heraus.
      if (!selectedLineId) return { selectedLineId }
      const mode = s.state?.lines.get(selectedLineId)?.mode
      return { selectedLineId, tab: mode === 'rail' ? 'rail' : 'network', showTimetable: false }
    }),
  toggleDemand: () => set((s) => ({ showDemand: !s.showDemand })),
  toggleLoad: () => set((s) => ({ showLoad: !s.showLoad })),

  focusCity: (id) => {
    const city = get().state?.cities.get(id)
    if (!city) return
    // Der Zaehler macht aus zwei gleichen Zielen zwei Ereignisse - sonst
    // passierte beim zweiten Klick auf dieselbe Stadt nichts.
    set((s) => ({
      focus: { centre: city.centre, zoom: 9.5, nonce: (s.focus?.nonce ?? 0) + 1 },
      selectedCityId: id,
    }))
  },
  setBasemap: (basemap) => set({ basemap }),
  notify: (message) => set({ message }),

  beginLine: (draftMode) =>
    set({
      mapMode: 'draw-line',
      draft: [],
      draftMode,
      selectedLineId: null,
      trackDraft: null,
      stationDraft: null,
      tab: draftMode === 'rail' ? 'rail' : 'network',
    }),

  beginLoop: (trackId) => set({ mapMode: 'place-loop', selectedTrackId: trackId, tab: 'rail' }),

  placeLoop: (position) => {
    const { selectedTrackId, dispatch } = get()
    if (!selectedTrackId) return
    const ok = dispatch({ kind: 'place_passing_loop', trackId: selectedTrackId, position, capacity: 2 })
    if (ok) set({ mapMode: 'idle', hoverPoint: null, selectedTrackId: null })
  },

  toggleTimetable: () => set((s) => ({ showTimetable: !s.showTimetable })),

  setShowSaves: (showSaves) => set({ showSaves }),

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

    const rail = get().draftMode === 'rail'
    const created = dispatch({
      kind: 'create_line',
      line: {
        name,
        mode: rail ? 'rail' : 'bus',
        stops: draft.map((stationId) => ({ stationId, dwellSeconds: rail ? 60 : 120, serves: true })),
        path: rail ? { kind: 'rail', tracks: [] } : { kind: 'road' },
        fare: rail ? DEFAULT_RAIL_FARE : DEFAULT_BUS_FARE,
        runtimeReserve: rail ? DEFAULT_RUNTIME_RESERVE_RAIL : DEFAULT_RUNTIME_RESERVE,
        connectionHoldSec: DEFAULT_CONNECTION_HOLD_SEC,
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

    set({ mapMode: 'idle', draft: [], selectedLineId: line.id, tab: rail ? 'rail' : 'network' })
  },
}))

/** Bequemer Zugriff auf den Fahrplan einer Linie. */
export function patternOf(state: GameState, lineId: LineId) {
  return [...state.patterns.values()].find((p) => p.lineId === lineId)
}

export function setFare(lineId: LineId, fare: FarePolicy): void {
  useGame.getState().dispatch({ kind: 'set_fare', lineId, fare })
}
