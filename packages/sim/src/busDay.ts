import { BUS_DWELL_SEC, SEGMENT_IDS } from '@game/domain'
import type { GameState, LineDayResult, SegmentId } from '@game/domain'
import { assignPassengers, type OdOutcome } from './assignment.js'
import type { AssignedFlows } from './demandAssignment.js'
import { crowdingDwellSeconds, type PreparedBusLine, type PreparedIdleLine } from './offers.js'

const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

/** Tagesergebnis einer Linie, die heute gar nicht fährt. */
export function idleResult(prepared: PreparedIdleLine): LineDayResult {
  return {
    lineId: prepared.line.id,
    passengers: emptySegments(),
    totalPassengers: 0,
    leftBehind: 0,
    revenue: 0,
    operatingCost: 0,
    peakLoadFactor: 0,
    vehicleKm: 0,
    departuresPerDirection: 0,
    effectiveHeadwayMin: prepared.effectiveHeadwayMin,
    warnings: prepared.warnings,
    mode: prepared.line.mode,
    ...(prepared.line.mode === 'rail'
      ? { punctuality: 1, averageDelaySec: 0, trainsNeeded: prepared.trainsNeeded, conflictCount: 0 }
      : {}),
  }
}

/**
 * Tagesergebnis plus die Abrechnung je Relation.
 *
 * Die Relationsergebnisse bleiben bewusst *neben* dem `LineDayResult`: dieses
 * landet 400 Tage lang in der Historie, und eine Tabelle je Relation und Tag
 * wäre dort um Größenordnungen das Schwerste am ganzen Spielstand. Gebraucht
 * werden sie nur für die Fortschreibung der Zufriedenheit, also genau einmal.
 */
export interface LineDayOutcome {
  readonly result: LineDayResult
  readonly odOutcomes: ReadonlyMap<string, OdOutcome>
}

/**
 * Rechnet den Betriebstag einer Buslinie ab.
 *
 * Die Nachfrage kommt fertig verteilt aus `assignDemand` — diese Funktion
 * prüft nur noch, wer davon tatsächlich einen Platz bekommt, und rechnet
 * Erlös und Aufwand zusammen.
 */
export function finishBusDay(
  state: GameState,
  prepared: PreparedBusLine,
  flows: AssignedFlows,
  transferPassengers: number,
): LineDayOutcome {
  const { line, offer, detail } = prepared
  const warnings = [...prepared.warnings]

  const assignment = assignPassengers({
    forward: flows.forward,
    backward: flows.backward,
    seatsPerHour: offer.seatsPerHour,
    departuresPerHour: offer.departuresPerHour,
    stopCount: offer.stops.length,
  })

  const vehicleKm = detail.departures.length * 2 * detail.metrics.lengthKm
  const drivingHours = (detail.departures.length * 2 * detail.metrics.oneWayTimeSec) / 3600
  const operatingCost = Math.round(
    vehicleKm * detail.fleet.fuelCostPerKm + drivingHours * detail.fleet.crewCostPerHour,
  )

  const extraDwell = crowdingDwellSeconds(line, detail.metrics.dwellSeconds, BUS_DWELL_SEC)
  if (assignment.peakLoadFactor > 1) {
    warnings.push(`Überfüllt: in der Spitze ${Math.round(assignment.peakLoadFactor * 100)} % der Kapazität.`)
  } else if (assignment.totalPassengers > 0 && assignment.peakLoadFactor < 0.15) {
    warnings.push('Sehr geringe Auslastung — Takt ausdünnen oder kleinere Fahrzeuge einsetzen.')
  }
  if (extraDwell > 60) {
    warnings.push(`Andrang verlängert die Fahrzeit um ${Math.round(extraDwell / 60)} min je Richtung.`)
  }

  return {
    result: {
      lineId: line.id,
      passengers: assignment.passengers,
      totalPassengers: assignment.totalPassengers,
      leftBehind: assignment.leftBehind,
      revenue: assignment.revenue,
      operatingCost,
      peakLoadFactor: assignment.peakLoadFactor,
      vehicleKm,
      departuresPerDirection: detail.departures.length,
      effectiveHeadwayMin: offer.headwayMin,
      warnings,
      mode: 'bus',
      linkLoadFactors: assignment.linkLoadFactors,
      transferPassengers,
      satisfaction: meanSatisfaction(state, assignment.byOd.keys()),
      stopFlowPerDeparture: assignment.stopFlowPerDeparture,
      crowdingDwellSec: extraDwell,
    },
    odOutcomes: assignment.byOd,
  }
}

/** Mittlere Zufriedenheit der Relationen, die diese Linie bedient. */
export function meanSatisfaction(state: GameState, ods: Iterable<string>): number {
  let sum = 0
  let count = 0
  for (const od of ods) {
    sum += state.satisfaction.get(od) ?? 1
    count++
  }
  return count > 0 ? sum / count : 1
}
