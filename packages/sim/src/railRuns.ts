import {
  RAIL_DWELL_SEC,
  RAIL_TURNAROUND_SEC,
  SIGNAL_REACTION_SEC,
  expandDepartures,
  runId as brandRun,
  trainClass,
  type GameState,
  type Line,
  type LineId,
  type NodeId,
  type RunId,
  type Sec,
  type ServicePattern,
  type StationId,
  type TrainClass,
  type VehicleId,
} from '@game/domain'
import { blockBoundaries, sectionResource, blockResource, type Claim } from './blocks.js'
import { resolveLinePath } from './railGraph.js'
import { legRunTime, timeAtKm, type LegRun } from './runTime.js'

export interface RailStopTime {
  readonly stationId: StationId
  readonly nodeId: NodeId
  /** Weg vom Linienanfang in km. */
  readonly km: number
  readonly arrival: Sec
  readonly departure: Sec
}

export interface GraphPoint {
  readonly seconds: Sec
  readonly km: number
}

export interface RailRun {
  readonly id: RunId
  readonly patternId: string
  readonly lineId: LineId
  readonly vehicleId: VehicleId | null
  readonly direction: 'forward' | 'backward'
  readonly stops: readonly RailStopTime[]
  readonly claims: readonly Claim[]
  /** Stützpunkte für den Bildfahrplan. */
  readonly graph: readonly GraphPoint[]
  readonly departure: Sec
  readonly arrival: Sec
  readonly lengthKm: number
}

export interface LinePlan {
  readonly line: Line
  readonly train: TrainClass | null
  readonly stopNodes: readonly NodeId[]
  readonly legs: readonly LegRun[]
  readonly lengthKm: number
  /** Reine Fahrzeit inklusive Reserve und Aufenthalten, eine Richtung. */
  readonly oneWaySeconds: number
  readonly roundTripSeconds: number
  readonly problems: readonly string[]
}

/** Abstand zwischen zwei Punkten des Bildfahrplans. */
const GRAPH_STEP_KM = 1

/**
 * Fahrzeitrechnung einer Bahnlinie in einer Richtung.
 *
 * Die Wegewahl hängt vom Zug ab: ein Elektrozug kann eine nicht
 * elektrifizierte Ausweichroute nicht nutzen, eine Neigetechnik ist auf einer
 * kurvigen Strecke schneller. Deshalb wird der Weg mit dem konkreten Fahrzeug
 * gesucht und nicht abstrakt.
 */
export function planLine(state: GameState, line: Line, direction: 'forward' | 'backward' = 'forward'): LinePlan {
  const problems: string[] = []

  const pattern = [...state.patterns.values()].find((p) => p.lineId === line.id)
  const vehicle = pattern?.vehicleIds[0] ? state.fleet.get(pattern.vehicleIds[0]) : undefined
  const train = vehicle ? (trainClass(vehicle.classId) ?? null) : null
  if (!train) problems.push('Der Linie ist kein Zug zugeteilt.')

  const ordered = direction === 'forward' ? line.stops : [...line.stops].reverse()
  const stations = ordered.map((s) => state.network.stations.get(s.stationId))
  if (stations.some((s) => !s)) problems.push('Ein Halt fehlt im Netz.')

  const stopNodes = stations.filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => s.nodeId)
  if (stopNodes.length < 2) {
    return { line, train, stopNodes, legs: [], lengthKm: 0, oneWaySeconds: 0, roundTripSeconds: 0, problems }
  }

  const { legs: paths, complete, blockedByConstruction } = resolveLinePath(state, stopNodes, train ?? undefined)
  if (!complete) {
    problems.push(
      !train
        ? 'Ohne zugeteilten Zug lässt sich kein Weg prüfen.'
        : blockedByConstruction
          ? 'Die Strecke ist noch im Bau — sobald sie fertig ist, fährt die Linie.'
          : 'Es gibt keine durchgehend befahrbare Strecke zwischen allen Halten — fehlt eine Verbindung oder der Fahrdraht?',
    )
  }

  const legs = train ? paths.map((p) => legRunTime(state, p.tracks, train)) : []
  const lengthKm = legs.reduce((s, l) => s + l.lengthKm, 0)
  const reserve = line.runtimeReserve

  const driving = legs.reduce((s, l) => s + l.runSeconds * reserve, 0)
  const dwell = Math.max(0, stopNodes.length - 2) * RAIL_DWELL_SEC
  const oneWaySeconds = driving + dwell

  return {
    line,
    train,
    stopNodes,
    legs,
    lengthKm,
    oneWaySeconds,
    roundTripSeconds: 2 * oneWaySeconds + 2 * RAIL_TURNAROUND_SEC,
    problems,
  }
}

/** Wie viele Fahrzeuge der gewünschte Takt braucht. */
export function trainsNeeded(headwayMin: number, roundTripSeconds: number): number {
  if (headwayMin <= 0) return 0
  return Math.max(1, Math.ceil(roundTripSeconds / 60 / headwayMin))
}

export function effectiveRailHeadway(desiredMin: number, roundTripSeconds: number, trains: number): number {
  if (trains <= 0) return Number.POSITIVE_INFINITY
  return Math.max(desiredMin, roundTripSeconds / 60 / trains)
}

/**
 * Erzeugt alle Zugläufe eines Betriebstags samt Belegungen.
 *
 * Die Belegungen sind der eigentliche Ertrag: aus ihnen ergibt sich, ob der
 * Fahrplan überhaupt fahrbar ist.
 */
export function buildRuns(
  state: GameState,
  line: Line,
  pattern: ServicePattern,
  headwayMin: number,
): RailRun[] {
  const runs: RailRun[] = []
  const vehicles = pattern.vehicleIds
  if (vehicles.length === 0) return runs

  const departures = expandDeparturesWith(pattern, headwayMin)
  if (departures.length === 0) return runs

  const plans = {
    forward: planLine(state, line, 'forward'),
    backward: planLine(state, line, 'backward'),
  }
  if (plans.forward.legs.length === 0 || !plans.forward.train) return runs

  let vehicleCursor = 0
  let sequence = 0

  for (const departure of departures) {
    for (const direction of ['forward', 'backward'] as const) {
      const plan = plans[direction]
      if (plan.legs.length === 0) continue

      const vehicleId = vehicles[vehicleCursor % vehicles.length]!
      vehicleCursor++

      const run = buildRun(state, line, pattern, plan, direction, departure, vehicleId, sequence++)
      if (run) runs.push(run)
    }
  }

  return runs
}

function expandDeparturesWith(pattern: ServicePattern, headwayMin: number): Sec[] {
  if (pattern.departures) return [...pattern.departures]
  const h = pattern.headway
  if (!h || !Number.isFinite(headwayMin) || headwayMin <= 0) return expandDepartures(pattern) as Sec[]
  const step = headwayMin * 60
  const out: Sec[] = []
  for (let t = h.firstDeparture; t <= h.lastDeparture; t += step) out.push(t)
  return out
}

function buildRun(
  state: GameState,
  line: Line,
  pattern: ServicePattern,
  plan: LinePlan,
  direction: 'forward' | 'backward',
  departure: Sec,
  vehicleId: VehicleId,
  sequence: number,
): RailRun | null {
  const train = plan.train
  if (!train) return null

  const reserve = line.runtimeReserve
  const claims: Claim[] = []
  const graph: GraphPoint[] = []
  const stops: RailStopTime[] = []

  let clock = departure
  let kmCursor = 0

  const stationAt = (nodeId: NodeId): { id: StationId; platforms: number; name: string } | null => {
    const station = [...state.network.stations.values()].find((s) => s.nodeId === nodeId)
    return station ? { id: station.id, platforms: station.platforms, name: station.name } : null
  }

  const first = stationAt(plan.stopNodes[0]!)
  if (first) {
    stops.push({ stationId: first.id, nodeId: plan.stopNodes[0]!, km: 0, arrival: departure, departure })
    claims.push({
      resource: `platform:${first.id}`,
      kind: 'platform',
      capacity: first.platforms,
      from: departure - 120,
      to: departure + 30,
      runId: brandRun(`${pattern.id}-${sequence}`),
      label: first.name,
    })
  }
  graph.push({ seconds: departure, km: 0 })

  for (let legIndex = 0; legIndex < plan.legs.length; legIndex++) {
    const leg = plan.legs[legIndex]!
    const legStart = clock
    const runId = brandRun(`${pattern.id}-${sequence}`)

    // Belegungen entlang des Abschnitts.
    let trackKm = 0
    for (const trackId of leg.tracks) {
      const track = state.network.tracks.get(trackId)
      if (!track) continue

      const previousNode = legIndex === 0 ? plan.stopNodes[0]! : plan.stopNodes[legIndex]!
      const forwardOnTrack = isForwardOnTrack(state, trackId, previousNode, trackKm, leg)
      const dir: 1 | -1 = forwardOnTrack ? 1 : -1
      const doubleTrack = track.tracks >= 2

      const enterTrack = legStart + timeAtKm(leg, trackKm) * reserve
      const leaveTrack = legStart + timeAtKm(leg, trackKm + track.lengthKm) * reserve
      const clearing = SIGNAL_REACTION_SEC[track.signalling] + (train.lengthM / 1000 / 60) * 3600

      if (!doubleTrack) {
        // Eingleisig: die ganze Strecke ist fuer die Gegenrichtung gesperrt.
        claims.push({
          resource: sectionResource(trackId),
          kind: 'section',
          capacity: 1,
          from: enterTrack,
          to: leaveTrack + clearing,
          runId,
          direction: dir,
          label: `Eingleisiger Abschnitt (${track.lengthKm.toFixed(0)} km)`,
        })
      }

      const boundaries = blockBoundaries(track)
      for (let b = 0; b < boundaries.length - 1; b++) {
        const fromKm = forwardOnTrack ? boundaries[b]! : track.lengthKm - boundaries[b + 1]!
        const toKm = forwardOnTrack ? boundaries[b + 1]! : track.lengthKm - boundaries[b]!
        const enter = legStart + timeAtKm(leg, trackKm + Math.min(fromKm, toKm)) * reserve
        const leave = legStart + timeAtKm(leg, trackKm + Math.max(fromKm, toKm)) * reserve

        claims.push({
          resource: blockResource(trackId, dir, b),
          kind: 'block',
          capacity: 1,
          from: enter,
          to: leave + clearing,
          runId,
          label: `Block ${b + 1} von ${boundaries.length - 1}`,
        })
      }

      trackKm += track.lengthKm
    }

    // Zeit-Weg-Punkte fuer den Bildfahrplan.
    for (let km = GRAPH_STEP_KM; km < leg.lengthKm; km += GRAPH_STEP_KM) {
      graph.push({ seconds: legStart + timeAtKm(leg, km) * reserve, km: kmCursor + km })
    }

    clock = legStart + leg.runSeconds * reserve
    kmCursor += leg.lengthKm
    graph.push({ seconds: clock, km: kmCursor })

    const isLast = legIndex === plan.legs.length - 1
    const node = plan.stopNodes[legIndex + 1]!
    const station = stationAt(node)
    const dwell = isLast ? 0 : RAIL_DWELL_SEC
    const arrival = clock
    clock += dwell

    if (station) {
      stops.push({ stationId: station.id, nodeId: node, km: kmCursor, arrival, departure: clock })
      claims.push({
        resource: `platform:${station.id}`,
        kind: 'platform',
        capacity: station.platforms,
        from: arrival - 60,
        to: clock + 30,
        runId: brandRun(`${pattern.id}-${sequence}`),
        label: station.name,
      })
    }
  }

  const id = brandRun(`${pattern.id}-${sequence}`)
  claims.push({
    resource: `vehicle:${vehicleId}`,
    kind: 'vehicle',
    capacity: 1,
    from: departure,
    to: clock + RAIL_TURNAROUND_SEC,
    runId: id,
    label: 'Fahrzeugumlauf',
  })

  return {
    id,
    patternId: pattern.id,
    lineId: line.id,
    vehicleId,
    direction,
    stops,
    claims,
    graph,
    departure,
    arrival: clock,
    lengthKm: kmCursor,
  }
}

/**
 * Wird die Strecke in ihrer eigenen Richtung befahren?
 *
 * Der Weg liefert nur eine Kantenfolge; ob der Zug eine Kante von `from` nach
 * `to` oder umgekehrt befährt, ergibt sich aus dem vorhergehenden Knoten.
 */
function isForwardOnTrack(
  state: GameState,
  trackId: string,
  legStartNode: NodeId,
  trackKm: number,
  leg: LegRun,
): boolean {
  const track = state.network.tracks.get(trackId as never)
  if (!track) return true

  // Bei der ersten Kante des Abschnitts entscheidet der Startknoten.
  if (trackKm === 0) return track.from === legStartNode

  // Sonst der Anschluss an die vorhergehende Kante.
  let cursor = 0
  let previousExit: NodeId | null = null
  for (const id of leg.tracks) {
    const t = state.network.tracks.get(id)
    if (!t) continue
    if (cursor === trackKm) break
    previousExit = previousExit === null ? (t.from === legStartNode ? t.to : t.from) : oppositeEnd(t, previousExit)
    cursor += t.lengthKm
  }
  return previousExit === null ? true : track.from === previousExit
}

function oppositeEnd(track: { from: NodeId; to: NodeId }, entry: NodeId): NodeId {
  return track.from === entry ? track.to : track.from
}
