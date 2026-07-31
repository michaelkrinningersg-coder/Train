import { BUS_DWELL_SEC, BUS_TIME_FACTOR, busClass, dwellWithCrowding, isAvailable } from '@game/domain'
import type { CityId, GameState, Line, ServicePattern, StationId, VehicleId } from '@game/domain'
import { CAR_SPEED_KMH, ROAD_DETOUR } from '@game/demand'
import { distanceKm } from '@game/geo'

/** Wendezeit an jedem Linienende. */
export const TURNAROUND_SEC = 300

export interface LineMetrics {
  readonly stopIds: readonly StationId[]
  readonly cityIds: readonly CityId[]
  /** Strassenentfernung zwischen aufeinanderfolgenden Halten. */
  readonly legDistancesKm: readonly number[]
  readonly legTimesSec: readonly number[]
  /** Luftlinie zwischen aufeinanderfolgenden Halten, fuer die Auto-Referenz. */
  readonly legGreatCircleKm: readonly number[]
  /** Haltezeit je Halt, inklusive Zuschlag aus Andrang. */
  readonly dwellSeconds: readonly number[]
  readonly lengthKm: number
  readonly oneWayTimeSec: number
  readonly roundTripSec: number
}

/**
 * Geometrie und Fahrzeit einer Buslinie.
 *
 * Solange die OSRM-Matrix fehlt, wird die Strassenentfernung aus der Luftlinie
 * genaehert (siehe docs/05-DATENPIPELINE.md Abschnitt 4). Der Austausch gegen
 * echte Routingzeiten beruehrt nur diese Funktion.
 */
export function lineMetrics(
  state: GameState,
  line: Line,
  /** Ein- und Aussteigende je Fahrt und Halt aus dem Vortag. */
  stopFlowPerDeparture: readonly number[] = [],
): LineMetrics | null {
  const stations = line.stops.map((s) => state.network.stations.get(s.stationId))
  if (stations.some((s) => !s) || stations.length < 2) return null

  const legDistancesKm: number[] = []
  const legGreatCircleKm: number[] = []
  const legTimesSec: number[] = []

  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1]!
    const b = stations[i]!
    const gc = distanceKm(a.position, b.position)
    const road = gc * ROAD_DETOUR
    legGreatCircleKm.push(gc)
    legDistancesKm.push(road)
    legTimesSec.push((road / CAR_SPEED_KMH) * 3600 * BUS_TIME_FACTOR)
  }

  const dwellSeconds = line.stops.map((stop, i) =>
    dwellWithCrowding('bus', stop.dwellSeconds, BUS_DWELL_SEC, stopFlowPerDeparture[i] ?? 0),
  )

  const lengthKm = legDistancesKm.reduce((a, b) => a + b, 0)
  const driving = legTimesSec.reduce((a, b) => a + b, 0)
  // Aufenthalt nur an den Zwischenhalten - an den Endpunkten zaehlt die Wendezeit.
  const dwell = dwellSeconds.slice(1, -1).reduce((a, b) => a + b, 0)
  const oneWayTimeSec = driving + dwell

  return {
    stopIds: stations.map((s) => s!.id),
    cityIds: stations.map((s) => s!.cityId),
    legDistancesKm,
    legGreatCircleKm,
    legTimesSec,
    dwellSeconds,
    lengthKm,
    oneWayTimeSec,
    roundTripSec: 2 * oneWayTimeSec + 2 * TURNAROUND_SEC,
  }
}

export interface FleetSummary {
  readonly count: number
  readonly seats: number
  readonly comfort: number
  readonly fuelCostPerKm: number
  readonly crewCostPerHour: number
}

/**
 * Mittelwerte des zugeteilten Fuhrparks. Ein Umlauf darf gemischt besetzt sein;
 * Sitzplaetze, Komfort und Kosten werden dann gemittelt. Das ist etwas
 * grosszuegig gegenueber der Realitaet, aber ehrlicher als den Spieler zu
 * einheitlichen Fahrzeugtypen zu zwingen.
 */
export function fleetSummary(state: GameState, vehicleIds: readonly VehicleId[]): FleetSummary {
  const classes = vehicleIds
    .map((id) => state.fleet.get(id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    // Ein Fahrzeug im Werk bleibt der Linie zugeteilt, faehrt aber nicht mit.
    .filter((v) => isAvailable(v, state.day))
    .map((v) => busClass(v.classId))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))

  if (classes.length === 0) {
    return { count: 0, seats: 0, comfort: 0, fuelCostPerKm: 0, crewCostPerHour: 0 }
  }

  const mean = (pick: (c: (typeof classes)[number]) => number): number =>
    classes.reduce((s, c) => s + pick(c), 0) / classes.length

  return {
    count: classes.length,
    seats: mean((c) => c.seats),
    comfort: mean((c) => c.comfort),
    fuelCostPerKm: mean((c) => c.fuelCostPerKm),
    crewCostPerHour: mean((c) => c.crewCostPerHour),
  }
}

/**
 * Der Takt, der mit den zugeteilten Fahrzeugen tatsaechlich gefahren werden
 * kann. Wer dichter takten will, braucht mehr Busse - das ist der zentrale
 * Investitionsdruck der Busphase.
 */
export function effectiveHeadwayMin(desiredMin: number, roundTripSec: number, vehicles: number): number {
  if (vehicles <= 0) return Number.POSITIVE_INFINITY
  return Math.max(desiredMin, roundTripSec / 60 / vehicles)
}

export function vehiclesNeeded(desiredHeadwayMin: number, roundTripSec: number): number {
  if (desiredHeadwayMin <= 0) return 0
  return Math.ceil(roundTripSec / 60 / desiredHeadwayMin)
}

/** Abfahrtszeiten in Sekunden nach Betriebsbeginn, aus dem effektiven Takt. */
export function departureTimes(pattern: ServicePattern, headwayMin: number): number[] {
  const h = pattern.headway
  if (!h || !Number.isFinite(headwayMin) || headwayMin <= 0) return []
  const step = headwayMin * 60
  const out: number[] = []
  for (let t = h.firstDeparture; t <= h.lastDeparture; t += step) out.push(t)
  return out
}
