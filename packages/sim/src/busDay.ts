import { BUS_DWELL_SEC, SEGMENT_IDS, dayBit, fareFor, toDate } from '@game/domain'
import type { GameState, LineDayResult, LineId, SegmentId } from '@game/domain'
import {
  carAlternative,
  dayFactor,
  hourShare,
  modeShares,
  noTravelAlternative,
  odKey,
  waitFromHeadway,
  type Alternative,
  type DemandMatrix,
} from '@game/demand'
import { departureTimes, effectiveHeadwayMin, fleetSummary, lineMetrics, vehiclesNeeded } from './lineMetrics.js'
import { railAlternativeFor, type RailServiceIndex } from './railDay.js'
import { assignPassengers, type AssignmentFlow } from './assignment.js'

const HOURS = 24
const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

/**
 * Simuliert einen Betriebstag einer Buslinie.
 *
 * Ablauf: Nachfrage je Halterelation aus der Gravitationsmatrix holen, ueber das
 * Logit-Modell den Busanteil bestimmen, auf Stunden verteilen, und erst dann die
 * Kapazitaet pruefen. Die Reihenfolge ist wichtig - wer zuerst deckelt, sieht
 * nie, wie viel Nachfrage er liegen laesst.
 */
export function simulateBusDay(
  state: GameState,
  demand: DemandMatrix,
  lineId: LineId,
  services: RailServiceIndex = new Map(),
): LineDayResult | null {
  const line = state.lines.get(lineId)
  if (!line || line.mode !== 'bus') return null

  const pattern = [...state.patterns.values()].find((p) => p.lineId === lineId)
  const metrics = lineMetrics(state, line)
  const warnings: string[] = []

  const empty: LineDayResult = {
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
  }

  if (!metrics) {
    warnings.push('Linie hat weniger als zwei gültige Haltestellen.')
    return empty
  }
  if (!pattern?.headway) {
    warnings.push('Kein Fahrplan hinterlegt.')
    return empty
  }
  if ((pattern.days & dayBit(state.day)) === 0) {
    return { ...empty, effectiveHeadwayMin: pattern.headway.everyMinutes }
  }

  const fleet = fleetSummary(state, pattern.vehicleIds)
  if (fleet.count === 0) {
    warnings.push('Der Linie ist kein Fahrzeug zugeteilt.')
    return empty
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
    return empty
  }

  // Abfahrten je Stunde und Richtung.
  const departuresPerHour = new Float64Array(HOURS)
  for (const t of departures) {
    const hour = Math.floor(t / 3600) % HOURS
    departuresPerHour[hour] = (departuresPerHour[hour] ?? 0) + 1
  }

  const { weekday, month } = toDate(state.day)
  const stopCount = metrics.stopIds.length
  const waitSec = waitFromHeadway(headway)

  // Kumulierte Distanzen und Zeiten, damit jede Relation in O(1) auswertbar ist.
  const cumKm = [0]
  const cumSec = [0]
  for (let i = 0; i < stopCount - 1; i++) {
    cumKm.push(cumKm[i]! + metrics.legDistancesKm[i]!)
    cumSec.push(cumSec[i]! + metrics.legTimesSec[i]!)
  }

  const flowsForward: AssignmentFlow[] = []
  const flowsBackward: AssignmentFlow[] = []

  for (let a = 0; a < stopCount; a++) {
    for (let b = 0; b < stopCount; b++) {
      if (a === b) continue

      const cityA = metrics.cityIds[a]!
      const cityB = metrics.cityIds[b]!
      const pair = demand.byKey.get(odKey(cityA, cityB))
      if (!pair) continue

      const stationA = state.network.stations.get(metrics.stopIds[a]!)
      const stationB = state.network.stations.get(metrics.stopIds[b]!)
      if (!stationA || !stationB) continue
      const reach = stationA.catchment * stationB.catchment

      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const rideKm = cumKm[hi]! - cumKm[lo]!
      // Fahrzeit plus Aufenthalt an jedem Zwischenhalt - genau das macht eine
      // Linie mit vielen Halten fuer Fernrelationen unattraktiv.
      const rideSec = cumSec[hi]! - cumSec[lo]! + Math.max(0, hi - lo - 1) * BUS_DWELL_SEC
      const greatCircle = pair.distanceKm

      const price = fareFor(line.fare, rideKm, 'second')
      const busAlt: Alternative = {
        mode: 'bus',
        priceCents: price,
        travelTimeSec: rideSec,
        waitTimeSec: waitSec,
        transfers: 0,
        comfort: fleet.comfort,
      }
      const smallerPopulation = Math.min(
        state.cities.get(cityA)?.population ?? 0,
        state.cities.get(cityB)?.population ?? 0,
      )
      const alternatives = [
        busAlt,
        carAlternative(greatCircle),
        // Eigene Bahnlinie, wenn es eine gibt - sonst der Bestandsverkehr.
        railAlternativeFor(services, odKey(cityA, cityB), greatCircle, smallerPopulation),
        noTravelAlternative,
      ]

      for (const segment of SEGMENT_IDS) {
        const daily = pair.trips[segment] * dayFactor(segment, weekday, month) * reach
        if (daily <= 0) continue

        const share = modeShares(segment, alternatives).bus
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
  for (let h = 0; h < HOURS; h++) seatsPerHour[h] = (departuresPerHour[h] ?? 0) * fleet.seats

  const assignment = assignPassengers(flowsForward, flowsBackward, seatsPerHour, stopCount)
  const { passengers, revenue, leftBehind, peakLoadFactor, linkLoadFactors } = assignment

  const totalPassengers = assignment.totalPassengers
  const vehicleKm = departures.length * 2 * metrics.lengthKm
  const drivingHours = (departures.length * 2 * metrics.oneWayTimeSec) / 3600
  const operatingCost = Math.round(vehicleKm * fleet.fuelCostPerKm + drivingHours * fleet.crewCostPerHour)

  if (peakLoadFactor > 1) {
    warnings.push(`Überfüllt: in der Spitze ${Math.round(peakLoadFactor * 100)} % der Kapazität.`)
  } else if (totalPassengers > 0 && peakLoadFactor < 0.15) {
    warnings.push('Sehr geringe Auslastung — Takt ausdünnen oder kleinere Fahrzeuge einsetzen.')
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
    departuresPerDirection: departures.length,
    effectiveHeadwayMin: headway,
    warnings,
    mode: 'bus',
    linkLoadFactors,
  }
}
