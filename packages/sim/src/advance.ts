import { isAvailable } from '@game/domain'
import type { DayResult, GameState, LedgerEntry, LineDayResult, Money } from '@game/domain'
import type { DemandMatrix } from '@game/demand'
import {
  adminCost,
  ageVehicle,
  dailyInterest,
  LINE_OVERHEAD_PER_DAY,
  maturedLoans,
  trimLedger,
  vehicleUpkeepPerDay,
} from '@game/economy'
import { simulateDay } from './day.js'
import { railOverhead } from './railDay.js'
import { networkUpkeepPerDay } from './railCommands.js'

/** Zinssatz auf einen negativen Kontostand. Teurer als jeder Kredit - mit Absicht. */
export const OVERDRAFT_RATE = 0.12
/** Wie viele Tagesergebnisse fuer die Finanzansicht vorgehalten werden. */
export const HISTORY_DAYS = 400

/**
 * Rechnet einen Betriebstag und schliesst ihn finanziell ab.
 *
 * Reihenfolge: erst fahren, dann abrechnen. Der Kontostand ergibt sich
 * ausschliesslich aus dem Journal, damit Anzeige und Kasse nicht auseinander
 * laufen koennen.
 */
export function advanceDay(state: GameState, demand: DemandMatrix): GameState {
  const entries: Omit<LedgerEntry, 'day'>[] = []

  let revenue = 0
  let costs = 0
  let passengers = 0

  // Ein Durchgang fuer das ganze Netz: Angebot, Reiseketten, Wahl, Kapazitaet.
  // Die Linien einzeln zu rechnen ginge nicht mehr - eine Reisekette gehoert
  // keiner Linie.
  const day = simulateDay(state, demand)
  const lineResults = day.lines

  for (const result of lineResults) {
    const line = state.lines.get(result.lineId)
    if (!line) continue

    if (result.revenue > 0) {
      entries.push({ category: 'ticket_revenue', amount: result.revenue, lineId: line.id })
      revenue += result.revenue
    }
    if (result.operatingCost > 0) {
      // Kraftstoff und Personal stecken beide im Betriebsaufwand der Linie.
      entries.push({ category: 'energy', amount: -result.operatingCost, lineId: line.id })
      costs += result.operatingCost
    }
    // Verwaltung und Vertrieb fallen nur an, wenn die Linie auch faehrt.
    if (result.departuresPerDirection > 0) {
      const overhead = line.mode === 'rail' ? railOverhead(result.revenue) : adminCost(result.revenue) + LINE_OVERHEAD_PER_DAY
      entries.push({ category: 'crew', amount: -overhead, lineId: line.id, note: 'Verwaltung und Vertrieb' })
      costs += overhead
    }
    passengers += result.totalPassengers
  }

  const vehicleUpkeep = [...state.fleet.values()].reduce((s, v) => s + vehicleUpkeepPerDay(v), 0)
  if (vehicleUpkeep > 0) {
    entries.push({ category: 'vehicle_upkeep', amount: -vehicleUpkeep })
    costs += vehicleUpkeep
  }

  const stopUpkeep = [...state.network.stations.values()].reduce((s, st) => s + st.upkeepPerDay, 0)
  if (stopUpkeep > 0) {
    entries.push({ category: 'station_upkeep', amount: -stopUpkeep })
    costs += stopUpkeep
  }

  // Der Streckenunterhalt laeuft unabhaengig davon, ob ein Zug faehrt - genau
  // das macht ein zu grosszuegig gebautes Netz gefaehrlich.
  const trackUpkeep = networkUpkeepPerDay(state)
  if (trackUpkeep > 0) {
    entries.push({ category: 'track_upkeep', amount: -trackUpkeep })
    costs += trackUpkeep
  }

  const interest = dailyInterest(state.loans)
  const overdraft = state.cash < 0 ? Math.round((-state.cash * OVERDRAFT_RATE) / 365) : 0
  if (interest + overdraft > 0) {
    entries.push({
      category: 'interest',
      amount: -(interest + overdraft),
      ...(overdraft > 0 ? { note: 'inkl. Überziehungszinsen' } : {}),
    })
    costs += interest + overdraft
  }

  // Endfaellige Kredite werden am Laufzeitende zurueckgezahlt. Reicht das Geld
  // nicht, rutscht der Kontostand ins Minus - das kostet dann Ueberziehungszinsen.
  let loans = state.loans
  const matured = maturedLoans(loans, state.day)
  if (matured.length > 0) {
    const total = matured.reduce((s, l) => s + l.principal, 0)
    entries.push({ category: 'repayment', amount: -total, note: 'Kredit fällig' })
    costs += total
    loans = loans.filter((l) => !matured.includes(l))
  }

  const nextDay = state.day + 1
  const dated: LedgerEntry[] = entries.map((e) => ({ day: state.day, ...e }))
  const cash: Money = state.cash + dated.reduce((s, e) => s + e.amount, 0)

  const dayResult: DayResult = {
    day: state.day,
    lines: lineResults,
    revenue,
    costs,
    profit: revenue - costs,
    passengers,
  }

  const fleet = new Map(state.fleet)
  for (const [id, vehicle] of fleet) {
    if (vehicle.inWorkshopUntil !== undefined && nextDay >= vehicle.inWorkshopUntil) {
      const { inWorkshopUntil: _back, ...rest } = vehicle
      fleet.set(id, rest)
      continue
    }
    // Ein Fahrzeug im Werk faehrt nicht und nutzt sich deshalb auch nicht ab.
    fleet.set(id, isAvailable(vehicle, state.day) ? ageVehicle(vehicle) : vehicle)
  }

  // Abgeschlossene Ausbauten aus dem Zustand nehmen.
  const tracks = new Map(state.network.tracks)
  for (const [id, track] of tracks) {
    if (track.construction && nextDay >= track.construction.finishesOnDay) {
      const { construction: _done, ...rest } = track
      tracks.set(id, rest)
    }
  }
  const stations = new Map(state.network.stations)
  for (const [id, station] of stations) {
    if (station.construction && nextDay >= station.construction.finishesOnDay) {
      const { construction: _done, ...rest } = station
      stations.set(id, rest)
    }
  }

  return {
    ...state,
    day: nextDay,
    cash,
    loans,
    fleet,
    network: { ...state.network, tracks, stations },
    satisfaction: day.satisfaction,
    crowding: day.crowding,
    ledger: trimLedger([...state.ledger, ...dated], nextDay),
    lastDay: dayResult,
    history: [...state.history, dayResult].slice(-HISTORY_DAYS),
  }
}

export function advanceDays(state: GameState, demand: DemandMatrix, days: number): GameState {
  let current = state
  for (let i = 0; i < days; i++) current = advanceDay(current, demand)
  return current
}
