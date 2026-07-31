import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_RUNTIME_RESERVE,
  cityId,
  cityRadiusKm,
  type City,
  type GameState,
  type Line,
  type StationId,
} from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDay, advanceDays } from './advance.js'
import { applyCommand } from './commands.js'
import { effectiveHeadwayMin, lineMetrics, vehiclesNeeded } from './lineMetrics.js'
import { createGame } from './state.js'

const city = (name: string, population: number, lng: number, lat: number): City => ({
  id: cityId(name),
  name,
  country: 'DE',
  centre: [lng, lat],
  population,
  radiusKm: cityRadiusKm(population),
  facilities: [],
})

// Muenchen und Augsburg in realen Koordinaten - rund 56 km Luftlinie.
const CITIES = withPotentials([
  city('Muenchen', 1_500_000, 11.575, 48.137),
  city('Augsburg', 340_000, 10.898, 48.371),
  city('Kleinstadt', 25_000, 10.5, 47.9),
])

let demand: DemandMatrix
let base: GameState

/** Baut Haltestellen in allen Staedten und kauft `buses` Ueberlandbusse. */
function setup(buses = 4): GameState {
  let state = createGame({ cities: CITIES })
  for (const c of CITIES) {
    const r = applyCommand(state, { kind: 'place_bus_stop', cityId: c.id })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }
  const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'intercity', units: buses })
  if (!bought.ok) throw new Error(bought.reason)
  return bought.state
}

function addLine(state: GameState, stopNames: string[], headwayMin = 60): GameState {
  const stops = [...state.network.stations.values()]
  const ids = stopNames.map((n) => stops.find((s) => s.name === n)!.id as StationId)

  const created = applyCommand(state, {
    kind: 'create_line',
    line: {
      name: stopNames.join(' – '),
      mode: 'bus',
      stops: ids.map((stationId) => ({ stationId, dwellSeconds: 120, serves: true })),
      path: { kind: 'road' },
      fare: DEFAULT_BUS_FARE,
      runtimeReserve: DEFAULT_RUNTIME_RESERVE,
    } satisfies Omit<Line, 'id'>,
  })
  if (!created.ok) throw new Error(created.reason)

  const line = [...created.state.lines.values()].at(-1)!
  const patterned = applyCommand(created.state, {
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: [...created.state.fleet.keys()],
      days: DAYS_ALL,
      headway: { everyMinutes: headwayMin, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  if (!patterned.ok) throw new Error(patterned.reason)
  return patterned.state
}

beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0 })
  base = setup()
})

describe('Befehle', () => {
  it('bucht den Haltestellenbau und zieht das Geld ab', () => {
    const start = createGame({ cities: CITIES })
    const r = applyCommand(start, { kind: 'place_bus_stop', cityId: CITIES[0]!.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.cash).toBe(start.cash - r.cost)
    expect(r.state.ledger).toHaveLength(1)
    expect(r.state.network.stations.size).toBe(1)
  })

  it('verhindert eine zweite Haltestelle in derselben Stadt', () => {
    const once = applyCommand(createGame({ cities: CITIES }), { kind: 'place_bus_stop', cityId: CITIES[0]!.id })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = applyCommand(once.state, { kind: 'place_bus_stop', cityId: CITIES[0]!.id })
    expect(twice.ok).toBe(false)
  })

  it('lehnt Kaeufe ohne Deckung ab', () => {
    const poor = createGame({ cities: CITIES, startingCash: 1000 })
    const r = applyCommand(poor, { kind: 'buy_vehicle', classId: 'intercity', units: 1 })
    expect(r.ok).toBe(false)
  })

  it('legt je gekauftem Bus ein eigenes Fahrzeug an', () => {
    expect(base.fleet.size).toBe(4)
    expect([...base.fleet.values()].every((v) => v.units === 1)).toBe(true)
  })

  it('verhindert, dass ein Fahrzeug zwei Linien gleichzeitig faehrt', () => {
    let state = addLine(base, ['Muenchen', 'Augsburg'])
    const second = applyCommand(state, {
      kind: 'create_line',
      line: {
        name: 'Zweite',
        mode: 'bus',
        stops: [...state.network.stations.values()].slice(0, 2).map((s) => ({
          stationId: s.id,
          dwellSeconds: 120,
          serves: true,
        })),
        path: { kind: 'road' },
        fare: DEFAULT_BUS_FARE,
        runtimeReserve: DEFAULT_RUNTIME_RESERVE,
      },
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    state = second.state

    const line2 = [...state.lines.values()].at(-1)!
    const p = applyCommand(state, {
      kind: 'set_pattern',
      pattern: {
        lineId: line2.id,
        direction: 'forward',
        vehicleIds: [],
        days: DAYS_ALL,
        headway: { everyMinutes: 60, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
      },
    })
    expect(p.ok).toBe(true)
    if (!p.ok) return

    const pattern2 = [...p.state.patterns.values()].find((x) => x.lineId === line2.id)!
    const clash = applyCommand(p.state, {
      kind: 'assign_vehicles',
      patternId: pattern2.id,
      vehicleIds: [[...p.state.fleet.keys()][0]!],
    })
    expect(clash.ok).toBe(false)
  })

  it('verweigert den Verkauf eines eingesetzten Fahrzeugs', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    const r = applyCommand(state, { kind: 'sell_vehicle', vehicleId: [...state.fleet.keys()][0]! })
    expect(r.ok).toBe(false)
  })
})

describe('Liniengeometrie', () => {
  it('rechnet Laenge und Umlaufzeit plausibel', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    const line = [...state.lines.values()][0]!
    const m = lineMetrics(state, line)!

    // 56 km Luftlinie mal Umwegfaktor 1,25.
    expect(m.lengthKm).toBeGreaterThan(65)
    expect(m.lengthKm).toBeLessThan(76)
    expect(m.roundTripSec).toBeGreaterThan(2 * m.oneWayTimeSec)
  })

  it('braucht mehr Fahrzeuge fuer dichteren Takt', () => {
    expect(vehiclesNeeded(30, 7200)).toBeGreaterThan(vehiclesNeeded(60, 7200))
  })

  it('streckt den Takt, wenn Fahrzeuge fehlen', () => {
    // Umlauf 120 Minuten, ein Fahrzeug: mehr als ein 120-Minuten-Takt geht nicht.
    expect(effectiveHeadwayMin(30, 7200, 1)).toBe(120)
    expect(effectiveHeadwayMin(30, 7200, 4)).toBe(30)
  })
})

describe('Betriebstag', () => {
  it('befoerdert Fahrgaeste und erwirtschaftet Erloes', () => {
    const state = advanceDay(addLine(base, ['Muenchen', 'Augsburg']), demand)
    const result = state.lastDay!.lines[0]!

    expect(result.totalPassengers).toBeGreaterThan(0)
    expect(result.revenue).toBeGreaterThan(0)
    expect(result.operatingCost).toBeGreaterThan(0)
    expect(result.departuresPerDirection).toBe(17)
  })

  it('verliert Fahrgaeste bei hoeherem Preis', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    const line = [...state.lines.values()][0]!

    const cheap = applyCommand(state, {
      kind: 'set_fare',
      lineId: line.id,
      fare: { ...DEFAULT_BUS_FARE, priceIndex: 0.6 },
    })
    const dear = applyCommand(state, {
      kind: 'set_fare',
      lineId: line.id,
      fare: { ...DEFAULT_BUS_FARE, priceIndex: 2.0 },
    })
    expect(cheap.ok && dear.ok).toBe(true)
    if (!cheap.ok || !dear.ok) return

    const a = advanceDay(cheap.state, demand).lastDay!.lines[0]!
    const b = advanceDay(dear.state, demand).lastDay!.lines[0]!
    expect(b.totalPassengers).toBeLessThan(a.totalPassengers)
  })

  it('meldet fehlende Fahrzeuge statt still zu scheitern', () => {
    const state = addLine(setup(1), ['Muenchen', 'Augsburg'], 20)
    const result = advanceDay(state, demand).lastDay!.lines[0]!
    expect(result.effectiveHeadwayMin).toBeGreaterThan(20)
    expect(result.warnings.join(' ')).toMatch(/fehlen/)
  })

  it('laesst Fahrgaeste stehen, wenn die Kapazitaet nicht reicht', () => {
    const state = addLine(setup(1), ['Muenchen', 'Augsburg'], 180)
    const result = advanceDay(state, demand).lastDay!.lines[0]!
    expect(result.leftBehind).toBeGreaterThan(0)
  })

  it('faehrt an Tagen ausserhalb der Verkehrstage nicht', () => {
    let state = addLine(base, ['Muenchen', 'Augsburg'])
    const pattern = [...state.patterns.values()][0]!
    const r = applyCommand(state, { kind: 'set_pattern', pattern: { ...pattern, days: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    state = advanceDay(r.state, demand)
    expect(state.lastDay!.lines[0]!.totalPassengers).toBe(0)
    expect(state.lastDay!.revenue).toBe(0)
  })

  it('findet auf einer schwachen Relation deutlich weniger Nachfrage', () => {
    const strong = advanceDay(addLine(base, ['Muenchen', 'Augsburg']), demand).lastDay!.lines[0]!
    const weak = advanceDay(addLine(base, ['Augsburg', 'Kleinstadt']), demand).lastDay!.lines[0]!
    expect(weak.totalPassengers).toBeLessThan(strong.totalPassengers)
  })
})

describe('Abrechnung', () => {
  it('fuehrt den Kontostand ausschliesslich aus dem Journal fort', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    // Nur die Buchungen des Betriebstags zaehlen. Bau und Fahrzeugkauf stehen
    // bereits im Journal und wurden schon vom Kontostand abgezogen.
    const before = state.ledger.length
    const after = advanceDay(state, demand)
    const booked = after.ledger.slice(before).reduce((s, e) => s + e.amount, 0)

    expect(after.ledger.length).toBeGreaterThan(before)
    expect(after.cash).toBe(state.cash + booked)
  })

  it('laesst Fahrzeuge altern', () => {
    const after = advanceDays(base, demand, 365)
    const condition = [...after.fleet.values()][0]!.condition
    expect(condition).toBeLessThan(1)
    expect(condition).toBeGreaterThan(0.9)
  })

  it('bucht Kredit, Zinsen und Tilgung', () => {
    const withLoan = applyCommand(base, { kind: 'take_loan', amount: 100_000_00, termYears: 10 })
    expect(withLoan.ok).toBe(true)
    if (!withLoan.ok) return
    expect(withLoan.state.cash).toBe(base.cash + 100_000_00)

    const after = advanceDay(withLoan.state, demand)
    expect(after.ledger.some((e) => e.category === 'interest')).toBe(true)

    const repaid = applyCommand(after, {
      kind: 'repay_loan',
      loanId: after.loans[0]!.id,
      amount: 100_000_00,
    })
    expect(repaid.ok).toBe(true)
    if (!repaid.ok) return
    expect(repaid.state.loans).toHaveLength(0)
  })

  it('begrenzt den Kreditrahmen', () => {
    const r = applyCommand(base, { kind: 'take_loan', amount: 999_000_000_00, termYears: 10 })
    expect(r.ok).toBe(false)
  })

  it('ist deterministisch: gleicher Zustand, gleiches Ergebnis', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    const a = advanceDays(state, demand, 14)
    const b = advanceDays(state, demand, 14)
    expect(a.cash).toBe(b.cash)
    expect(a.lastDay!.passengers).toBeCloseTo(b.lastDay!.passengers, 9)
  })

  it('unterscheidet Wochentage', () => {
    const state = addLine(base, ['Muenchen', 'Augsburg'])
    // Tag 0 ist ein Montag, Tag 5 ein Samstag.
    const monday = advanceDay(state, demand).lastDay!.passengers
    const saturday = advanceDays(state, demand, 6).lastDay!.passengers
    expect(saturday).toBeLessThan(monday)
  })
})
