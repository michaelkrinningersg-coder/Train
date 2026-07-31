import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  SCENARIOS,
  cityId,
  cityRadiusKm,
  scenarioById,
  type City,
  type GameState,
  type Scenario,
} from '@game/domain'
import { readFileSync } from 'node:fs'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDays } from './advance.js'
import { applyCommand } from './commands.js'
import { INSOLVENCY_CASH, reachableCities, scenarioStatus } from './scenario.js'
import { makeSave, readSave } from './save.js'
import { createGame } from './state.js'

/**
 * Auftraege sind der Grund, ueberhaupt zu spielen - und die eine Stelle, an der
 * ein Fehler nicht auffaellt, sondern nur enttaeuscht: ein Ziel, das sich nicht
 * erfuellen laesst, oder eines, das schon zu Beginn erfuellt ist.
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
  city('Anfang', 300_000, 10.9, 48.35),
  city('Mitte', 1_200_000, 11.6, 48.14),
  city('Ende', 200_000, 12.1, 47.85),
  city('Abseits', 80_000, 9.2, 49.4),
])

const id = (name: string): (typeof CITIES)[number]['id'] => CITIES.find((c) => c.name === name)!.id

let demand: DemandMatrix
beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0.01 })
})

const TEST_SCENARIO: Scenario = {
  id: 'test',
  title: 'Test',
  summary: '',
  briefing: '',
  startingCash: 5_000_000_00,
  deadlineDays: 100,
  goals: [
    { kind: 'stations', count: 2 },
    { kind: 'lines', count: 1 },
    { kind: 'daily_passengers', count: 50 },
  ],
}

/** Legt eine Buslinie ueber die genannten Staedte. */
function withLine(state: GameState, names: readonly string[], buses = 3): GameState {
  let next = state
  const apply = (command: Parameters<typeof applyCommand>[1]): void => {
    const r = applyCommand(next, command)
    if (!r.ok) throw new Error(r.reason)
    next = r.state
  }

  const before = new Set(next.fleet.keys())
  for (const n of names) {
    if (![...next.network.stations.values()].some((s) => s.name === n)) {
      apply({ kind: 'place_bus_stop', cityId: id(n) })
    }
  }
  apply({ kind: 'buy_vehicle', classId: 'intercity', units: buses })
  const fresh = [...next.fleet.values()].filter((v) => !before.has(v.id)).map((v) => v.id)

  apply({
    kind: 'create_line',
    line: {
      name: names.join('–'),
      mode: 'bus',
      stops: names.map((n) => ({
        stationId: [...next.network.stations.values()].find((s) => s.name === n)!.id,
        dwellSeconds: 120,
        serves: true,
      })),
      path: { kind: 'road' },
      fare: DEFAULT_BUS_FARE,
      runtimeReserve: 1.07,
      connectionHoldSec: 0,
    },
  })
  const line = [...next.lines.values()].at(-1)!
  apply({
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: fresh,
      days: DAYS_ALL,
      headway: { everyMinutes: 30, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  return next
}

const fresh = (): GameState => createGame({ cities: CITIES, startingCash: 5_000_000_00, scenarioId: 'test' })

describe('Aufträge', () => {
  it('beginnt mit offenen Zielen und laufender Frist', () => {
    const status = scenarioStatus(fresh(), TEST_SCENARIO)
    expect(status.outcome).toBe('running')
    expect(status.goals.every((g) => !g.done)).toBe(true)
    expect(status.daysLeft).toBe(100)
  })

  it('liest den Fortschritt aus dem Zustand statt ihn mitzuschreiben', () => {
    // Genau das macht einen geladenen Spielstand richtig: die Ziele sind
    // Fragen an den Zustand, keine gebuchten Zaehler.
    const state = advanceDays(withLine(fresh(), ['Anfang', 'Mitte']), demand, 5)
    const status = scenarioStatus(state, TEST_SCENARIO)

    expect(status.goals[0]!.done).toBe(true)
    expect(status.goals[1]!.done).toBe(true)
    expect(status.goals[2]!.value).toBeGreaterThan(0)
  })

  it('gilt erst als erfüllt, wenn alle Ziele zugleich stehen', () => {
    // Ein Netz, das die Fahrgastzahl nur erreicht, indem es ein anderes Ziel
    // opfert, hat den Auftrag nicht erfuellt, sondern Teile davon nacheinander.
    const partial: Scenario = {
      ...TEST_SCENARIO,
      goals: [{ kind: 'stations', count: 2 }, { kind: 'cash', amount: 999_999_999_00 }],
    }
    const state = withLine(fresh(), ['Anfang', 'Mitte'])
    expect(scenarioStatus(state, partial).outcome).toBe('running')
  })

  it('erklärt den Auftrag für erfüllt, sobald alle Ziele stehen', () => {
    const easy: Scenario = { ...TEST_SCENARIO, goals: [{ kind: 'stations', count: 2 }] }
    const state = withLine(fresh(), ['Anfang', 'Mitte'])
    const status = scenarioStatus(state, easy)
    expect(status.outcome).toBe('won')
    expect(status.reason).toContain('erfüllt')
  })

  it('verliert mit Ablauf der Frist', () => {
    const state = advanceDays(fresh(), demand, TEST_SCENARIO.deadlineDays)
    const status = scenarioStatus(state, TEST_SCENARIO)
    expect(status.outcome).toBe('lost')
    expect(status.reason).toContain('Frist')
  })

  it('verliert bei Zahlungsunfähigkeit, aber nicht schon im Minus', () => {
    const broke: GameState = { ...fresh(), cash: INSOLVENCY_CASH - 1 }
    expect(scenarioStatus(broke, TEST_SCENARIO).outcome).toBe('lost')

    // Ein Konto im Minus ist eine Entscheidung, kein Spielende.
    const overdrawn: GameState = { ...fresh(), cash: -100_000_00 }
    expect(scenarioStatus(overdrawn, TEST_SCENARIO).outcome).toBe('running')
  })

  it('zählt eine erreichte Frist nicht als Niederlage, wenn die Ziele stehen', () => {
    const easy: Scenario = { ...TEST_SCENARIO, deadlineDays: 1, goals: [{ kind: 'stations', count: 2 }] }
    const state = advanceDays(withLine(fresh(), ['Anfang', 'Mitte']), demand, 10)
    expect(scenarioStatus(state, easy).outcome).toBe('won')
  })
})

describe('Erreichbarkeit', () => {
  it('verbindet zwei Städte einer Linie ohne Umstieg', () => {
    const state = withLine(fresh(), ['Anfang', 'Mitte'])
    expect(reachableCities(state, id('Anfang'), 0).has(id('Mitte'))).toBe(true)
    expect(reachableCities(state, id('Anfang'), 0).has(id('Ende'))).toBe(false)
  })

  it('braucht für zwei Linien einen Umstieg', () => {
    const state = withLine(withLine(fresh(), ['Anfang', 'Mitte']), ['Mitte', 'Ende'])
    expect(reachableCities(state, id('Anfang'), 0).has(id('Ende'))).toBe(false)
    expect(reachableCities(state, id('Anfang'), 1).has(id('Ende'))).toBe(true)
  })

  it('erreicht eine unbediente Stadt gar nicht', () => {
    const state = withLine(fresh(), ['Anfang', 'Mitte'])
    expect(reachableCities(state, id('Anfang'), 2).has(id('Abseits'))).toBe(false)
  })

  it('fragt nur nach Erreichbarkeit, nicht nach Attraktivität', () => {
    // Bewusst nicht ueber die Reisekettensuche: die verwirft Wege, die im
    // Nutzenmodell durchfallen. Ein Ziel, das sich still aendert, weil ein
    // Umweg knapp zu teuer ist, waere nicht nachvollziehbar.
    const state = withLine(withLine(fresh(), ['Anfang', 'Abseits']), ['Abseits', 'Ende'])
    expect(reachableCities(state, id('Anfang'), 1).has(id('Ende'))).toBe(true)
  })
})

describe('Auftrag im Spielstand', () => {
  it('trägt den Auftrag durch Speichern und Laden', () => {
    const state = withLine(fresh(), ['Anfang', 'Mitte'])
    const loaded = readSave(makeSave(state, 'Test', '1990-01-01T00:00:00.000Z'))
    expect(loaded.scenarioId).toBe('test')
    expect(scenarioStatus(loaded, TEST_SCENARIO).goals[0]!.done).toBe(true)
  })

  it('hebt einen Spielstand ohne Auftrag ins freie Spiel', () => {
    const save = makeSave(fresh(), 'Alt', '1990-01-01T00:00:00.000Z')
    const { scenarioId: _gone, ...older } = save.state
    const loaded = readSave({ ...save, version: 2, state: older })
    expect(loaded.scenarioId).toBe('free')
  })
})

describe('Die ausgelieferten Aufträge', () => {
  it('haben eindeutige Kennungen und mindestens ein Ziel', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of SCENARIOS) {
      expect(scenario.goals.length).toBeGreaterThan(0)
      expect(scenario.startingCash).toBeGreaterThan(0)
      expect(scenarioById(scenario.id)).toBe(scenario)
    }
  })

  it('nennen nur Städte, die es im Datensatz auch gibt', () => {
    // Ein Ziel auf eine Stadt, die nicht existiert, waere unerfuellbar - und es
    // faellt erst auf, wenn jemand den Auftrag zu Ende spielt.
    const germany = new Set(
      (JSON.parse(readFileSync('../../data/seed/cities.germany.json', 'utf8')) as { cities: City[] }).cities.map(
        (c) => c.name,
      ),
    )
    for (const scenario of SCENARIOS) {
      for (const goal of scenario.goals) {
        if (goal.kind !== 'connect') continue
        expect(germany, `${scenario.id}: ${goal.from}`).toContain(goal.from)
        expect(germany, `${scenario.id}: ${goal.to}`).toContain(goal.to)
      }
    }
  })
})
