import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  cityId,
  cityRadiusKm,
  formatDate,
  type City,
  type GameState,
} from '@game/domain'
import { buildDemandMatrix, odKey, withPotentials, type DemandMatrix } from '@game/demand'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDays } from './advance.js'
import { applyCommand } from './commands.js'
import { SAVE_VERSION, SaveError, makeSave, readSave, serialiseState } from './save.js'
import { createGame } from './state.js'

/**
 * Spielstände sind die eine Stelle, an der ein Fehler nicht auffällt und
 * trotzdem alles kostet: eine vergessene `Map` wird beim Speichern klaglos zu
 * `{}`, und bemerkt wird es erst, wenn jemand einen Stand von gestern lädt.
 * Deshalb wird hier nicht die Umwandlung geprüft, sondern das Spiel *nach* dem
 * Laden — es muss sich verhalten wie vorher.
 */

const city = (name: string, population: number, lng: number, lat: number): City => ({
  id: cityId(name),
  name,
  country: 'DE',
  centre: [lng, lat],
  population,
  radiusKm: cityRadiusKm(population),
  facilities: [],
})

const CITIES = withPotentials([
  city('Alt', 400_000, 11.0, 48.2),
  city('Neu', 1_100_000, 11.6, 48.1),
])

let demand: DemandMatrix
beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0.01 })
})

/** Ein Spielstand mit Haltestellen, Bussen, Linie, Fahrplan und Historie. */
function played(days = 40): GameState {
  let state = createGame({ cities: CITIES, startingCash: 50_000_000_00 })
  const apply = (command: Parameters<typeof applyCommand>[1]): void => {
    const result = applyCommand(state, command)
    if (!result.ok) throw new Error(result.reason)
    state = result.state
  }

  for (const c of CITIES) apply({ kind: 'place_bus_stop', cityId: c.id })
  apply({ kind: 'buy_vehicle', classId: 'intercity', units: 3 })
  apply({
    kind: 'create_line',
    line: {
      name: 'Alt – Neu',
      mode: 'bus',
      stops: [...state.network.stations.values()].map((s) => ({
        stationId: s.id,
        dwellSeconds: 120,
        serves: true,
      })),
      path: { kind: 'road' },
      fare: DEFAULT_BUS_FARE,
      runtimeReserve: 1.07,
    },
  })
  const line = [...state.lines.values()][0]!
  apply({
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: [...state.fleet.keys()],
      days: DAYS_ALL,
      headway: { everyMinutes: 120, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  apply({ kind: 'take_loan', amount: 1_000_000_00, termYears: 10 })

  return advanceDays(state, demand, days)
}

const roundTrip = (state: GameState): GameState =>
  readSave(JSON.parse(JSON.stringify(makeSave(state, 'Test', '1990-02-10T00:00:00.000Z'))))

describe('Spielstände', () => {
  it('führt das Spiel nach dem Laden identisch fort', () => {
    // Der eigentliche Test: nicht ob die Felder gleich aussehen, sondern ob das
    // Spiel dasselbe tut. Ein fehlendes Feld faellt sonst erst Wochen spaeter auf.
    const before = played()
    const after = roundTrip(before)

    const next = (s: GameState): GameState => advanceDays(s, demand, 7)
    const a = next(before).history.slice(-7)
    const b = next(after).history.slice(-7)

    expect(b.map((d) => Math.round(d.passengers))).toEqual(a.map((d) => Math.round(d.passengers)))
    expect(b.map((d) => d.profit)).toEqual(a.map((d) => d.profit))
    expect(next(after).cash).toBe(next(before).cash)
  })

  it('behält Netz, Fuhrpark, Linien und Fahrpläne', () => {
    const before = played()
    const after = roundTrip(before)

    expect(after.network.stations.size).toBe(before.network.stations.size)
    expect(after.network.nodes.size).toBe(before.network.nodes.size)
    expect(after.fleet.size).toBe(before.fleet.size)
    expect(after.lines.size).toBe(before.lines.size)
    expect(after.patterns.size).toBe(before.patterns.size)
    expect([...after.patterns.values()][0]!.vehicleIds).toEqual([...before.patterns.values()][0]!.vehicleIds)
  })

  it('behält Kasse, Kredite und Journal', () => {
    const before = played()
    const after = roundTrip(before)

    expect(after.cash).toBe(before.cash)
    expect(after.loans).toEqual(before.loans)
    expect(after.ledger.length).toBe(before.ledger.length)
  })

  it('behält die Zufriedenheit — sie ist Monate an Spielzeit wert', () => {
    const before = played(60)
    const key = odKey(CITIES[0]!.id, CITIES[1]!.id)
    expect(before.satisfaction.get(key)).toBeDefined()

    const after = roundTrip(before)
    expect(after.satisfaction.get(key)).toBe(before.satisfaction.get(key))
    expect(after.satisfaction.size).toBe(before.satisfaction.size)
  })

  it('behält den Andrang, aus dem die Haltezeiten von morgen kommen', () => {
    const before = played()
    const after = roundTrip(before)
    expect([...after.crowding.entries()]).toEqual([...before.crowding.entries()])
  })

  it('rechnet die Potenziale neu, statt sie mitzuschleppen', () => {
    const before = played(1)
    const serialised = serialiseState(before)

    expect(serialised.cities.every((c) => c.potential === undefined)).toBe(true)
    // Nach dem Laden sind sie wieder da - sonst faende die Nachfrage nichts vor.
    const after = roundTrip(before)
    expect([...after.cities.values()][0]!.potential).toBeDefined()
  })

  it('weist einen Spielstand aus einer neueren Fassung zurück', () => {
    const save = makeSave(played(1), 'Zukunft', '1990-01-01T00:00:00.000Z')
    expect(() => readSave({ ...save, version: SAVE_VERSION + 1 })).toThrow(SaveError)
  })

  it('weist an, was kein Spielstand ist', () => {
    expect(() => readSave(null)).toThrow(SaveError)
    expect(() => readSave({ hallo: 'welt' })).toThrow(SaveError)
    expect(() => readSave({ version: 1 })).toThrow(SaveError)
  })

  it('bleibt in einer Größenordnung, die sich speichern lässt', () => {
    // Ein Jahr Spielzeit mit zwei Linien. Waechst das hier auf zweistellige
    // Megabyte, muss die Historie beim Speichern gekuerzt werden.
    const bytes = JSON.stringify(makeSave(played(365), 'Jahr', '1991-01-01T00:00:00.000Z')).length
    expect(bytes).toBeLessThan(4_000_000)
  })

  it('trägt Beschriftung und Zeitstempel mit', () => {
    const state = played(1)
    const save = makeSave(state, formatDate(state.day), '1990-02-10T09:30:00.000Z')
    expect(save.label).toBe(formatDate(state.day))
    expect(save.savedAt).toBe('1990-02-10T09:30:00.000Z')
    expect(save.version).toBe(SAVE_VERSION)
  })
})
