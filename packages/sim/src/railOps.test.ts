import {
  DAYS_ALL,
  DEFAULT_RAIL_FARE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
  cityId,
  capacityFactor,
  cityRadiusKm,
  isAvailable,
  platformsInService,
  trainClass,
  type City,
  type GameState,
  type LngLat,
  type TrackSpec,
} from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { SERVICE_RESTORES_TO, serviceCost } from '@game/economy'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDays } from './advance.js'
import { assignPassengers, type AssignmentFlow } from './assignment.js'
import { findConflicts, headwaySeconds, isMinor, type Claim } from './blocks.js'
import { applyCommand } from './commands.js'
import { findPath } from './railGraph.js'
import { buildRuns, planLine, resolveDelays, trainsNeeded } from './railRuns.js'
import {
  BASE_FAILURE_RATE,
  DISRUPTION_MAX_SEC,
  DISRUPTION_MIN_SEC,
  disruptionSeconds,
  failureRate,
  roll,
  rollDisruptions,
} from './disruptions.js'
import { simulateRailLine } from './day.js'
import { legRunTime, timeAtKm } from './runTime.js'
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

// Muenchen, Augsburg, Ingolstadt in realen Koordinaten.
const CITIES = withPotentials([
  city('Muenchen', 1_500_000, 11.575, 48.137),
  city('Augsburg', 340_000, 10.898, 48.371),
  city('Ingolstadt', 130_000, 11.426, 48.766),
])

const SINGLE: TrackSpec = { maxSpeed: 160, electrified: true, tracks: 1, signalling: 'classic' }
const DOUBLE: TrackSpec = { maxSpeed: 200, electrified: true, tracks: 2, signalling: 'classic' }

let demand: DemandMatrix

/** Vollständige Bahnlinie mit fertiger Strecke und zugeteilten Zügen. */
function railSetup(options: {
  readonly spec?: TrackSpec
  readonly cities?: readonly string[]
  readonly trains?: number
  readonly headway?: number
  readonly trainClassId?: string
  readonly platforms?: number
}): GameState {
  const names = options.cities ?? ['Muenchen', 'Augsburg']
  const spec = options.spec ?? DOUBLE
  let state = createGame({ cities: CITIES, startingCash: 5_000_000_000_00 })

  for (const name of names) {
    const c = CITIES.find((x) => x.name === name)!
    const r = applyCommand(state, {
      kind: 'place_station',
      cityId: c.id,
      position: c.centre,
      platforms: options.platforms ?? 4,
    })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }

  const nodes = names.map((n) => [...state.network.stations.values()].find((s) => s.name === n)!.nodeId)
  for (let i = 1; i < nodes.length; i++) {
    const r = applyCommand(state, { kind: 'build_track', from: nodes[i - 1]!, to: nodes[i]!, geometry: [], spec })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }

  const bought = applyCommand(state, {
    kind: 'buy_vehicle',
    classId: options.trainClassId ?? 'emu_regional',
    units: options.trains ?? 4,
  })
  if (!bought.ok) throw new Error(bought.reason)
  state = bought.state

  const created = applyCommand(state, {
    kind: 'create_line',
    line: {
      name: names.join(' – '),
      mode: 'rail',
      stops: names.map((n) => ({
        stationId: [...state.network.stations.values()].find((s) => s.name === n)!.id,
        dwellSeconds: 60,
        serves: true,
      })),
      path: { kind: 'rail', tracks: [] },
      fare: DEFAULT_RAIL_FARE,
      runtimeReserve: DEFAULT_RUNTIME_RESERVE_RAIL,
      connectionHoldSec: 0,
    },
  })
  if (!created.ok) throw new Error(created.reason)
  state = created.state

  const line = [...state.lines.values()][0]!
  const patterned = applyCommand(state, {
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: [...state.fleet.keys()],
      days: DAYS_ALL,
      headway: { everyMinutes: options.headway ?? 60, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  if (!patterned.ok) throw new Error(patterned.reason)

  // Bauzeit ueberspringen und auf einen Dienstag stellen, damit die
  // Pendlernachfrage zaehlt und Vergleiche nicht am Wochentag scheitern.
  const ready = Math.max(...[...patterned.state.network.tracks.values()].map((t) => t.readyOnDay))
  let final = advanceDays(patterned.state, demand, Math.max(0, ready - patterned.state.day))
  while (new Date(Date.UTC(1990, 0, 1 + final.day)).getUTCDay() !== 2) final = advanceDays(final, demand, 1)
  return final
}

const lineOf = (state: GameState) => [...state.lines.values()][0]!
const run = (state: GameState) => simulateRailLine(state, demand, lineOf(state).id)!

beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0 })
})

describe('Fahrzeitrechnung', () => {
  it('beschleunigt und bremst statt sofort auf Hoechstgeschwindigkeit zu springen', () => {
    const state = railSetup({ spec: DOUBLE })
    const plan = planLine(state, lineOf(state))
    const leg = plan.legs[0]!

    expect(leg.samples[0]!.speedKmh).toBe(0)
    expect(leg.samples[leg.samples.length - 1]!.speedKmh).toBe(0)
    // Reisegeschwindigkeit liegt spuerbar unter der Hoechstgeschwindigkeit.
    const average = (leg.lengthKm / leg.runSeconds) * 3600
    expect(average).toBeLessThan(200)
    expect(average).toBeGreaterThan(90)
  })

  it('macht einen schnelleren Zug auf derselben Strecke schneller', () => {
    const slow = railSetup({ spec: DOUBLE, trainClassId: 'dmu_light' })
    const fast = railSetup({ spec: DOUBLE, trainClassId: 'hst_250' })
    expect(planLine(fast, lineOf(fast)).oneWaySeconds).toBeLessThan(planLine(slow, lineOf(slow)).oneWaySeconds)
  })

  it('begrenzt die Geschwindigkeit auf die der Strecke', () => {
    const state = railSetup({ spec: { ...DOUBLE, maxSpeed: 80 }, trainClassId: 'hst_250' })
    const leg = planLine(state, lineOf(state)).legs[0]!
    expect(Math.max(...leg.samples.map((s) => s.speedKmh))).toBeLessThanOrEqual(80.01)
  })

  it('liefert eine monoton steigende Weg-Zeit-Funktion', () => {
    const state = railSetup({})
    const leg = planLine(state, lineOf(state)).legs[0]!
    expect(timeAtKm(leg, 0)).toBe(0)
    expect(timeAtKm(leg, leg.lengthKm / 2)).toBeGreaterThan(0)
    expect(timeAtKm(leg, leg.lengthKm)).toBeCloseTo(leg.runSeconds, 3)
    expect(timeAtKm(leg, leg.lengthKm * 0.75)).toBeGreaterThan(timeAtKm(leg, leg.lengthKm * 0.25))
  })
})

describe('Wegsuche', () => {
  it('findet den Weg ueber mehrere Strecken', () => {
    const state = railSetup({ cities: ['Augsburg', 'Muenchen', 'Ingolstadt'] })
    const nodes = ['Augsburg', 'Ingolstadt'].map(
      (n) => [...state.network.stations.values()].find((s) => s.name === n)!.nodeId,
    )
    const path = findPath(state, nodes[0]!, nodes[1]!, trainClass('emu_regional'))
    expect(path?.tracks).toHaveLength(2)
  })

  it('laesst einen Elektrozug nicht auf eine Strecke ohne Fahrdraht', () => {
    const state = railSetup({ spec: { ...DOUBLE, electrified: false } })
    const plan = planLine(state, lineOf(state))
    expect(plan.legs).toHaveLength(0)
    expect(plan.problems.join(' ')).toMatch(/Fahrdraht|keine durchgehend/)
  })

  it('laesst einen Dieselzug ueberall fahren', () => {
    const state = railSetup({ spec: { ...DOUBLE, electrified: false }, trainClassId: 'dmu_regional' })
    expect(planLine(state, lineOf(state)).legs).toHaveLength(1)
  })
})

describe('Blockmodell', () => {
  it('verkuerzt die Zugfolgezeit mit besserer Signaltechnik', () => {
    const base = { lengthKm: 60, maxSpeed: 160 as const, tracks: 1 as const } as never
    const classic = headwaySeconds({ ...(base as object), signalling: 'classic' } as never, 160, 200)
    const etcs = headwaySeconds({ ...(base as object), signalling: 'etcs_l2' } as never, 160, 200)
    expect(etcs).toBeLessThan(classic)
  })

  it('meldet Gegenzuege auf eingleisiger Strecke, nicht auf zweigleisiger', () => {
    const single = run(railSetup({ spec: SINGLE }))
    const double = run(railSetup({ spec: DOUBLE }))

    expect(single.conflicts.filter((c) => !isMinor(c)).length).toBeGreaterThan(0)
    expect(single.conflicts.every((c) => c.kind !== 'block')).toBe(true)
    expect(double.conflicts.filter((c) => !isMinor(c))).toHaveLength(0)
  })

  it('erkennt zu dichte Zugfolge in derselben Richtung', () => {
    // Zwei Laeufe im selben Block zur selben Zeit.
    const claims: Claim[] = [
      { resource: 'block:x:1:0', kind: 'block', capacity: 1, from: 0, to: 300, runId: 'a' as never, label: 'B' },
      { resource: 'block:x:1:0', kind: 'block', capacity: 1, from: 100, to: 400, runId: 'b' as never, label: 'B' },
    ]
    const conflicts = findConflicts(claims)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.kind).toBe('block')
    expect(conflicts[0]!.overlapSec).toBe(200)
  })

  it('laesst Gegenzuege im selben Abschnitt nur nicht gleichzeitig zu', () => {
    const sameDirection: Claim[] = [
      { resource: 'section:x', kind: 'section', capacity: 1, from: 0, to: 300, runId: 'a' as never, direction: 1, label: 'S' },
      { resource: 'section:x', kind: 'section', capacity: 1, from: 100, to: 400, runId: 'b' as never, direction: 1, label: 'S' },
    ]
    expect(findConflicts(sameDirection)).toHaveLength(0)

    const opposing: Claim[] = [
      sameDirection[0]!,
      { ...sameDirection[1]!, direction: -1 as const },
    ]
    expect(findConflicts(opposing)).toHaveLength(1)
  })

  it('haelt Bahnsteiggleise als Kapazitaet ein', () => {
    const claims: Claim[] = [0, 1, 2].map((i) => ({
      resource: 'platform:p',
      kind: 'platform' as const,
      capacity: 2,
      from: i * 10,
      to: 600,
      runId: `r${i}` as never,
      label: 'Bahnhof',
    }))
    const conflicts = findConflicts(claims)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.kind).toBe('platform')
  })
})

describe('Betrieb und Verspätung', () => {
  it('faehrt auf zweigleisiger Strecke puenktlich', () => {
    const r = run(railSetup({ spec: DOUBLE }))
    // Nicht exakt 100 %: auch ein neuer Zug auf neuer Strecke faellt gelegentlich
    // aus. Was hier zaehlt, ist die Abwesenheit von *Fahrplan*konflikten.
    expect(r.conflicts.filter((c) => !isMinor(c))).toHaveLength(0)
    expect(r.punctuality).toBeGreaterThan(0.95)
    expect(r.averageDelaySec).toBeLessThan(120)
    expect(r.totalPassengers).toBeGreaterThan(0)
  })

  it('erzeugt auf eingleisiger Strecke Verspaetung', () => {
    const r = run(railSetup({ spec: SINGLE }))
    expect(r.averageDelaySec).toBeGreaterThan(5 * 60)
    expect(r.punctuality).toBeLessThan(0.9)
  })

  it('loest den Kreuzungskonflikt durch eine Ueberholstelle', () => {
    const before = railSetup({ spec: SINGLE })
    const withoutLoop = run(before)

    const track = [...before.network.tracks.values()][0]!
    const g = track.geometry
    const middle: LngLat = [(g[0]![0] + g[g.length - 1]![0]) / 2, (g[0]![1] + g[g.length - 1]![1]) / 2]

    const placed = applyCommand(before, {
      kind: 'place_passing_loop',
      trackId: track.id,
      position: middle,
      capacity: 2,
    })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return

    // Bauzeit der Ueberholstelle abwarten.
    const ready = Math.max(...[...placed.state.network.tracks.values()].map((t) => t.readyOnDay))
    const after = run(advanceDays(placed.state, demand, Math.max(1, ready - placed.state.day)))

    expect(after.averageDelaySec).toBeLessThan(withoutLoop.averageDelaySec / 5)
    expect(after.punctuality).toBeGreaterThan(withoutLoop.punctuality)
    expect(after.punctuality).toBeGreaterThan(0.95)
  })

  it('verschlechtert die Puenktlichkeit, wenn der Takt zu dicht wird', () => {
    const sparse = run(railSetup({ spec: SINGLE, headway: 120, trains: 4 }))
    const dense = run(railSetup({ spec: SINGLE, headway: 20, trains: 12 }))
    expect(dense.averageDelaySec).toBeGreaterThan(sparse.averageDelaySec)
  })

  it('streckt den Takt, wenn Zuege fehlen', () => {
    const r = run(railSetup({ spec: DOUBLE, headway: 15, trains: 1 }))
    expect(r.effectiveHeadwayMin).toBeGreaterThan(15)
    expect(r.warnings.join(' ')).toMatch(/fehlen/)
  })

  it('rechnet die noetige Zugzahl aus der Umlaufzeit', () => {
    expect(trainsNeeded(30, 7200)).toBe(4)
    expect(trainsNeeded(60, 7200)).toBe(2)
  })

  it('erzeugt Hin- und Rueckfahrten', () => {
    const state = railSetup({ spec: DOUBLE })
    const pattern = [...state.patterns.values()][0]!
    const runs = buildRuns(state, lineOf(state), pattern, 60)
    expect(runs.filter((r) => r.direction === 'forward').length).toBe(17)
    expect(runs.filter((r) => r.direction === 'backward').length).toBe(17)
  })
})

describe('Fahrgastzuordnung', () => {
  // Eine Fahrt in der Stunde 8 - damit ist "je Fahrt" gleich "je Stunde".
  const perDeparture = new Float64Array(24)
  perDeparture[8] = 1

  const flow = (from: number, to: number, perHourValue: number): AssignmentFlow => {
    const perHour = new Float64Array(24)
    perHour[8] = perHourValue
    return { fromIndex: from, toIndex: to, perHour, fare: 1000, segment: 'commuter', od: `${from}|${to}` }
  }

  it('leert und fuellt den Zug unterwegs: getrennte Abschnitte teilen sich keine Plaetze', () => {
    const seats = new Float64Array(24)
    seats[8] = 100

    // Zwei Gruppen auf getrennten Abschnitten einer Linie mit drei Halten.
    const result = assignPassengers({ forward: [flow(0, 1, 100), flow(1, 2, 100)], backward: [], seatsPerHour: seats, departuresPerHour: perDeparture, stopCount: 3 })
    expect(result.totalPassengers).toBeCloseTo(200, 6)
    expect(result.leftBehind).toBeCloseTo(0, 6)
  })

  it('rationiert nur den ueberlasteten Abschnitt', () => {
    const seats = new Float64Array(24)
    seats[8] = 100

    // Abschnitt 0-1 ist doppelt ueberbucht, Abschnitt 1-2 ist frei.
    const result = assignPassengers({ forward: [flow(0, 1, 200), flow(1, 2, 50)], backward: [], seatsPerHour: seats, departuresPerHour: perDeparture, stopCount: 3 })

    expect(result.linkLoadFactors[0]).toBeCloseTo(2, 6)
    expect(result.linkLoadFactors[1]).toBeCloseTo(0.5, 6)
    // Die freie Relation kommt vollstaendig mit.
    expect(result.totalPassengers).toBeCloseTo(100 + 50, 6)
    expect(result.leftBehind).toBeCloseTo(100, 6)
  })

  it('begrenzt eine durchgehende Fahrt am schlechtesten Abschnitt', () => {
    const seats = new Float64Array(24)
    seats[8] = 100

    // Die Gruppe 0-2 faehrt ueber beide Abschnitte; 0-1 ist eng.
    const result = assignPassengers({ forward: [flow(0, 1, 150), flow(0, 2, 50)], backward: [], seatsPerHour: seats, departuresPerHour: perDeparture, stopCount: 3 })
    const throughScale = 100 / 200
    expect(result.totalPassengers).toBeCloseTo(200 * throughScale, 6)
  })

  it('zaehlt Nachfrage ausserhalb der Betriebszeit als stehen geblieben, nicht als Ueberlastung', () => {
    const seats = new Float64Array(24) // ueberall 0
    const result = assignPassengers({ forward: [flow(0, 1, 40)], backward: [], seatsPerHour: seats, departuresPerHour: perDeparture, stopCount: 2 })
    expect(result.leftBehind).toBeCloseTo(40, 6)
    expect(result.peakLoadFactor).toBe(0)
  })
})

describe('Wirtschaftlichkeit', () => {
  it('bucht Streckenunterhalt und Betriebskosten', () => {
    const state = railSetup({ spec: DOUBLE })
    const after = advanceDays(state, demand, 1)

    expect(after.ledger.some((e) => e.category === 'track_upkeep')).toBe(true)
    expect(after.ledger.some((e) => e.category === 'ticket_revenue')).toBe(true)
    expect(after.lastDay!.lines[0]!.mode).toBe('rail')
  })

  it('bleibt deterministisch', () => {
    const state = railSetup({ spec: SINGLE })
    const a = advanceDays(state, demand, 5)
    const b = advanceDays(state, demand, 5)
    expect(a.cash).toBe(b.cash)
  })
})

describe('Bahnhofsausbau', () => {
  const stationOf = (state: GameState) => [...state.network.stations.values()][0]!

  const expand = (state: GameState, platforms: number) =>
    applyCommand(state, { kind: 'upgrade_station', stationId: stationOf(state).id, platforms })

  it('baut Bahnsteiggleise an und bucht die Kosten', () => {
    const before = railSetup({ spec: DOUBLE })
    const result = expand(before, 6)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(stationOf(result.state).platforms).toBe(6)
    expect(result.cost).toBeGreaterThan(0)
    expect(result.state.cash).toBe(before.cash - result.cost)
  })

  it('erhoeht den Unterhalt entsprechend', () => {
    const before = railSetup({ spec: DOUBLE })
    const result = expand(before, 6)
    if (!result.ok) throw new Error(result.reason)
    expect(stationOf(result.state).upkeepPerDay).toBeGreaterThan(stationOf(before).upkeepPerDay)
  })

  it('sperrt waehrend des Umbaus ein bestehendes Gleis', () => {
    const before = railSetup({ spec: DOUBLE })
    const started = expand(before, 8)
    if (!started.ok) throw new Error(started.reason)

    const station = stationOf(started.state)
    expect(station.platforms).toBe(8)
    // Wer erst ausbaut, wenn es eng ist, macht es zunaechst enger.
    expect(platformsInService(station, started.state.day)).toBeLessThan(platformsInService(stationOf(before), before.day))
  })

  it('gibt die Gleise nach der Bauzeit frei', () => {
    const before = railSetup({ spec: DOUBLE })
    const started = expand(before, 8)
    if (!started.ok) throw new Error(started.reason)

    const days = stationOf(started.state).construction!.finishesOnDay - started.state.day
    const after = advanceDays(started.state, demand, days)

    expect(stationOf(after).construction).toBeUndefined()
    expect(platformsInService(stationOf(after), after.day)).toBe(8)
  })

  it('verweigert einen zweiten Umbau, solange der erste laeuft', () => {
    const before = railSetup({ spec: DOUBLE })
    const started = expand(before, 6)
    if (!started.ok) throw new Error(started.reason)
    expect(expand(started.state, 8).ok).toBe(false)
  })

  it('verweigert einen Rueckbau und einen Ausbau auf die bestehende Groesse', () => {
    const state = railSetup({ spec: DOUBLE })
    expect(expand(state, 1).ok).toBe(false)
    expect(expand(state, stationOf(state).platforms).ok).toBe(false)
  })

  it('verweigert den Ausbau einer Bushaltestelle', () => {
    const state = railSetup({ spec: DOUBLE })
    const withStop = applyCommand(state, { kind: 'place_bus_stop', cityId: CITIES[2]!.id })
    if (!withStop.ok) throw new Error(withStop.reason)

    const stop = [...withStop.state.network.stations.values()].find((s) => s.mode === 'bus')!
    expect(applyCommand(withStop.state, { kind: 'upgrade_station', stationId: stop.id, platforms: 4 }).ok).toBe(false)
  })

  it('rechnet vor, waehrend und nach dem Umbau mit der richtigen Gleiszahl', () => {
    // Die Bahnsteigkapazitaet steckt in den Belegungen der Zuglaeufe - dort
    // muss sich ein Umbau zeigen, sonst ist er reine Buchhaltung.
    // Nur der umgebaute Bahnhof - der andere bleibt, wie er ist.
    const platformCapacity = (state: GameState): number => {
      const resource = `platform:${stationOf(state).id}`
      const pattern = [...state.patterns.values()][0]!
      const runs = buildRuns(state, lineOf(state), pattern, 60)
      const capacities = runs.flatMap((r) =>
        r.claims.filter((c) => c.resource === resource).map((c) => c.capacity),
      )
      return Math.min(...capacities)
    }

    const before = railSetup({ spec: DOUBLE, platforms: 4 })
    expect(platformCapacity(before)).toBe(4)

    const started = expand(before, 8)
    if (!started.ok) throw new Error(started.reason)
    // Waehrend der Bauarbeiten ist ein Gleis gesperrt.
    expect(platformCapacity(started.state)).toBe(3)

    const days = stationOf(started.state).construction!.finishesOnDay - started.state.day
    const finished = advanceDays(started.state, demand, days)
    expect(platformCapacity(finished)).toBe(8)
  })
})

describe('Störungen und Instandhaltung', () => {
  it('würfelt reproduzierbar — derselbe Spielstand ergibt denselben Tag', () => {
    // Ohne das waere ein Spielstand keine Sicherung, sondern eine Wette.
    expect(roll(1, 100, 'p1-3')).toBe(roll(1, 100, 'p1-3'))
    expect(roll(1, 100, 'p1-3')).not.toBe(roll(1, 101, 'p1-3'))
    expect(roll(1, 100, 'p1-3')).not.toBe(roll(2, 100, 'p1-3'))
  })

  it('verteilt die Würfe gleichmäßig über [0,1)', () => {
    const values = Array.from({ length: 4000 }, (_, i) => roll(7, i, 'lauf'))
    expect(Math.min(...values)).toBeLessThan(0.02)
    expect(Math.max(...values)).toBeGreaterThan(0.98)
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    expect(mean).toBeGreaterThan(0.46)
    expect(mean).toBeLessThan(0.54)
  })

  it('macht ein abgenutztes Fahrzeug deutlich störanfälliger', () => {
    const neu = failureRate({ condition: 1, trackAgeYears: 0, loadFactor: 0.5 })
    const alt = failureRate({ condition: 0.2, trackAgeYears: 0, loadFactor: 0.5 })
    expect(neu).toBeCloseTo(BASE_FAILURE_RATE, 10)
    expect(alt / neu).toBeGreaterThan(5)
  })

  it('lässt Streckenalter und Auslastung mitwirken', () => {
    const base = failureRate({ condition: 1, trackAgeYears: 0, loadFactor: 0 })
    expect(failureRate({ condition: 1, trackAgeYears: 40, loadFactor: 0 })).toBeGreaterThan(base)
    expect(failureRate({ condition: 1, trackAgeYears: 0, loadFactor: 1.5 })).toBeGreaterThan(base)
  })

  it('macht kurze Störungen häufig und lange selten', () => {
    expect(disruptionSeconds(0)).toBe(DISRUPTION_MIN_SEC)
    expect(disruptionSeconds(1)).toBe(DISRUPTION_MAX_SEC)
    // Bei der Haelfte des Wurfs erst ein Viertel der Spanne.
    expect(disruptionSeconds(0.5)).toBeLessThan((DISRUPTION_MIN_SEC + DISRUPTION_MAX_SEC) / 2)
  })

  it('trifft eine heruntergewirtschaftete Linie über ein Jahr deutlich öfter', () => {
    const runIds = Array.from({ length: 34 }, (_, i) => `p1-${i}`)
    const count = (condition: number): number => {
      let total = 0
      for (let day = 0; day < 365; day++) {
        total += rollDisruptions({
          seed: 1,
          day,
          runIds,
          vehicle: { condition } as never,
          trackAgeYears: 5,
          loadFactor: 0.7,
        }).length
      }
      return total
    }
    const gepflegt = count(0.95)
    const verwahrlost = count(0.15)
    expect(verwahrlost).toBeGreaterThan(gepflegt * 4)
  })

  it('setzt eine Störung als Standzeit in die Belegung, nicht als Zufallszahl aufs Ergebnis', () => {
    // Nachweis, dass die Stoerung durch dieselbe Ereignisschleife laeuft wie ein
    // zu dichter Takt: der betroffene Zug haelt an, und die Folgenden warten.
    const state = railSetup({ spec: DOUBLE })
    const pattern = [...state.patterns.values()][0]!
    const runs = buildRuns(state, lineOf(state), pattern, 60)
    const legs = planLine(state, lineOf(state)).legs.map((l) => l.runSeconds)

    const ohne = resolveDelays(runs, legs, 1.07)
    const mit = resolveDelays(runs, legs, 1.07, new Map([[runs[0]!.id, { atClaim: 2, seconds: 20 * 60 }]]))

    expect(mit.averageDelaySec).toBeGreaterThan(ohne.averageDelaySec)
    expect(mit.punctuality).toBeLessThan(ohne.punctuality)
  })

  it('stellt ein Fahrzeug durch eine Hauptuntersuchung wieder her', () => {
    const state = railSetup({ spec: DOUBLE })
    const id = [...state.fleet.keys()][0]!
    const worn: GameState = {
      ...state,
      fleet: new Map([...state.fleet].map(([k, v]) => [k, k === id ? { ...v, condition: 0.3 } : v])),
    }

    const result = applyCommand(worn, { kind: 'service_vehicle', vehicleId: id })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.fleet.get(id)!.condition).toBe(SERVICE_RESTORES_TO)
    expect(result.cost).toBeGreaterThan(0)
    expect(result.state.cash).toBe(worn.cash - result.cost)
  })

  it('macht die Hauptuntersuchung teurer, je mehr aufzuholen ist', () => {
    const cls = trainClass('emu_regional')!
    const leicht = serviceCost({ condition: 0.85, units: 1 } as never, cls.purchasePrice)
    const schwer = serviceCost({ condition: 0.15, units: 1 } as never, cls.purchasePrice)
    expect(schwer).toBeGreaterThan(leicht * 3)
  })

  it('verweigert die Hauptuntersuchung an einem guten Fahrzeug', () => {
    const state = railSetup({ spec: DOUBLE })
    const id = [...state.fleet.keys()][0]!
    expect(applyCommand(state, { kind: 'service_vehicle', vehicleId: id }).ok).toBe(false)
  })

  it('setzt das Streckenalter durch eine Erneuerung zurück', () => {
    let state = railSetup({ spec: DOUBLE })
    state = advanceDays(state, demand, 400)
    const track = [...state.network.tracks.values()][0]!
    const ageBefore = state.day - track.builtOnDay
    expect(ageBefore).toBeGreaterThan(365)

    const result = applyCommand(state, { kind: 'renew_track', trackId: track.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const renewed = result.state.network.tracks.get(track.id)!
    expect(renewed.construction).toBeDefined()

    const after = advanceDays(result.state, demand, renewed.construction!.finishesOnDay - result.state.day)
    const fresh = after.network.tracks.get(track.id)!
    expect(after.day - fresh.builtOnDay).toBeLessThanOrEqual(1)
    expect(fresh.construction).toBeUndefined()
  })

  it('drosselt die Strecke während der Erneuerung', () => {
    const state = railSetup({ spec: DOUBLE })
    const track = [...state.network.tracks.values()][0]!
    const result = applyCommand(state, { kind: 'renew_track', trackId: track.id })
    if (!result.ok) throw new Error(result.reason)
    expect(capacityFactor(result.state.network.tracks.get(track.id)!, result.state.day)).toBeLessThan(1)
  })
})

describe('Ersatzfahrzeuge', () => {
  const patternOf = (state: GameState) => [...state.patterns.values()][0]!

  it('nimmt ein Fahrzeug für die Dauer der Hauptuntersuchung aus dem Umlauf', () => {
    const state = railSetup({ spec: DOUBLE })
    const id = [...state.fleet.keys()][0]!
    const worn: GameState = {
      ...state,
      fleet: new Map([...state.fleet].map(([k, v]) => [k, k === id ? { ...v, condition: 0.3 } : v])),
    }

    const result = applyCommand(worn, { kind: 'service_vehicle', vehicleId: id })
    if (!result.ok) throw new Error(result.reason)

    const vehicle = result.state.fleet.get(id)!
    expect(vehicle.inWorkshopUntil).toBeGreaterThan(result.state.day)
    expect(isAvailable(vehicle, result.state.day)).toBe(false)
  })

  it('lässt die Linie mit einem Fahrzeug weniger dünner takten', () => {
    // Takt und Zugzahl so gewaehlt, dass die Zugzahl tatsaechlich bindet -
    // sonst faengt die Reserve im Umlauf den Ausfall unbemerkt ab.
    const state = railSetup({ spec: DOUBLE, headway: 15, trains: 5 })
    const before = run(state)

    const id = patternOf(state).vehicleIds[0]!
    const inWorkshop: GameState = {
      ...state,
      fleet: new Map(
        [...state.fleet].map(([k, v]) => [k, k === id ? { ...v, inWorkshopUntil: state.day + 60 } : v]),
      ),
    }
    const after = run(inWorkshop)

    expect(after.effectiveHeadwayMin).toBeGreaterThan(before.effectiveHeadwayMin)
    expect(after.departuresPerDirection).toBeLessThan(before.departuresPerDirection)
    expect(after.warnings.join(' ')).toMatch(/im Werk/)
  })

  it('stellt den Takt mit einem Ersatzfahrzeug wieder her', () => {
    let state = railSetup({ spec: DOUBLE, headway: 15, trains: 5 })
    const before = run(state)

    // Ein sechster Zug als Reserve, nicht zugeteilt.
    const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'emu_regional', units: 1 })
    if (!bought.ok) throw new Error(bought.reason)
    state = bought.state

    const pattern = patternOf(state)
    const outgoing = pattern.vehicleIds[0]!
    const spare = [...state.fleet.keys()].find((id) => !pattern.vehicleIds.includes(id))!

    const away: GameState = {
      ...state,
      fleet: new Map(
        [...state.fleet].map(([k, v]) => [k, k === outgoing ? { ...v, inWorkshopUntil: state.day + 60 } : v]),
      ),
    }
    expect(run(away).departuresPerDirection).toBeLessThan(before.departuresPerDirection)

    const swapped = applyCommand(away, {
      kind: 'replace_vehicle',
      patternId: pattern.id,
      outgoing,
      incoming: spare,
    })
    if (!swapped.ok) throw new Error(swapped.reason)

    expect(run(swapped.state).departuresPerDirection).toBe(before.departuresPerDirection)
  })

  it('setzt das Ersatzfahrzeug an dieselbe Stelle des Umlaufs', () => {
    let state = railSetup({ spec: DOUBLE, trains: 3 })
    const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'hst_250', units: 1 })
    if (!bought.ok) throw new Error(bought.reason)
    state = bought.state

    const pattern = patternOf(state)
    const outgoing = pattern.vehicleIds[1]!
    const spare = [...state.fleet.keys()].find((id) => !pattern.vehicleIds.includes(id))!

    const result = applyCommand(state, { kind: 'replace_vehicle', patternId: pattern.id, outgoing, incoming: spare })
    if (!result.ok) throw new Error(result.reason)

    // Die Reihenfolge zaehlt: das erste verfuegbare Fahrzeug bestimmt die
    // Zugklasse und damit Fahrzeit und Sitzplaetze der ganzen Linie.
    expect(patternOf(result.state).vehicleIds[1]).toBe(spare)
    expect(patternOf(result.state).vehicleIds).toHaveLength(pattern.vehicleIds.length)
  })

  it('nimmt den Ersatzzug als Klassenvorgabe, wenn der Stammzug im Werk steht', () => {
    let state = railSetup({ spec: DOUBLE, trains: 1, trainClassId: 'dmu_light' })
    const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'hst_250', units: 1 })
    if (!bought.ok) throw new Error(bought.reason)
    state = bought.state

    const pattern = patternOf(state)
    const stamm = pattern.vehicleIds[0]!
    const spare = [...state.fleet.keys()].find((id) => !pattern.vehicleIds.includes(id))!

    const assigned = applyCommand(state, {
      kind: 'assign_vehicles',
      patternId: pattern.id,
      vehicleIds: [stamm, spare],
    })
    if (!assigned.ok) throw new Error(assigned.reason)

    const langsam = planLine(assigned.state, lineOf(assigned.state)).oneWaySeconds

    const away: GameState = {
      ...assigned.state,
      fleet: new Map(
        [...assigned.state.fleet].map(([k, v]) => [
          k,
          k === stamm ? { ...v, inWorkshopUntil: assigned.state.day + 60 } : v,
        ]),
      ),
    }
    expect(planLine(away, lineOf(away)).oneWaySeconds).toBeLessThan(langsam)
  })

  it('verweigert einen Tausch gegen ein belegtes oder artfremdes Fahrzeug', () => {
    const state = railSetup({ spec: DOUBLE, cities: ['Muenchen', 'Augsburg'], trains: 2 })
    const pattern = patternOf(state)
    const [a, b] = pattern.vehicleIds as [typeof pattern.vehicleIds[number], typeof pattern.vehicleIds[number]]

    // Schon auf derselben Linie.
    expect(applyCommand(state, { kind: 'replace_vehicle', patternId: pattern.id, outgoing: a, incoming: b }).ok).toBe(
      false,
    )
    // Und ein Fahrzeug, das gar nicht auf der Linie faehrt, laesst sich nicht ersetzen.
    const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'emu_regional', units: 1 })
    if (!bought.ok) throw new Error(bought.reason)
    const spare = [...bought.state.fleet.keys()].find((id) => !pattern.vehicleIds.includes(id))!
    expect(
      applyCommand(bought.state, {
        kind: 'replace_vehicle',
        patternId: pattern.id,
        outgoing: spare,
        incoming: spare,
      }).ok,
    ).toBe(false)
  })

  it('lässt ein Fahrzeug im Werk nicht altern', () => {
    const state = railSetup({ spec: DOUBLE })
    const id = [...state.fleet.keys()][0]!
    const away: GameState = {
      ...state,
      fleet: new Map(
        [...state.fleet].map(([k, v]) => [k, k === id ? { ...v, inWorkshopUntil: state.day + 30 } : v]),
      ),
    }
    const before = away.fleet.get(id)!.condition
    const after = advanceDays(away, demand, 10)
    expect(after.fleet.get(id)!.condition).toBe(before)
  })

  it('gibt das Fahrzeug nach der Werkstattzeit wieder frei', () => {
    const state = railSetup({ spec: DOUBLE })
    const id = [...state.fleet.keys()][0]!
    const away: GameState = {
      ...state,
      fleet: new Map(
        [...state.fleet].map(([k, v]) => [k, k === id ? { ...v, inWorkshopUntil: state.day + 5 } : v]),
      ),
    }
    const after = advanceDays(away, demand, 5)
    expect(after.fleet.get(id)!.inWorkshopUntil).toBeUndefined()
    expect(isAvailable(after.fleet.get(id)!, after.day)).toBe(true)
  })
})
