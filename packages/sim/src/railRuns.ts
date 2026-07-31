import {
  RAIL_DWELL_SEC,
  RAIL_TURNAROUND_SEC,
  SIGNAL_REACTION_SEC,
  dwellWithCrowding,
  expandDepartures,
  platformsInService,
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
import { blockBoundaries, sectionResource, blockResource, freeFrom, type Claim } from './blocks.js'
import { resolveLinePath } from './railGraph.js'
import { legRunTime, timeAtKm, type LegRun } from './runTime.js'

/** Ab dieser Verspätung gilt ein Halt als unpünktlich. */
export const PUNCTUALITY_THRESHOLD_SEC = 6 * 60

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
  /** Haltezeit je Halt in Fahrtrichtung dieses Plans. */
  readonly dwellSeconds: readonly number[]
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
export function planLine(
  state: GameState,
  line: Line,
  direction: 'forward' | 'backward' = 'forward',
  /**
   * Ein- und Aussteigende je Fahrt und Halt aus dem Vortag, in Vorwärtsrichtung
   * der Linie. Ohne Angabe gilt die Mindesthaltezeit — so verhält sich eine
   * frisch angelegte Linie am ersten Tag.
   */
  stopFlowPerDeparture: readonly number[] = [],
): LinePlan {
  const problems: string[] = []

  const pattern = [...state.patterns.values()].find((p) => p.lineId === line.id)
  const vehicle = pattern?.vehicleIds[0] ? state.fleet.get(pattern.vehicleIds[0]) : undefined
  const train = vehicle ? (trainClass(vehicle.classId) ?? null) : null
  if (!train) problems.push('Der Linie ist kein Zug zugeteilt.')

  const forwardDwell = line.stops.map((stop, i) =>
    dwellWithCrowding('rail', stop.dwellSeconds, RAIL_DWELL_SEC, stopFlowPerDeparture[i] ?? 0),
  )
  const dwellSeconds = direction === 'forward' ? forwardDwell : [...forwardDwell].reverse()

  const ordered = direction === 'forward' ? line.stops : [...line.stops].reverse()
  const stations = ordered.map((s) => state.network.stations.get(s.stationId))
  if (stations.some((s) => !s)) problems.push('Ein Halt fehlt im Netz.')

  const stopNodes = stations.filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => s.nodeId)
  if (stopNodes.length < 2) {
    return {
      line,
      train,
      stopNodes,
      legs: [],
      lengthKm: 0,
      oneWaySeconds: 0,
      roundTripSeconds: 0,
      dwellSeconds,
      problems,
    }
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
  // Aufenthalt nur an den Zwischenhalten - an den Endpunkten zaehlt die Wendezeit.
  const dwell = dwellSeconds.slice(1, -1).reduce((s, d) => s + d, 0)
  const oneWaySeconds = driving + dwell

  return {
    line,
    train,
    stopNodes,
    legs,
    lengthKm,
    oneWaySeconds,
    roundTripSeconds: 2 * oneWaySeconds + 2 * RAIL_TURNAROUND_SEC,
    dwellSeconds,
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
  stopFlowPerDeparture: readonly number[] = [],
): RailRun[] {
  const runs: RailRun[] = []
  const vehicles = pattern.vehicleIds
  if (vehicles.length === 0) return runs

  const departures = expandDeparturesWith(pattern, headwayMin)
  if (departures.length === 0) return runs

  const plans = {
    forward: planLine(state, line, 'forward', stopFlowPerDeparture),
    backward: planLine(state, line, 'backward', stopFlowPerDeparture),
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
    // Waehrend eines Umbaus zaehlen nur die Gleise, die tatsaechlich befahrbar sind.
    return station
      ? { id: station.id, platforms: platformsInService(station, state.day), name: station.name }
      : null
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
    const dwell = isLast ? 0 : (plan.dwellSeconds[legIndex + 1] ?? RAIL_DWELL_SEC)
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

export interface DelayResult {
  readonly delays: ReadonlyMap<string, number>
  readonly punctuality: number
  readonly averageDelaySec: number
}

/**
 * Verspätungsausbreitung als ereignisgesteuerte Belegung.
 *
 * Verarbeitet werden nicht die Züge in Abfahrtsreihenfolge, sondern die
 * **Belegungen in zeitlicher Reihenfolge**. Das ist kein Detail: kreuzen sich
 * zwei Züge an einer Überholstelle, erreicht der eine den Abschnitt Sekunden
 * vor dem anderen. Wer nach Abfahrtszeit sortiert, lässt womöglich den bereits
 * eingefahrenen Zug auf den noch nicht abgefahrenen warten — und macht aus
 * zwanzig Sekunden Kreuzungstoleranz eine halbe Stunde Verspätung.
 *
 * Findet ein Zug ein Betriebsmittel belegt, wartet er, und alles Folgende
 * verschiebt sich mit. So entsteht Folgeverspätung: nicht als Zufallszahl,
 * sondern weil zwei Züge dieselbe Stelle brauchen. Die Fahrzeitreserve baut sie
 * unterwegs wieder ab.
 */
export function resolveDelays(
  runs: readonly RailRun[],
  legRunSeconds: readonly number[],
  reserve: number,
): DelayResult {
  const occupied = new Map<string, Claim[]>()
  const delays = new Map<string, number>()

  // Belegungen je Zug, chronologisch. Der Zeiger wandert beim Abarbeiten weiter.
  const sortedClaims = runs.map((run) => [...run.claims].sort((a, b) => a.from - b.from))
  const cursor = runs.map(() => 0)
  const delay = runs.map(() => 0)

  const pending = (): number => {
    let best = -1
    let bestTime = Infinity
    for (let i = 0; i < runs.length; i++) {
      const index = cursor[i]!
      if (index >= sortedClaims[i]!.length) continue
      const time = sortedClaims[i]![index]!.from + delay[i]!
      if (time < bestTime) {
        bestTime = time
        best = i
      }
    }
    return best
  }

  let guard = 0
  const limit = runs.reduce((n, r) => n + r.claims.length, 0) + 16

  for (;;) {
    if (guard++ > limit) break
    const i = pending()
    if (i < 0) break

    const claim = sortedClaims[i]![cursor[i]!]!
    const existing = occupied.get(claim.resource) ?? []
    const from = claim.from + delay[i]!
    const to = claim.to + delay[i]!

    const earliest = freeFrom(existing, from, to, claim.capacity, claim.direction, claim.kind === 'section')
    if (earliest > from) delay[i] = delay[i]! + (earliest - from)

    const shifted: Claim = { ...claim, from: claim.from + delay[i]!, to: claim.to + delay[i]! }
    if (existing.length > 0) existing.push(shifted)
    else occupied.set(claim.resource, [shifted])
    cursor[i] = cursor[i]! + 1
  }

  let punctualStops = 0
  let totalStops = 0
  let delaySum = 0
  const recoveryPerLeg = legRunSeconds.map((s) => s * (reserve - 1))

  runs.forEach((run, i) => {
    delays.set(run.id, delay[i]!)
    let remaining = delay[i]!
    run.stops.forEach((_stop, index) => {
      totalStops++
      if (remaining <= PUNCTUALITY_THRESHOLD_SEC) punctualStops++
      delaySum += remaining
      remaining = Math.max(0, remaining - (recoveryPerLeg[index] ?? 0))
    })
  })

  return {
    delays,
    punctuality: totalStops > 0 ? punctualStops / totalStops : 1,
    averageDelaySec: totalStops > 0 ? delaySum / totalStops : 0,
  }
}

/** Verschiebt die Fahrplanlagen um die ermittelte Verspätung — für den Bildfahrplan. */
export function applyDelays(runs: readonly RailRun[], delays: ReadonlyMap<string, number>): RailRun[] {
  return runs.map((run) => {
    const d = delays.get(run.id) ?? 0
    if (d === 0) return run
    return {
      ...run,
      departure: run.departure + d,
      arrival: run.arrival + d,
      stops: run.stops.map((s) => ({ ...s, arrival: s.arrival + d, departure: s.departure + d })),
      graph: run.graph.map((g) => ({ ...g, seconds: g.seconds + d })),
    }
  })
}
