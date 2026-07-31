import { busClass, nodeId as brandNode, stationCatchment, trainClass } from '@game/domain'
import type {
  Command,
  CommandResult,
  GameState,
  LedgerEntry,
  Line,
  Money,
  ServicePattern,
  Station,
  Vehicle,
} from '@game/domain'
import { busStopCost, BUS_STOP_UPKEEP_PER_DAY, creditLimit, interestRateFor, resaleValue, vehicleSpec } from '@game/economy'
import { applyRailCommand, type CommandContext } from './railCommands.js'
import { newLineId, newPatternId, newStationId, newVehicleId, withMap } from './state.js'

const fail = (reason: string): CommandResult => ({ ok: false, reason })

function book(state: GameState, entry: Omit<LedgerEntry, 'day'>): GameState {
  const full: LedgerEntry = { day: state.day, ...entry }
  return { ...state, cash: state.cash + full.amount, ledger: [...state.ledger, full] }
}

/**
 * Wendet einen Spielerbefehl an. Jeder Befehl ist rein: er bekommt einen
 * Zustand und liefert einen neuen. Das ist die Grundlage fuer Undo, Replay und
 * einen spaeteren serverautoritativen Modus.
 */
export function applyCommand(state: GameState, command: Command, ctx: CommandContext = {}): CommandResult {
  switch (command.kind) {
    case 'place_station':
    case 'build_track':
    case 'upgrade_track':
    case 'demolish_track':
    case 'place_passing_loop':
      return applyRailCommand(state, command, ctx)

    case 'place_bus_stop': {
      const city = state.cities.get(command.cityId)
      if (!city) return fail('Unbekannte Stadt.')
      const existing = [...state.network.stations.values()].find(
        (s) => s.cityId === command.cityId && s.mode !== 'rail',
      )
      if (existing) return fail(`${city.name} hat bereits eine Haltestelle.`)

      const cost = busStopCost(city.population)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const id = newStationId(state)
      const station: Station = {
        id,
        cityId: city.id,
        nodeId: brandNode(`n-${id}`),
        name: city.name,
        position: city.centre,
        mode: 'bus',
        platforms: 1,
        // Bushaltestellen liegen zentral. Der Zielkonflikt zwischen Lage und
        // Erreichbarkeit kommt in Phase 2 mit den Bahnhoefen.
        catchment: stationCatchment(0, city.radiusKm),
        distanceToCentreKm: 0,
        buildCost: cost,
        upkeepPerDay: BUS_STOP_UPKEEP_PER_DAY,
      }

      const next = {
        ...state,
        network: { ...state.network, stations: withMap(state.network.stations, id, station) },
      }
      return { ok: true, state: book(next, { category: 'stop_construction', amount: -cost, note: city.name }), cost }
    }

    case 'remove_bus_stop': {
      const station = state.network.stations.get(command.stationId)
      if (!station) return fail('Unbekannte Haltestelle.')
      const used = [...state.lines.values()].some((l) => l.stops.some((s) => s.stationId === station.id))
      if (used) return fail('Die Haltestelle wird noch von einer Linie bedient.')

      return {
        ok: true,
        cost: 0,
        state: {
          ...state,
          network: { ...state.network, stations: withMap(state.network.stations, station.id, undefined) },
        },
      }
    }

    case 'buy_vehicle': {
      const bus = busClass(command.classId)
      const train = trainClass(command.classId)
      const cls = bus ?? train
      if (!cls) return fail('Unbekannter Fahrzeugtyp.')
      const mode = bus ? 'bus' : 'rail'
      const count = Math.max(1, Math.round(command.units))
      const cost = cls.purchasePrice * count
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      // Jeder Bus ist ein eigenes Fahrzeug. Mehrfachtraktion gibt es erst bei
      // der Bahn; `units` bleibt hier bewusst 1.
      let fleet = state.fleet
      for (let i = 0; i < count; i++) {
        const id = newVehicleId({ ...state, fleet })
        const vehicle: Vehicle = {
          id,
          classId: cls.id,
          mode,
          units: 1,
          boughtAt: state.day * 86_400,
          condition: 1,
        }
        fleet = withMap(fleet, id, vehicle)
      }

      const next = { ...state, fleet }
      return {
        ok: true,
        cost,
        state: book(next, { category: 'vehicle_purchase', amount: -cost, note: `${count} × ${cls.displayName}` }),
      }
    }

    case 'sell_vehicle': {
      const vehicle = state.fleet.get(command.vehicleId)
      if (!vehicle) return fail('Unbekanntes Fahrzeug.')
      const assigned = [...state.patterns.values()].some((p) => p.vehicleIds.includes(vehicle.id))
      if (assigned) return fail('Das Fahrzeug ist noch einer Linie zugeteilt.')

      const cls = vehicleSpec(vehicle)
      const value = cls ? resaleValue(vehicle, cls.purchasePrice) : 0
      const next = { ...state, fleet: withMap(state.fleet, vehicle.id, undefined) }
      return {
        ok: true,
        cost: -value,
        state: book(next, { category: 'vehicle_purchase', amount: value, note: 'Verkauf' }),
      }
    }

    case 'create_line': {
      if (command.line.stops.length < 2) return fail('Eine Linie braucht mindestens zwei Haltestellen.')
      const missing = command.line.stops.find((s) => !state.network.stations.has(s.stationId))
      if (missing) return fail('Eine der Haltestellen existiert nicht.')

      const id = newLineId(state)
      const line: Line = { ...command.line, id }
      return { ok: true, cost: 0, state: { ...state, lines: withMap(state.lines, id, line) } }
    }

    case 'delete_line': {
      if (!state.lines.has(command.lineId)) return fail('Unbekannte Linie.')
      const patterns = new Map(state.patterns)
      for (const [pid, p] of patterns) if (p.lineId === command.lineId) patterns.delete(pid)
      return {
        ok: true,
        cost: 0,
        state: { ...state, lines: withMap(state.lines, command.lineId, undefined), patterns },
      }
    }

    case 'set_fare': {
      const line = state.lines.get(command.lineId)
      if (!line) return fail('Unbekannte Linie.')
      return {
        ok: true,
        cost: 0,
        state: { ...state, lines: withMap(state.lines, line.id, { ...line, fare: command.fare }) },
      }
    }

    case 'set_pattern': {
      const line = state.lines.get(command.pattern.lineId)
      if (!line) return fail('Unbekannte Linie.')

      const existing = [...state.patterns.values()].find((p) => p.lineId === line.id)
      const id = existing?.id ?? newPatternId(state)
      const pattern: ServicePattern = { ...command.pattern, id }
      return { ok: true, cost: 0, state: { ...state, patterns: withMap(state.patterns, id, pattern) } }
    }

    case 'assign_vehicles': {
      const pattern = state.patterns.get(command.patternId)
      if (!pattern) return fail('Unbekannter Fahrplan.')

      const unknown = command.vehicleIds.find((v) => !state.fleet.has(v))
      if (unknown) return fail('Unbekanntes Fahrzeug.')

      const takenElsewhere = command.vehicleIds.find((v) =>
        [...state.patterns.values()].some((p) => p.id !== pattern.id && p.vehicleIds.includes(v)),
      )
      if (takenElsewhere) return fail('Ein Fahrzeug ist bereits einer anderen Linie zugeteilt.')

      return {
        ok: true,
        cost: 0,
        state: {
          ...state,
          patterns: withMap(state.patterns, pattern.id, { ...pattern, vehicleIds: [...command.vehicleIds] }),
        },
      }
    }

    case 'take_loan': {
      const equity = state.cash + fleetValue(state)
      const debt = state.loans.reduce((s, l) => s + l.principal, 0)
      const limit = creditLimit(equity, debt)
      if (command.amount <= 0) return fail('Betrag muss positiv sein.')
      if (command.amount > limit) return fail(`Kreditrahmen überschritten (maximal ${Math.round(limit / 100)} €).`)

      const loan = {
        id: `loan${state.loans.length + 1}`,
        principal: command.amount,
        interestRate: interestRateFor(command.termYears),
        takenOnDay: state.day,
        termYears: command.termYears,
      }
      const next = { ...state, loans: [...state.loans, loan] }
      return { ok: true, cost: -command.amount, state: book(next, { category: 'loan', amount: command.amount }) }
    }

    case 'repay_loan': {
      const loan = state.loans.find((l) => l.id === command.loanId)
      if (!loan) return fail('Unbekannter Kredit.')
      const amount = Math.min(command.amount, loan.principal)
      if (amount <= 0) return fail('Betrag muss positiv sein.')
      if (state.cash < amount) return fail('Nicht genug Kapital.')

      const loans = state.loans
        .map((l) => (l.id === loan.id ? { ...l, principal: l.principal - amount } : l))
        .filter((l) => l.principal > 0)
      const next = { ...state, loans }
      return { ok: true, cost: amount, state: book(next, { category: 'repayment', amount: -amount }) }
    }

    default: {
      // Alle Befehle der Union sind abgedeckt. Kommt einer hinzu, schlaegt hier
      // der Typecheck fehl statt still nichts zu tun.
      const unhandled: never = command
      return fail(`Unbekannter Befehl: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** Fuhrparkwert zum Wiederverkaufspreis - Grundlage des Kreditrahmens. */
export function fleetValue(state: GameState): Money {
  let sum = 0
  for (const vehicle of state.fleet.values()) {
    const cls = vehicleSpec(vehicle)
    if (cls) sum += resaleValue(vehicle, cls.purchasePrice)
  }
  return sum
}
