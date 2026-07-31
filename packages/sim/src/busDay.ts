import { BUS_DWELL_SEC, SEGMENT_IDS, dayBit, fareFor, toDate } from '@game/domain'
import type { GameState, LineDayResult, LineId, SegmentId } from '@game/domain'
import {
  carAlternative,
  dayFactor,
  hourShare,
  modeShares,
  incumbentTransit,
  noTravelAlternative,
  odKey,
  waitFromHeadway,
  type Alternative,
  type DemandMatrix,
} from '@game/demand'
import { departureTimes, effectiveHeadwayMin, fleetSummary, lineMetrics, vehiclesNeeded } from './lineMetrics.js'

const HOURS = 24
const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

/** Eine Fahrgastgruppe zwischen zwei Halten derselben Linie. */
interface Flow {
  readonly fromIndex: number
  readonly toIndex: number
  /** Fahrgaeste je Stunde. */
  readonly perHour: Float64Array
  readonly farePerRider: number
  readonly segment: SegmentId
}

/**
 * Simuliert einen Betriebstag einer Buslinie.
 *
 * Ablauf: Nachfrage je Halterelation aus der Gravitationsmatrix holen, ueber das
 * Logit-Modell den Busanteil bestimmen, auf Stunden verteilen, und erst dann die
 * Kapazitaet pruefen. Die Reihenfolge ist wichtig - wer zuerst deckelt, sieht
 * nie, wie viel Nachfrage er liegen laesst.
 */
export function simulateBusDay(state: GameState, demand: DemandMatrix, lineId: LineId): LineDayResult | null {
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

  const flowsForward: Flow[] = []
  const flowsBackward: Flow[] = []

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
        incumbentTransit(greatCircle, smallerPopulation),
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

        const flow: Flow = { fromIndex: a, toIndex: b, perHour, farePerRider: price, segment }
        if (a < b) flowsForward.push(flow)
        else flowsBackward.push(flow)
      }
    }
  }

  // Kapazitaetspruefung je Stunde und Richtung ueber den staerkst belasteten
  // Streckenabschnitt. Wer nicht mitkommt, bleibt stehen.
  const passengers = emptySegments()
  let revenue = 0
  let leftBehind = 0
  let peakLoadFactor = 0

  for (const flows of [flowsForward, flowsBackward]) {
    for (let h = 0; h < HOURS; h++) {
      const capacity = (departuresPerHour[h] ?? 0) * fleet.seats
      const linkLoad = new Float64Array(Math.max(1, stopCount - 1))
      let demandThisHour = 0

      for (const flow of flows) {
        const value = flow.perHour[h] ?? 0
        if (value <= 0) continue
        demandThisHour += value
        const lo = Math.min(flow.fromIndex, flow.toIndex)
        const hi = Math.max(flow.fromIndex, flow.toIndex)
        for (let link = lo; link < hi; link++) linkLoad[link] = (linkLoad[link] ?? 0) + value
      }

      if (demandThisHour <= 0) continue

      const maxLink = Math.max(...linkLoad)
      if (capacity <= 0) {
        leftBehind += demandThisHour
        continue
      }

      const load = maxLink / capacity
      peakLoadFactor = Math.max(peakLoadFactor, load)
      const scale = load > 1 ? 1 / load : 1
      if (scale < 1) leftBehind += demandThisHour * (1 - scale)

      for (const flow of flows) {
        const value = (flow.perHour[h] ?? 0) * scale
        if (value <= 0) continue
        passengers[flow.segment] += value
        revenue += value * flow.farePerRider
      }
    }
  }

  const totalPassengers = SEGMENT_IDS.reduce((s, seg) => s + passengers[seg], 0)
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
    revenue: Math.round(revenue),
    operatingCost,
    peakLoadFactor,
    vehicleKm,
    departuresPerDirection: departures.length,
    effectiveHeadwayMin: headway,
    warnings,
  }
}
