import {
  SEGMENT_IDS,
  dayBit,
  fareFor,
  toDate,
  trainClass,
  type GameState,
  type LineDayResult,
  type LineId,
  type SegmentId,
  type Sec,
} from '@game/domain'
import {
  carAlternative,
  dayFactor,
  hourShare,
  incumbentTransit,
  modeShares,
  noTravelAlternative,
  odKey,
  waitFromHeadway,
  type Alternative,
  type DemandMatrix,
} from '@game/demand'
import { adminCost, LINE_OVERHEAD_PER_DAY } from '@game/economy'
import { findConflicts, freeFrom, isMinor, type Claim, type Conflict } from './blocks.js'
import { buildRuns, effectiveRailHeadway, planLine, trainsNeeded, type RailRun } from './railRuns.js'
import { assignPassengers, type AssignmentFlow } from './assignment.js'

const HOURS = 24
const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

/** Ab dieser Verspätung gilt ein Halt als unpünktlich. */
export const PUNCTUALITY_THRESHOLD_SEC = 6 * 60

/**
 * Angebot des Spielers auf einer Relation. Wird gebraucht, damit Bus und Bahn
 * gegeneinander antreten und damit der Bestandsverkehr dort verschwindet, wo
 * der Spieler die Relation selbst bedient.
 */
export interface RailService {
  readonly travelTimeSec: number
  readonly headwayMin: number
  readonly priceCents: number
  readonly comfort: number
  readonly averageDelaySec: number
}

export type RailServiceIndex = ReadonlyMap<string, RailService>

export interface RailDayResult extends LineDayResult {
  readonly conflicts: readonly Conflict[]
  readonly runs: readonly RailRun[]
  readonly punctuality: number
  readonly averageDelaySec: number
  readonly trainsNeeded: number
}

/**
 * Simuliert einen Betriebstag einer Bahnlinie.
 *
 * Reihenfolge: Fahrplan bauen, Konflikte suchen, Verspätungen daraus ableiten,
 * und erst danach Fahrgäste zuordnen. Die Verspätung wirkt auf die Nachfrage
 * zurück — eine unzuverlässige Linie verliert Fahrgäste, und das ist der Grund,
 * warum sich ein Ausbau lohnt.
 */
export function simulateRailDay(
  state: GameState,
  demand: DemandMatrix,
  lineId: LineId,
  services: RailServiceIndex,
): RailDayResult | null {
  const line = state.lines.get(lineId)
  if (!line || line.mode !== 'rail') return null

  const pattern = [...state.patterns.values()].find((p) => p.lineId === lineId)
  const warnings: string[] = []

  const empty: RailDayResult = {
    lineId,
    passengers: emptySegments(),
    totalPassengers: 0,
    leftBehind: 0,
    revenue: 0,
    operatingCost: 0,
    peakLoadFactor: 0,
    vehicleKm: 0,
    departuresPerDirection: 0,
    effectiveHeadwayMin: Number.POSITIVE_INFINITY,
    warnings,
    conflicts: [],
    runs: [],
    punctuality: 1,
    averageDelaySec: 0,
    trainsNeeded: 0,
  }

  const plan = planLine(state, line)
  warnings.push(...plan.problems)
  if (!plan.train || plan.legs.length === 0) return empty
  if (!pattern?.headway) {
    warnings.push('Kein Fahrplan hinterlegt.')
    return empty
  }

  const trains = pattern.vehicleIds.length
  const desired = pattern.headway.everyMinutes
  const headway = effectiveRailHeadway(desired, plan.roundTripSeconds, trains)
  const needed = trainsNeeded(desired, plan.roundTripSeconds)
  if (headway > desired + 0.5) {
    warnings.push(
      `Für einen ${desired}-Minuten-Takt fehlen ${needed - trains} Züge; gefahren wird ein ${Math.round(headway)}-Minuten-Takt.`,
    )
  }

  if ((pattern.days & dayBit(state.day)) === 0) {
    return { ...empty, effectiveHeadwayMin: desired, trainsNeeded: needed }
  }

  const runs = buildRuns(state, line, pattern, headway)
  if (runs.length === 0) {
    warnings.push('Das Zeitfenster lässt keine Fahrt zu.')
    return { ...empty, trainsNeeded: needed }
  }

  const conflicts = findConflicts(runs.flatMap((r) => r.claims))
  const { delays, punctuality, averageDelaySec } = resolveDelays(runs, plan.legs.map((l) => l.runSeconds), line.runtimeReserve)

  // Nur nennenswerte Konflikte melden. Kreuzungen an einer Ueberholstelle
  // ueberschneiden sich zwangslaeufig um Sekunden; das ist kein Problem,
  // sondern normale Betriebstoleranz.
  const serious = conflicts.filter((c) => !isMinor(c))
  if (serious.length > 0) {
    const opposing = serious.filter((c) => c.kind === 'opposing_single').length
    const blocks = serious.filter((c) => c.kind === 'block').length
    const platforms = serious.filter((c) => c.kind === 'platform').length
    const vehicles = serious.filter((c) => c.kind === 'vehicle').length
    const parts: string[] = []
    if (opposing > 0) parts.push(`${opposing}× Gegenzug auf eingleisigem Abschnitt`)
    if (blocks > 0) parts.push(`${blocks}× Zugfolge zu dicht`)
    if (platforms > 0) parts.push(`${platforms}× Bahnsteig belegt`)
    if (vehicles > 0) parts.push(`${vehicles}× Fahrzeug doppelt eingeplant`)
    warnings.push(`Fahrplankonflikte: ${parts.join(', ')}.`)
  }
  if (averageDelaySec > PUNCTUALITY_THRESHOLD_SEC) {
    warnings.push(`Im Mittel ${Math.round(averageDelaySec / 60)} min Verspätung — der Takt ist für die Strecke zu dicht.`)
  }

  // ── Fahrgäste ────────────────────────────────────────────────────────────
  const forward = runs.filter((r) => r.direction === 'forward')
  const reference = forward[0] ?? runs[0]!
  const stopCount = reference.stops.length
  const seats = (plan.train.seats.first + plan.train.seats.second) * (pattern.vehicleIds.length > 0 ? 1 : 0)

  const departuresPerHour = new Float64Array(HOURS)
  for (const run of forward) departuresPerHour[Math.floor(run.departure / 3600) % HOURS]! += 1

  const { weekday, month } = toDate(state.day)
  const waitSec = waitFromHeadway(headway)
  const delayPenalty = averageDelaySec

  const flowsForward: AssignmentFlow[] = []
  const flowsBackward: AssignmentFlow[] = []

  for (let a = 0; a < stopCount; a++) {
    for (let b = 0; b < stopCount; b++) {
      if (a === b) continue

      const stationA = state.network.stations.get(reference.stops[a]!.stationId)
      const stationB = state.network.stations.get(reference.stops[b]!.stationId)
      if (!stationA || !stationB) continue

      const pair = demand.byKey.get(odKey(stationA.cityId, stationB.cityId))
      if (!pair) continue

      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const rideKm = reference.stops[hi]!.km - reference.stops[lo]!.km
      const rideSec = reference.stops[hi]!.arrival - reference.stops[lo]!.departure + delayPenalty
      const price = fareFor(line.fare, rideKm, 'second')

      const railAlt: Alternative = {
        mode: 'rail',
        priceCents: price,
        travelTimeSec: rideSec,
        waitTimeSec: waitSec,
        transfers: 0,
        comfort: plan.train.comfort,
      }

      // Wo der Spieler selbst faehrt, faellt der Bestandsverkehr weg - er hat
      // die Relation uebernommen. Sonst konkurrierte er gegen ein Phantom.
      const alternatives = [railAlt, carAlternative(pair.distanceKm), noTravelAlternative]

      const reach = stationA.catchment * stationB.catchment
      for (const segment of SEGMENT_IDS) {
        const daily = pair.trips[segment] * dayFactor(segment, weekday, month) * reach
        if (daily <= 0) continue

        const share = modeShares(segment, alternatives).rail
        const riders = daily * share
        if (riders <= 0.01) continue

        const perHour = new Float64Array(HOURS)
        for (let h = 0; h < HOURS; h++) perHour[h] = riders * hourShare(segment, h)

        const flow: AssignmentFlow = { fromIndex: a, toIndex: b, perHour, fare: price, segment }
        if (a < b) flowsForward.push(flow)
        else flowsBackward.push(flow)
      }
    }
  }

  const seatsPerHour = new Float64Array(HOURS)
  for (let h = 0; h < HOURS; h++) seatsPerHour[h] = (departuresPerHour[h] ?? 0) * seats

  const assignment = assignPassengers(flowsForward, flowsBackward, seatsPerHour, stopCount)
  const { passengers, revenue, leftBehind, peakLoadFactor, linkLoadFactors } = assignment

  const totalPassengers = assignment.totalPassengers
  const vehicleKm = runs.reduce((s, r) => s + r.lengthKm, 0)
  const drivingHours = runs.reduce((s, r) => s + (r.arrival - r.departure), 0) / 3600
  const operatingCost = Math.round(
    vehicleKm * plan.train.energyCostPerKm + drivingHours * plan.train.crewCostPerHour,
  )

  if (peakLoadFactor > 1) {
    warnings.push(`Überfüllt: in der Spitze ${Math.round(peakLoadFactor * 100)} % der Kapazität.`)
  }

  return {
    lineId,
    passengers,
    totalPassengers,
    leftBehind,
    revenue,
    operatingCost,
    peakLoadFactor,
    vehicleKm,
    departuresPerDirection: forward.length,
    effectiveHeadwayMin: headway,
    warnings,
    mode: 'rail',
    linkLoadFactors,
    conflictCount: serious.length,
    conflicts,
    runs: applyDelays(runs, delays),
    punctuality,
    averageDelaySec,
    trainsNeeded: needed,
  }
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
function resolveDelays(
  runs: readonly RailRun[],
  legRunSeconds: readonly number[],
  reserve: number,
): { delays: Map<string, number>; punctuality: number; averageDelaySec: number } {
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
function applyDelays(runs: readonly RailRun[], delays: ReadonlyMap<string, number>): RailRun[] {
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

/** Zusatzaufwand für Verwaltung und Vertrieb einer Bahnlinie. */
export function railOverhead(revenue: number): number {
  return adminCost(revenue) + LINE_OVERHEAD_PER_DAY * 2
}

/**
 * Angebotsindex des Spielers je Stadtpaar. Damit konkurrieren die eigenen Bus-
 * und Bahnlinien miteinander statt jede für sich gegen ein Phantom.
 */
export function buildRailServiceIndex(state: GameState): RailServiceIndex {
  const index = new Map<string, RailService>()

  for (const line of state.lines.values()) {
    if (line.mode !== 'rail') continue
    const pattern = [...state.patterns.values()].find((p) => p.lineId === line.id)
    if (!pattern?.headway || pattern.vehicleIds.length === 0) continue

    const plan = planLine(state, line)
    if (!plan.train || plan.legs.length === 0) continue

    const headway = effectiveRailHeadway(
      pattern.headway.everyMinutes,
      plan.roundTripSeconds,
      pattern.vehicleIds.length,
    )
    const runs = buildRuns(state, line, pattern, headway)
    const reference = runs.find((r) => r.direction === 'forward')
    if (!reference) continue

    for (let a = 0; a < reference.stops.length; a++) {
      for (let b = 0; b < reference.stops.length; b++) {
        if (a === b) continue
        const stationA = state.network.stations.get(reference.stops[a]!.stationId)
        const stationB = state.network.stations.get(reference.stops[b]!.stationId)
        if (!stationA || !stationB) continue

        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const rideKm = reference.stops[hi]!.km - reference.stops[lo]!.km
        const rideSec = reference.stops[hi]!.arrival - reference.stops[lo]!.departure

        index.set(odKey(stationA.cityId, stationB.cityId), {
          travelTimeSec: rideSec,
          headwayMin: headway,
          priceCents: fareFor(line.fare, rideKm, 'second'),
          comfort: plan.train.comfort,
          averageDelaySec: 0,
        })
      }
    }
  }

  return index
}

/** Bahnalternative für das Logit-Modell: eigenes Angebot, sonst Bestandsverkehr. */
export function railAlternativeFor(
  services: RailServiceIndex,
  key: string,
  greatCircleKm: number,
  smallerPopulation: number,
): Alternative {
  const own = services.get(key)
  if (!own) return incumbentTransit(greatCircleKm, smallerPopulation)
  return {
    mode: 'rail',
    priceCents: own.priceCents,
    travelTimeSec: own.travelTimeSec + own.averageDelaySec,
    waitTimeSec: waitFromHeadway(own.headwayMin),
    transfers: 0,
    comfort: own.comfort,
  }
}

export type { Sec }
