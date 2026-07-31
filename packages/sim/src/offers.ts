import {
  BUS_DWELL_SEC,
  dayBit,
  fareFor,
  type CityId,
  type FarePolicy,
  type GameState,
  type Line,
  type LineId,
  type ServicePattern,
  type StationId,
  type TrainClass,
} from '@game/domain'
import { findConflicts, type Conflict } from './blocks.js'
import { lineTrackAgeYears, rollDisruptions, type Disruption } from './disruptions.js'
import {
  departureTimes,
  effectiveHeadwayMin,
  fleetSummary,
  lineMetrics,
  vehiclesNeeded,
  type FleetSummary,
  type LineMetrics,
} from './lineMetrics.js'
import {
  applyDelays,
  buildRuns,
  effectiveRailHeadway,
  planLine,
  resolveDelays,
  trainsNeeded,
  type LinePlan,
  type RailRun,
} from './railRuns.js'

/**
 * Was eine Linie an einem Betriebstag anbietet — in einer Form, die für Bus und
 * Bahn dieselbe ist.
 *
 * Bis Phase 3 rechnete jede Linie ihre Nachfrage selbst aus der Matrix aus. Das
 * ging, solange jede Relation von höchstens einer Linie bedient wurde; sobald
 * ein Fahrgast umsteigen soll, geht es nicht mehr. Eine Reisekette gehört keiner
 * Linie, sondern dem Netz, und das Netz kann nur beurteilen, wer alle Angebote
 * nebeneinander kennt.
 *
 * Deshalb dieser Zwischenschritt: erst rechnet jede Linie aus, *was sie kann*
 * (Fahrzeiten, Takt, Plätze, Pünktlichkeit), dann verteilt eine zentrale Stelle
 * die Nachfrage darauf, und erst danach rechnet jede Linie ihren Tag ab.
 */

const HOURS = 24

export interface StopOffer {
  readonly stationId: StationId
  readonly cityId: CityId
  /** Weg vom Linienanfang in km, in Vorwärtsrichtung. */
  readonly km: number
  readonly arrivalSec: number
  readonly departureSec: number
  /** Anteil der Stadt, den dieser Halt erreicht. */
  readonly catchment: number
}

export interface LineOffer {
  readonly lineId: LineId
  readonly mode: 'bus' | 'rail'
  readonly fare: FarePolicy
  readonly stops: readonly StopOffer[]
  readonly headwayMin: number
  readonly comfort: number
  /** Sitzplätze je Stunde und Richtung. */
  readonly seatsPerHour: Float64Array
  /** Fahrten je Stunde und Richtung. */
  readonly departuresPerHour: Float64Array
  readonly departuresPerDirection: number
  readonly averageDelaySec: number
  readonly punctuality: number
  /**
   * Uhrzeit der ersten Abfahrt am Linienanfang.
   *
   * Zusammen mit dem Takt legt sie die **Phasenlage** der Linie fest: wann genau
   * in der Stunde sie an jedem Halt steht. Für sich genommen ist das eine
   * Nebensächlichkeit — erst im Zusammenspiel mit einer zweiten Linie entscheidet
   * sie darüber, ob ein Umstieg fünf oder fünfundfünfzig Minuten kostet.
   */
  readonly firstDepartureSec: number
  /** Fahrzeit vom ersten zum letzten Halt, inklusive Aufenthalten. */
  readonly oneWaySec: number
}

export type Direction = 'forward' | 'backward'

/**
 * Wann fährt die Linie an diesem Halt ab, in dieser Richtung?
 *
 * Die Gegenrichtung ist aus der Hinrichtung abgeleitet, weil der Fahrplan
 * symmetrisch ist: dieselbe Fahrzeit, dieselben Aufenthalte, dasselbe
 * Abfahrtsraster. Ein Gegenzug, der am anderen Ende zur selben Zeit losfährt,
 * erreicht Halt i genau `Umlaufzeit − Ankunft(i)` später.
 */
export function departureAt(offer: LineOffer, stopIndex: number, direction: Direction): number {
  const stop = offer.stops[stopIndex]!
  const offset = direction === 'forward' ? stop.departureSec : offer.oneWaySec - stop.arrivalSec
  return offer.firstDepartureSec + offset
}

export function arrivalAt(offer: LineOffer, stopIndex: number, direction: Direction): number {
  const stop = offer.stops[stopIndex]!
  const offset = direction === 'forward' ? stop.arrivalSec : offer.oneWaySec - stop.departureSec
  return offer.firstDepartureSec + offset
}

export interface BusDetail {
  readonly metrics: LineMetrics
  readonly fleet: FleetSummary
  readonly departures: readonly number[]
}

export interface RailDetail {
  readonly disruptions: readonly Disruption[]
  readonly plan: LinePlan
  readonly train: TrainClass
  /** Zugläufe mit bereits eingerechneter Verspätung — so sieht sie der Bildfahrplan. */
  readonly runs: readonly RailRun[]
  readonly conflicts: readonly Conflict[]
  readonly trainsNeeded: number
  readonly seats: number
}

export type PreparedLine =
  | {
      readonly kind: 'idle'
      readonly line: Line
      readonly warnings: readonly string[]
      readonly effectiveHeadwayMin: number
      readonly trainsNeeded: number
    }
  | { readonly kind: 'bus'; readonly line: Line; readonly warnings: readonly string[]; readonly offer: LineOffer; readonly detail: BusDetail }
  | { readonly kind: 'rail'; readonly line: Line; readonly warnings: readonly string[]; readonly offer: LineOffer; readonly detail: RailDetail }

export type PreparedBusLine = Extract<PreparedLine, { kind: 'bus' }>
export type PreparedRailLine = Extract<PreparedLine, { kind: 'rail' }>
export type PreparedIdleLine = Extract<PreparedLine, { kind: 'idle' }>

/** Zusätzliche Haltezeit, die allein aus dem Andrang stammt. */
export function crowdingDwellSeconds(line: Line, dwellSeconds: readonly number[], baseSec: number): number {
  let sum = 0
  for (let i = 1; i < line.stops.length - 1; i++) {
    const planned = Math.max(line.stops[i]!.dwellSeconds, baseSec)
    sum += Math.max(0, (dwellSeconds[i] ?? planned) - planned)
  }
  return sum
}

/** Fahrzeit zwischen zwei Halten einer Linie, in beliebiger Reihenfolge. */
export function rideSeconds(offer: LineOffer, a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return Math.max(0, offer.stops[hi]!.arrivalSec - offer.stops[lo]!.departureSec)
}

export function rideKm(offer: LineOffer, a: number, b: number): number {
  return Math.abs(offer.stops[b]!.km - offer.stops[a]!.km)
}

export function legFare(offer: LineOffer, a: number, b: number): number {
  return fareFor(offer.fare, rideKm(offer, a, b), 'second')
}

/**
 * Rechnet aus, was eine Linie heute fährt.
 *
 * Die Haltezeiten stammen aus den Fahrgastzahlen des Vortags: die Haltezeit
 * hängt vom Andrang ab, der Andrang über die Reisezeit von der Haltezeit. Statt
 * diesen Fixpunkt zu iterieren, plant das Spiel mit den Zahlen von gestern —
 * genau wie ein echter Betrieb seinen Fahrplan schreibt.
 */
export function prepareLine(state: GameState, line: Line): PreparedLine {
  const crowding = state.crowding.get(line.id) ?? []
  return line.mode === 'rail' ? prepareRail(state, line, crowding) : prepareBus(state, line, crowding)
}

function patternOf(state: GameState, lineId: LineId): ServicePattern | undefined {
  return [...state.patterns.values()].find((p) => p.lineId === lineId)
}

function prepareBus(state: GameState, line: Line, crowding: readonly number[]): PreparedLine {
  const warnings: string[] = []
  const idle = (headway = Number.POSITIVE_INFINITY): PreparedLine => ({
    kind: 'idle',
    line,
    warnings,
    effectiveHeadwayMin: headway,
    trainsNeeded: 0,
  })

  const pattern = patternOf(state, line.id)
  const metrics = lineMetrics(state, line, crowding)
  if (!metrics) {
    warnings.push('Linie hat weniger als zwei gültige Haltestellen.')
    return idle()
  }
  if (!pattern?.headway) {
    warnings.push('Kein Fahrplan hinterlegt.')
    return idle()
  }
  if ((pattern.days & dayBit(state.day)) === 0) return idle(pattern.headway.everyMinutes)

  const fleet = fleetSummary(state, pattern.vehicleIds)
  if (fleet.count === 0) {
    warnings.push('Der Linie ist kein Fahrzeug zugeteilt.')
    return idle()
  }

  const desired = pattern.headway.everyMinutes
  const headway = effectiveHeadwayMin(desired, metrics.roundTripSec, fleet.count)
  if (headway > desired + 0.5) {
    const needed = vehiclesNeeded(desired, metrics.roundTripSec)
    warnings.push(
      `Für einen ${desired}-Minuten-Takt fehlen ${needed - fleet.count} Fahrzeuge; gefahren wird ein ${Math.round(headway)}-Minuten-Takt.`,
    )
  }

  const departures = departureTimes(pattern, headway)
  if (departures.length === 0) {
    warnings.push('Das Zeitfenster lässt keine Abfahrt zu.')
    return idle(headway)
  }

  const departuresPerHour = new Float64Array(HOURS)
  for (const t of departures) departuresPerHour[Math.floor(t / 3600) % HOURS]! += 1

  const seatsPerHour = new Float64Array(HOURS)
  for (let h = 0; h < HOURS; h++) seatsPerHour[h] = (departuresPerHour[h] ?? 0) * fleet.seats

  // Kumulierte Ankunfts- und Abfahrtszeiten ab Linienanfang.
  const stops: StopOffer[] = []
  let clock = 0
  let km = 0
  for (let i = 0; i < metrics.stopIds.length; i++) {
    if (i > 0) {
      clock += metrics.legTimesSec[i - 1]!
      km += metrics.legDistancesKm[i - 1]!
    }
    const arrival = clock
    const isEnd = i === 0 || i === metrics.stopIds.length - 1
    if (!isEnd) clock += metrics.dwellSeconds[i] ?? BUS_DWELL_SEC
    const station = state.network.stations.get(metrics.stopIds[i]!)
    stops.push({
      stationId: metrics.stopIds[i]!,
      cityId: metrics.cityIds[i]!,
      km,
      arrivalSec: arrival,
      departureSec: clock,
      catchment: station?.catchment ?? 1,
    })
  }

  return {
    kind: 'bus',
    line,
    warnings,
    offer: {
      lineId: line.id,
      mode: 'bus',
      fare: line.fare,
      stops,
      headwayMin: headway,
      comfort: fleet.comfort,
      seatsPerHour,
      departuresPerHour,
      departuresPerDirection: departures.length,
      averageDelaySec: 0,
      punctuality: 1,
      firstDepartureSec: pattern.headway.firstDeparture,
      oneWaySec: stops[stops.length - 1]?.arrivalSec ?? 0,
    },
    detail: { metrics, fleet, departures },
  }
}

function prepareRail(state: GameState, line: Line, crowding: readonly number[]): PreparedLine {
  const warnings: string[] = []
  const pattern = patternOf(state, line.id)
  const plan = planLine(state, line, 'forward', crowding)
  warnings.push(...plan.problems)

  const idle = (headway = Number.POSITIVE_INFINITY, needed = 0): PreparedLine => ({
    kind: 'idle',
    line,
    warnings,
    effectiveHeadwayMin: headway,
    trainsNeeded: needed,
  })

  if (!plan.train || plan.legs.length === 0) return idle()
  if (!pattern?.headway) {
    warnings.push('Kein Fahrplan hinterlegt.')
    return idle()
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

  if ((pattern.days & dayBit(state.day)) === 0) return idle(desired, needed)

  const runs = buildRuns(state, line, pattern, headway, crowding)
  if (runs.length === 0) {
    warnings.push('Das Zeitfenster lässt keine Fahrt zu.')
    return idle(headway, needed)
  }

  const conflicts = findConflicts(runs.flatMap((r) => r.claims))

  // Stoerungen: Zustand des Zuges, Alter der Strecke, Auslastung von gestern.
  // Die Auslastung stammt aus dem Vortag - dieselbe Ueberlegung wie bei den
  // Haltezeiten, und aus demselben Grund kein Fixpunkt.
  const yesterday = crowding.reduce((s, v) => s + v, 0)
  const capacity = plan.train.seats.first + plan.train.seats.second
  const disruptions = rollDisruptions({
    seed: state.seed,
    day: state.day,
    runIds: runs.map((r) => r.id),
    vehicle: pattern.vehicleIds[0] ? state.fleet.get(pattern.vehicleIds[0]) : undefined,
    trackAgeYears: lineTrackAgeYears(state, line),
    loadFactor: capacity > 0 ? Math.min(3, yesterday / Math.max(1, capacity)) : 0,
  })

  const stalls = new Map(
    disruptions.map((d) => {
      const claims = runs.find((r) => r.id === d.runId)?.claims.length ?? 0
      // Etwa auf halber Strecke - dort schadet ein Halt am meisten.
      return [d.runId, { atClaim: Math.floor(claims * 0.4), seconds: d.seconds }]
    }),
  )

  const { delays, punctuality, averageDelaySec } = resolveDelays(
    runs,
    plan.legs.map((l) => l.runSeconds),
    line.runtimeReserve,
    stalls,
  )
  const delayed = applyDelays(runs, delays)

  const forward = runs.filter((r) => r.direction === 'forward')
  const reference = forward[0] ?? runs[0]!
  const departuresPerHour = new Float64Array(HOURS)
  for (const run of forward) departuresPerHour[Math.floor(run.departure / 3600) % HOURS]! += 1

  const seats = plan.train.seats.first + plan.train.seats.second
  const seatsPerHour = new Float64Array(HOURS)
  for (let h = 0; h < HOURS; h++) seatsPerHour[h] = (departuresPerHour[h] ?? 0) * seats

  // Die Fahrplanlagen des ersten Laufs, auf den Linienanfang normiert.
  const zero = reference.stops[0]?.departure ?? 0
  const stops: StopOffer[] = reference.stops.map((stop) => {
    const station = state.network.stations.get(stop.stationId)
    return {
      stationId: stop.stationId,
      cityId: station?.cityId ?? ('' as CityId),
      km: stop.km,
      arrivalSec: stop.arrival - zero,
      departureSec: stop.departure - zero,
      catchment: station?.catchment ?? 1,
    }
  })

  return {
    kind: 'rail',
    line,
    warnings,
    offer: {
      lineId: line.id,
      mode: 'rail',
      fare: line.fare,
      stops,
      headwayMin: headway,
      comfort: plan.train.comfort,
      seatsPerHour,
      departuresPerHour,
      departuresPerDirection: forward.length,
      averageDelaySec,
      punctuality,
      firstDepartureSec: zero,
      oneWaySec: stops[stops.length - 1]?.arrivalSec ?? 0,
    },
    detail: { plan, train: plan.train, runs: delayed, conflicts, disruptions, trainsNeeded: needed, seats },
  }
}

/** Alle Linien des Spielers, in einem Durchgang vorbereitet. */
export function prepareLines(state: GameState): PreparedLine[] {
  return [...state.lines.values()].map((line) => prepareLine(state, line))
}
