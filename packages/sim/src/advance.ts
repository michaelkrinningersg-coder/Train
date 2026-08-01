import { isAvailable } from '@game/domain'
import type { DayResult, GameState, LedgerEntry, Money } from '@game/domain'
import type { DemandMatrix } from '@game/demand'
import {
  adminCost,
  ageVehicle,
  dailyInterest,
  LINE_OVERHEAD_PER_DAY,
  maturedLoans,
  REPAIR_RESTORES,
  repairCost,
  trimLedger,
  vehicleSpec,
  vehicleUpkeepPerDay,
} from '@game/economy'
import { buildDemandMatrix, withPotentials } from '@game/demand'
import { simulateDay } from './day.js'
import { applyChanges, rollStructuralChanges } from './structure.js'
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

  const fleet = new Map(state.fleet)
  for (const [id, vehicle] of fleet) {
    if (vehicle.inWorkshopUntil !== undefined && nextDay >= vehicle.inWorkshopUntil) {
      const { inWorkshopUntil: _back, workshopReason: _why, ...rest } = vehicle
      fleet.set(id, rest)
      continue
    }
    // Ein Fahrzeug im Werk faehrt nicht und nutzt sich deshalb auch nicht ab.
    fleet.set(id, isAvailable(vehicle, state.day) ? ageVehicle(vehicle) : vehicle)
  }

  // Fahrzeugschaeden zuletzt, damit sie die Alterungsschleife ueberschreiben und
  // nicht umgekehrt. Ein Fahrzeug, das heute liegengeblieben ist, steht morgen
  // im Werk - erst damit bekommt die Reserve ihren Zweck.
  for (const breakdown of day.breakdowns) {
    const vehicle = fleet.get(breakdown.vehicleId)
    if (!vehicle) continue
    const price = vehicleSpec(vehicle)?.purchasePrice ?? 0
    const cost = repairCost(vehicle, price, breakdown.days)
    entries.push({
      category: 'vehicle_upkeep',
      amount: -cost,
      lineId: breakdown.lineId,
      note: `Schaden — ${breakdown.days} Tage Werkstatt`,
    })
    costs += cost
    fleet.set(breakdown.vehicleId, {
      ...vehicle,
      // Repariert wird der Schaden, nicht das Fahrzeug.
      condition: Math.min(1, vehicle.condition + REPAIR_RESTORES),
      inWorkshopUntil: nextDay + breakdown.days,
      workshopReason: 'repair',
    })
  }

  // Erst jetzt abrechnen: die Reparaturen von eben gehoeren in dieselbe
  // Tagesbilanz. Der Kontostand kommt ausschliesslich aus dem Journal.
  const dated: LedgerEntry[] = entries.map((e) => ({ day: state.day, ...e }))
  const cash: Money = state.cash + dated.reduce((s, e) => s + e.amount, 0)

  const dayResult: DayResult = {
    day: state.day,
    lines: lineResults,
    revenue,
    costs,
    profit: revenue - costs,
    passengers,
    trackLoad: Object.fromEntries([...day.trackLoads].map(([id, l]) => [id, l.load])),
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

  // Strukturwandel wird fuer den *kommenden* Tag gerollt: die Aenderung gilt ab
  // morgen, damit der eben abgerechnete Betriebstag noch die Staedte hatte, mit
  // denen er gerechnet wurde.
  const structural = rollStructuralChanges({ ...state, day: nextDay })

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
    history: appendHistory(state.history, dayResult),
    cities: applyChanges(state.cities, structural) ?? state.cities,
    facilityChanges: structural.length > 0 ? [...state.facilityChanges, ...structural] : state.facilityChanges,
  }
}

/**
 * Historie fortschreiben — und dabei den Vortag auf seine Summen kürzen.
 *
 * Gelesen wird aus der Historie ausschließlich der **Tagesgewinn**; die
 * Finanzansicht nimmt sonst nichts daraus. Die Zahlen je Linie stehen für den
 * jüngsten Tag ohnehin in `lastDay`, und dort holen sie sich die Linienpanels.
 *
 * Vierhundert vollständige Tagesergebnisse mit je einem Dutzend Linien sind
 * dagegen der mit Abstand schwerste Teil des Spielzustands: eine Kopie davon
 * kostete gemessen 43 ms, ohne sie 14 ms. Das ist der Unterschied zwischen
 * einer Simulation, die sich in einen Web Worker verschieben lässt, und einer,
 * bei der das Verschieben teurer wäre als das Rechnen.
 *
 * Gekürzt wird beim Nachrücken und nicht beim Lesen: so entsteht je Tag genau
 * ein neues Objekt statt vierhundert.
 */
export function appendHistory(history: readonly DayResult[], day: DayResult): DayResult[] {
  const previous = history[history.length - 1]
  const older = previous ? [...history.slice(0, -1), { ...previous, lines: [] }] : []
  return [...older, day].slice(-HISTORY_DAYS)
}

/**
 * Mehrere Betriebstage am Stück.
 *
 * Die Nachfragematrix wird **unterwegs neu gebaut**, wenn der Strukturwandel
 * eine Stadt verändert hat. Anders ginge es nicht: die Matrix hängt an den
 * Potenzialen, die Potenziale an den Einrichtungen, und wer eine Zeche
 * schließt, dessen Pendlerströme sind am nächsten Tag andere. Sie stattdessen
 * beim Aufrufer zu erneuern hieße, den Rest des Sprungs mit der Landkarte von
 * gestern zu rechnen.
 *
 * Das kostet für Deutschland rund eine Sekunde — einmal im Spieljahr, also
 * einmal auf 365 Betriebstage. Der Aufrufer erkennt an `facilityChanges`, dass
 * er seine eigene Kopie ebenfalls erneuern muss.
 */
export function advanceDays(state: GameState, demand: DemandMatrix, days: number): GameState {
  let current = state
  let matrix = demand

  for (let i = 0; i < days; i++) {
    const before = current.facilityChanges.length
    current = advanceDay(current, matrix)
    if (current.facilityChanges.length > before) {
      matrix = buildDemandMatrix(withPotentials([...current.cities.values()]), { minTripsPerDay: demand.minTripsPerDay })
    }
  }

  return current
}
