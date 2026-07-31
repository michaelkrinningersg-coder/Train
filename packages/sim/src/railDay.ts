import { RAIL_DWELL_SEC, type GameState, type LineDayResult, type LineId, type Sec } from '@game/domain'
import { adminCost, LINE_OVERHEAD_PER_DAY } from '@game/economy'
import { assignPassengers, type OdOutcome } from './assignment.js'
import { isMinor, type Conflict } from './blocks.js'
import { meanSatisfaction } from './busDay.js'
import type { AssignedFlows } from './demandAssignment.js'
import { crowdingDwellSeconds, type PreparedRailLine } from './offers.js'
import { PUNCTUALITY_THRESHOLD_SEC, type RailRun } from './railRuns.js'

export interface RailDayResult extends LineDayResult {
  readonly conflicts: readonly Conflict[]
  readonly runs: readonly RailRun[]
  readonly punctuality: number
  readonly averageDelaySec: number
  readonly trainsNeeded: number
}

/**
 * Rechnet den Betriebstag einer Bahnlinie ab.
 *
 * Fahrplan, Konflikte und Verspätungen stehen zu diesem Zeitpunkt schon fest
 * (siehe `prepareLine`), ebenso die Nachfrage (siehe `assignDemand`). Hier wird
 * nur noch geprüft, wer einen Platz bekommt, und abgerechnet.
 */
export interface RailDayOutcome {
  readonly result: RailDayResult
  readonly odOutcomes: ReadonlyMap<string, OdOutcome>
}

export function finishRailDay(
  state: GameState,
  prepared: PreparedRailLine,
  flows: AssignedFlows,
  transferPassengers: number,
): RailDayOutcome {
  const { line, offer, detail } = prepared
  const warnings = [...prepared.warnings]

  const assignment = assignPassengers({
    forward: flows.forward,
    backward: flows.backward,
    seatsPerHour: offer.seatsPerHour,
    departuresPerHour: offer.departuresPerHour,
    stopCount: offer.stops.length,
  })

  // Nur nennenswerte Konflikte melden. Kreuzungen an einer Ueberholstelle
  // ueberschneiden sich zwangslaeufig um Sekunden; das ist kein Problem,
  // sondern normale Betriebstoleranz.
  const serious = detail.conflicts.filter((c) => !isMinor(c))
  if (serious.length > 0) {
    const count = (kind: Conflict['kind']): number => serious.filter((c) => c.kind === kind).length
    const parts: string[] = []
    if (count('opposing_single') > 0) parts.push(`${count('opposing_single')}× Gegenzug auf eingleisigem Abschnitt`)
    if (count('block') > 0) parts.push(`${count('block')}× Zugfolge zu dicht`)
    if (count('platform') > 0) parts.push(`${count('platform')}× Bahnsteig belegt`)
    if (count('vehicle') > 0) parts.push(`${count('vehicle')}× Fahrzeug doppelt eingeplant`)
    warnings.push(`Fahrplankonflikte: ${parts.join(', ')}.`)
  }
  if (offer.averageDelaySec > PUNCTUALITY_THRESHOLD_SEC) {
    warnings.push(
      `Im Mittel ${Math.round(offer.averageDelaySec / 60)} min Verspätung — der Takt ist für die Strecke zu dicht.`,
    )
  }

  const extraDwell = crowdingDwellSeconds(line, detail.plan.dwellSeconds, RAIL_DWELL_SEC)
  if (extraDwell > 60) {
    warnings.push(`Andrang verlängert die Fahrzeit um ${Math.round(extraDwell / 60)} min je Richtung.`)
  }
  if (assignment.peakLoadFactor > 1) {
    warnings.push(`Überfüllt: in der Spitze ${Math.round(assignment.peakLoadFactor * 100)} % der Kapazität.`)
  }
  if (detail.disruptions.length > 0) {
    const minutes = Math.round(detail.disruptions.reduce((s, d) => s + d.seconds, 0) / 60)
    const vehicle = detail.disruptions.filter((d) => d.cause === 'vehicle').length
    warnings.push(
      `${detail.disruptions.length} Störung${detail.disruptions.length === 1 ? '' : 'en'} (${minutes} min)` +
        (vehicle > 0 ? ' — überwiegend am Fahrzeug. Eine Hauptuntersuchung hilft.' : ' — überwiegend an der Strecke.'),
    )
  }

  const vehicleKm = detail.runs.reduce((s, r) => s + r.lengthKm, 0)
  const drivingHours = detail.runs.reduce((s, r) => s + (r.arrival - r.departure), 0) / 3600
  const operatingCost = Math.round(
    vehicleKm * detail.train.energyCostPerKm + drivingHours * detail.train.crewCostPerHour,
  )

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
      departuresPerDirection: offer.departuresPerDirection,
      effectiveHeadwayMin: offer.headwayMin,
      warnings,
      mode: 'rail',
      linkLoadFactors: assignment.linkLoadFactors,
      conflictCount: serious.length,
      disruptionCount: detail.disruptions.length,
      conflicts: detail.conflicts,
      runs: detail.runs,
      punctuality: offer.punctuality,
      averageDelaySec: offer.averageDelaySec,
      trainsNeeded: detail.trainsNeeded,
      transferPassengers,
      satisfaction: meanSatisfaction(state, assignment.byOd.keys()),
      stopFlowPerDeparture: assignment.stopFlowPerDeparture,
      crowdingDwellSec: extraDwell,
    },
    odOutcomes: assignment.byOd,
  }
}

/** Zusatzaufwand für Verwaltung und Vertrieb einer Bahnlinie. */
export function railOverhead(revenue: number): number {
  return adminCost(revenue) + LINE_OVERHEAD_PER_DAY * 2
}

export type { Sec, LineId }
