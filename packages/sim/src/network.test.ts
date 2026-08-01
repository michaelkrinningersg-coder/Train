import {
  BUS_DWELL_SEC,
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_RAIL_FARE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
  MAX_EXTRA_DWELL_SEC,
  RAIL_DWELL_SEC,
  cityId,
  cityRadiusKm,
  dwellWithCrowding,
  type City,
  type CityId,
  type GameState,
  type Line,
  type LineId,
  type StationId,
} from '@game/domain'
import { buildDemandMatrix, generalisedCost, odKey, withPotentials, type DemandMatrix } from '@game/demand'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDays } from './advance.js'
import { applyCommand } from './commands.js'
import {
  MIN_INTERCHANGE_SEC,
  applyConnectionHolding,
  connectionQuality,
  lineConnections,
} from './connections.js'
import { expectedHoldSec, missProbability } from './holding.js'
import { settleChains, simulateDay } from './day.js'
import { assignDemand } from './demandAssignment.js'
import {
  buildItineraries,
  buildOptions,
  itineraryAlternative,
  MAX_ITINERARIES_PER_OD,
  MAX_TRANSFERS,
  type Itinerary,
} from './itineraries.js'
import { arrivalAt, departureAt, prepareLines, type LineOffer } from './offers.js'
import {
  observedQuality,
  satisfactionOffset,
  updateSatisfaction,
  SATISFACTION_DROP_RATE,
  SATISFACTION_RECOVERY_RATE,
} from './satisfaction.js'
import { createGame } from './state.js'

/**
 * Netzwirkungen: Umsteigen zwischen eigenen Linien und die Folgen von
 * Ueberlastung. Beides sind Eigenschaften des *Netzes*, nicht einer Linie -
 * deshalb eine eigene Testdatei neben `railOps.test.ts`.
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

// Drei Staedte auf einer Linie: Zubringerstadt - Umsteigestadt - Ziel.
// Die Abstaende sind so gewaehlt, dass alle drei Relationen Nachfrage haben.
const FEEDER = 'Feldstadt'
const HUB = 'Kreuzstadt'
const TARGET = 'Grossstadt'
// Vierte Stadt hinter dem Ziel: Feldstadt -> Weitendorf braucht zwei Umstiege.
const FAR = 'Weitendorf'

const CITIES = withPotentials([
  city(FEEDER, 40_000, 10.4, 48.2),
  city(HUB, 300_000, 10.9, 48.35),
  city(TARGET, 1_200_000, 11.6, 48.14),
  city(FAR, 90_000, 12.1, 47.85),
])

const id = (name: string): CityId => CITIES.find((c) => c.name === name)!.id

let demand: DemandMatrix
beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0.01 })
})

interface BuildOptions {
  readonly feeder?: boolean
  readonly trunkAsRail?: boolean
  readonly busHeadway?: number
  readonly railHeadway?: number
  readonly buses?: number
  readonly trains?: number
  /** Eine zweite, gleichwertige Buslinie auf dem Hauptkorridor. */
  readonly duplicateTrunk?: boolean
  /** Anschlusslinie hinter dem Ziel — erzwingt eine Kette mit zwei Umstiegen. */
  readonly tail?: boolean
}

/** Baut ein kleines Netz und stellt es auf einen Dienstag mit fertiger Strecke. */
function network(options: BuildOptions = {}): GameState {
  const trunkAsRail = options.trunkAsRail ?? true
  let state = createGame({ cities: CITIES, startingCash: 5_000_000_000_00 })

  const apply = (command: Parameters<typeof applyCommand>[1]): void => {
    const result = applyCommand(state, command)
    if (!result.ok) throw new Error(result.reason)
    state = result.state
  }

  const stationOf = (name: string, mode: 'rail' | 'bus'): StationId =>
    [...state.network.stations.values()].find((s) => s.name === name && s.mode === mode)!.id

  // Hauptkorridor Kreuzstadt - Grossstadt.
  if (trunkAsRail) {
    for (const name of [HUB, TARGET]) {
      const c = CITIES.find((x) => x.name === name)!
      apply({ kind: 'place_station', cityId: c.id, position: c.centre, platforms: 4 })
    }
    const nodeOf = (name: string) => [...state.network.stations.values()].find((s) => s.name === name)!.nodeId
    apply({
      kind: 'build_track',
      from: nodeOf(HUB),
      to: nodeOf(TARGET),
      geometry: [],
      spec: { maxSpeed: 160, electrified: true, tracks: 2, signalling: 'classic' },
    })
    apply({ kind: 'buy_vehicle', classId: 'emu_regional', units: options.trains ?? 6 })
  } else {
    for (const name of [HUB, TARGET]) apply({ kind: 'place_bus_stop', cityId: id(name) })
    apply({ kind: 'buy_vehicle', classId: 'intercity', units: options.buses ?? 6 })
  }

  if (options.feeder) {
    apply({ kind: 'place_bus_stop', cityId: id(FEEDER) })
    // Eigene Bushaltestelle in der Umsteigestadt - im Datenmodell ein anderes
    // Objekt als der Bahnhof, und genau darum geht es beim Umsteigen.
    if (trunkAsRail) apply({ kind: 'place_bus_stop', cityId: id(HUB) })
    apply({ kind: 'buy_vehicle', classId: 'intercity', units: options.buses ?? 4 })
  }
  if (options.duplicateTrunk) {
    apply({ kind: 'buy_vehicle', classId: 'intercity', units: options.buses ?? 6 })
  }
  if (options.tail) {
    apply({ kind: 'place_bus_stop', cityId: id(FAR) })
    if (trunkAsRail) apply({ kind: 'place_bus_stop', cityId: id(TARGET) })
    apply({ kind: 'buy_vehicle', classId: 'intercity', units: options.buses ?? 4 })
  }

  const makeLine = (
    name: string,
    mode: 'bus' | 'rail',
    stops: readonly { name: string; mode: 'rail' | 'bus' }[],
  ): void => {
    apply({
      kind: 'create_line',
      line: {
        name,
        mode,
        stops: stops.map((s) => ({ stationId: stationOf(s.name, s.mode), dwellSeconds: 60, serves: true })),
        path: mode === 'rail' ? { kind: 'rail', tracks: [] } : { kind: 'road' },
        fare: mode === 'rail' ? DEFAULT_RAIL_FARE : DEFAULT_BUS_FARE,
        runtimeReserve: DEFAULT_RUNTIME_RESERVE_RAIL,
        connectionHoldSec: 0,
      },
    })
  }

  const trunkMode = trunkAsRail ? 'rail' : 'bus'
  makeLine('Hauptlinie', trunkMode, [
    { name: HUB, mode: trunkMode },
    { name: TARGET, mode: trunkMode },
  ])
  if (options.feeder) {
    makeLine('Zubringer', 'bus', [
      { name: FEEDER, mode: 'bus' },
      { name: HUB, mode: 'bus' },
    ])
  }
  if (options.duplicateTrunk) {
    makeLine('Parallellinie', trunkMode, [
      { name: HUB, mode: trunkMode },
      { name: TARGET, mode: trunkMode },
    ])
  }
  if (options.tail) {
    makeLine('Anschluss', 'bus', [
      { name: TARGET, mode: 'bus' },
      { name: FAR, mode: 'bus' },
    ])
  }

  // Fahrzeuge gleichmaessig auf die Linien verteilen.
  const lines = [...state.lines.values()]
  const pool = [...state.fleet.values()]
  for (const line of lines) {
    const wanted = line.mode === 'rail' ? 'rail' : 'bus'
    const share = pool.filter((v) => v.mode === wanted)
    const perLine = Math.max(1, Math.floor(share.length / lines.filter((l) => l.mode === line.mode).length))
    const taken = share.splice(0, perLine)
    for (const v of taken) pool.splice(pool.indexOf(v), 1)
    apply({
      kind: 'set_pattern',
      pattern: {
        lineId: line.id,
        direction: 'forward',
        vehicleIds: taken.map((v) => v.id),
        days: DAYS_ALL,
        headway: {
          everyMinutes: line.mode === 'rail' ? (options.railHeadway ?? 60) : (options.busHeadway ?? 60),
          firstDeparture: 5 * 3600,
          lastDeparture: 21 * 3600,
        },
      },
    })
  }

  const ready = Math.max(0, ...[...state.network.tracks.values()].map((t) => t.readyOnDay))
  state = advanceDays(state, demand, Math.max(0, ready - state.day))
  while (new Date(Date.UTC(1990, 0, 1 + state.day)).getUTCDay() !== 2) state = advanceDays(state, demand, 1)
  return state
}

const offersOf = (state: GameState): LineOffer[] =>
  prepareLines(state).flatMap((p) => (p.kind === 'idle' ? [] : [p.offer]))

const chainsOf = (state: GameState): Map<string, Itinerary[]> => buildItineraries(state, offersOf(state))

const lineNamed = (state: GameState, name: string): Line => [...state.lines.values()].find((l) => l.name === name)!

// ── Umsteigen ───────────────────────────────────────────────────────────────

describe('Umsteigen', () => {
  it('bietet ohne zweite Linie keine Kette mit Umstieg an', () => {
    const chains = chainsOf(network())
    expect([...chains.values()].flat().every((c) => c.transfers === 0)).toBe(true)
    expect(chains.has(odKey(id(FEEDER), id(TARGET)))).toBe(false)
  })

  it('verbindet zwei Linien zu einer Reisekette über die Umsteigestadt', () => {
    const chains = chainsOf(network({ feeder: true }))
    const chain = chains.get(odKey(id(FEEDER), id(TARGET)))
    expect(chain).toBeDefined()
    expect(chain![0]!.transfers).toBe(1)
    expect(chain![0]!.legs).toHaveLength(2)
  })

  it('steigt in der Stadt um, nicht an der Haltestelle', () => {
    // Der Zubringer endet an einer *Bushaltestelle*, die Hauptlinie beginnt an
    // einem *Bahnhof*. Waere der Umstieg an die Haltestellen-Identitaet
    // geknuepft, gaebe es die Kette nicht - und der Zubringerbus zum Bahnhof,
    // also der ganze Sinn der Uebung, waere unmoeglich.
    const state = network({ feeder: true })
    const chain = chainsOf(state).get(odKey(id(FEEDER), id(TARGET)))![0]!

    const [first, second] = chain.legs
    const offers = offersOf(state)
    const exit = offers.find((o) => o.lineId === first!.lineId)!.stops[first!.toIndex]!
    const entry = offers.find((o) => o.lineId === second!.lineId)!.stops[second!.fromIndex]!

    expect(exit.cityId).toBe(entry.cityId)
    expect(exit.stationId).not.toBe(entry.stationId)
  })

  it('bucht den Umsteiger auf beide Teilstrecken', () => {
    const state = network({ feeder: true })
    const { byLine, transferRidersByLine } = assignDemand(state, demand, buildOptions(state, offersOf(state)))

    const feeder = lineNamed(state, 'Zubringer').id
    const trunk = lineNamed(state, 'Hauptlinie').id
    const od = odKey(id(FEEDER), id(TARGET))

    const carries = (lineId: LineId): boolean =>
      [...(byLine.get(lineId)?.forward ?? []), ...(byLine.get(lineId)?.backward ?? [])].some((f) => f.od === od)

    expect(carries(feeder)).toBe(true)
    expect(carries(trunk)).toBe(true)
    expect(transferRidersByLine.get(feeder) ?? 0).toBeGreaterThan(0)
    expect(transferRidersByLine.get(trunk) ?? 0).toBeGreaterThan(0)
  })

  it('macht die Kette durch die Umsteigestrafe unattraktiver als dieselbe Fahrt am Stück', () => {
    const state = network({ feeder: true })
    const chain = chainsOf(state).get(odKey(id(FEEDER), id(TARGET)))![0]!

    const direct: Itinerary = { ...chain, transfers: 0 }
    expect(generalisedCost('commuter', itineraryAlternative(chain, 0))).toBeGreaterThan(
      generalisedCost('commuter', itineraryAlternative(direct, 0)),
    )
  })

  it('findet auch eine Kette über zwei Umstiege', () => {
    // Feldstadt -> Kreuzstadt (Bus), Kreuzstadt -> Grossstadt (Bahn),
    // Grossstadt -> Weitendorf (Bus): anders ist Weitendorf nicht erreichbar.
    const state = network({ feeder: true, tail: true })
    const chain = chainsOf(state).get(odKey(id(FEEDER), id(FAR)))
    expect(chain).toBeDefined()
    expect(chain!.some((c) => c.transfers === 2)).toBe(true)
    expect(chain![0]!.legs).toHaveLength(3)
  })

  it('bietet nicht mehr als MAX_TRANSFERS Umstiege an', () => {
    const chains = chainsOf(network({ feeder: true, tail: true, duplicateTrunk: true }))
    expect(Math.max(...[...chains.values()].flat().map((c) => c.transfers))).toBeLessThanOrEqual(MAX_TRANSFERS)
  })

  it('bucht einen Fahrgast mit zwei Umstiegen auf alle drei Linien', () => {
    const state = network({ feeder: true, tail: true })
    const { byLine } = assignDemand(state, demand, buildOptions(state, offersOf(state)))
    const od = odKey(id(FEEDER), id(FAR))

    for (const name of ['Zubringer', 'Hauptlinie', 'Anschluss']) {
      const lineId = lineNamed(state, name).id
      const flows = [...(byLine.get(lineId)?.forward ?? []), ...(byLine.get(lineId)?.backward ?? [])]
      expect(flows.some((f) => f.od === od), `${name} traegt die Relation`).toBe(true)
    }
  })

  it('behält je Relation nur die besten Verbindungen', () => {
    const state = network({ feeder: true, duplicateTrunk: true })
    for (const list of buildOptions(state, offersOf(state)).values()) {
      expect(list.length).toBeLessThanOrEqual(MAX_ITINERARIES_PER_OD)
    }
  })

  it('fasst austauschbare Linien zu einer Verbindung mit gemeinsamem Takt zusammen', () => {
    // Zwei gleichwertige Buslinien im Stundentakt sind fuer den Reisenden eine
    // Verbindung im Halbstundentakt - nicht zwei Verbindungen im Stundentakt.
    const state = network({ trunkAsRail: false, duplicateTrunk: true, busHeadway: 60 })
    const od = odKey(id(HUB), id(TARGET))

    const chains = chainsOf(state).get(od)!
    const options = buildOptions(state, offersOf(state)).get(od)!

    expect(chains).toHaveLength(2)
    expect(options).toHaveLength(1)
    expect(options[0]!.members).toHaveLength(2)
    // Halbe Wartezeit gegenueber einer einzelnen Linie im Stundentakt.
    expect(options[0]!.waitTimeSec).toBeCloseTo(15 * 60, 0)
    expect(options[0]!.members.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 6)
  })

  it('macht aus zwei Stundentakt-Linien genau einen Halbstundentakt, nicht die doppelte Nachfrage', () => {
    // Der scharfe Test auf das red-bus/blue-bus-Problem: bei reichlich
    // Kapazitaet duerfen zwei parallele Linien im Stundentakt exakt so viele
    // Fahrgaeste bringen wie eine einzige im Halbstundentakt. Ohne das
    // Zusammenfassen zaehlte das Logit die fast gleichen Alternativen doppelt.
    const parallel = simulateDay(
      network({ trunkAsRail: false, busHeadway: 60, duplicateTrunk: true, buses: 40 }),
      demand,
    )
    const denser = simulateDay(network({ trunkAsRail: false, busHeadway: 30, buses: 40 }), demand)

    const total = (d: typeof denser): number => d.lines.reduce((s, l) => s + l.totalPassengers, 0)
    expect(total(parallel) / total(denser)).toBeCloseTo(1, 1)
  })
})

// ── Überlastung ─────────────────────────────────────────────────────────────

describe('Gestrandete Umsteiger', () => {
  const leg = (position: number, line: string, wanted: number, carried: number) => ({
    chain: 'k',
    od: 'a|b',
    leg: position,
    lineId: line as LineId,
    wanted,
    carried,
  })

  it('laesst nur so viele ankommen, wie das schwaechste Teilstueck traegt', () => {
    // Vorher steht die Kette mit *beiden* Teilstuecken einzeln in der
    // Relationsabrechnung — 200 gewollt, 150 mitgenommen, also drei Viertel
    // bedient. In Wahrheit ist die Haelfte angekommen.
    const observed = new Map([['a|b', { wanted: 200, carried: 150, punctuality: 1 }]])
    const stranded = settleChains(new Map([['k', [leg(0, 'zubringer', 100, 100), leg(1, 'haupt', 100, 50)]]]), observed)

    expect(observed.get('a|b')).toEqual({ wanted: 100, carried: 50, punctuality: 1 })
    expect(stranded.get('haupt' as LineId)).toBeCloseTo(50, 6)
    // Wer auf dem ersten Teilstueck nicht mitkommt, strandet nicht — er ist
    // gar nicht erst losgefahren.
    expect(stranded.has('zubringer' as LineId)).toBe(false)
  })

  it('zaehlt einen Fahrgast nur einmal, auch wenn die Kette zweimal reisst', () => {
    // Das mittlere Teilstueck ist der Engpass. Das letzte traegt zwar auch
    // weniger als die volle Nachfrage, aber die Leute, die es abweist, sitzen
    // laengst nicht mehr im Zug — es darf sie nicht noch einmal stranden lassen.
    const observed = new Map([['a|b', { wanted: 300, carried: 200, punctuality: 1 }]])
    const stranded = settleChains(
      new Map([['k', [leg(0, 'l1', 100, 100), leg(1, 'l2', 100, 40), leg(2, 'l3', 100, 60)]]]),
      observed,
    )

    expect(observed.get('a|b')).toEqual({ wanted: 100, carried: 40, punctuality: 1 })
    expect(stranded.get('l2' as LineId)).toBeCloseTo(60, 6)
    expect(stranded.has('l3' as LineId)).toBe(false)
  })

  it('meldet die Gestrandeten bei der ueberlasteten Linie im laufenden Betrieb', () => {
    const state = network({ feeder: true })
    const day = simulateDay(state, demand)

    const of = (name: string): number =>
      day.lines.find((l) => l.lineId === lineNamed(state, name).id)?.strandedTransfers ?? 0

    // Die Hauptlinie ist hoffnungslos ueberfuellt, der Zubringer nicht.
    expect(day.lines.find((l) => l.lineId === lineNamed(state, 'Hauptlinie').id)!.peakLoadFactor).toBeGreaterThan(1)
    expect(of('Hauptlinie')).toBeGreaterThan(0)
    expect(of('Zubringer')).toBe(0)
  })
})

describe('Haltezeit aus Andrang', () => {
  it('verlängert die Haltezeit mit steigendem Andrang', () => {
    const quiet = dwellWithCrowding('rail', 60, RAIL_DWELL_SEC, 10)
    const busy = dwellWithCrowding('rail', 60, RAIL_DWELL_SEC, 600)
    expect(quiet).toBe(60)
    expect(busy).toBeGreaterThan(quiet)
  })

  it('deckelt den Zuschlag — irgendwann fährt der Zug ohne den Rest ab', () => {
    const absurd = dwellWithCrowding('rail', 60, RAIL_DWELL_SEC, 1_000_000)
    expect(absurd).toBe(60 + MAX_EXTRA_DWELL_SEC)
  })

  it('fertigt einen Bus langsamer ab als einen Zug', () => {
    expect(dwellWithCrowding('bus', 60, BUS_DWELL_SEC, 200)).toBeGreaterThan(
      dwellWithCrowding('rail', 60, RAIL_DWELL_SEC, 200),
    )
  })

  it('schlägt sich in der Fahrzeit einer überfüllten Linie nieder', () => {
    // Drei Halte, damit es einen Zwischenhalt mit Andrang gibt.
    let state = network({ feeder: true, busHeadway: 120, buses: 1 })
    state = advanceDays(state, demand, 3)
    const feeder = lineNamed(state, 'Zubringer').id
    const result = state.history[state.history.length - 1]!.lines.find((l) => l.lineId === feeder)
    // Zwei Halte haben keinen Zwischenhalt - der Zuschlag ist definitionsgemaess 0.
    expect(result?.crowdingDwellSec).toBe(0)
    expect(state.crowding.get(feeder)?.some((v) => v > 0)).toBe(true)
  })
})

describe('Zufriedenheit', () => {
  it('bewertet vollständige Bedienung mit 1', () => {
    expect(observedQuality({ wanted: 100, carried: 100, punctuality: 1 })).toBeCloseTo(1, 6)
  })

  it('bestraft Stehenbleiben überproportional', () => {
    const quality = observedQuality({ wanted: 100, carried: 90, punctuality: 1 })
    // Zehn Prozent stehen gelassen kostet deutlich mehr als zehn Prozent Wert.
    expect(quality).toBeLessThan(0.85)
    expect(quality).toBeGreaterThan(0.6)
  })

  it('bestraft Unpünktlichkeit, aber schwächer als Stehenbleiben', () => {
    const late = observedQuality({ wanted: 100, carried: 100, punctuality: 0 })
    const full = observedQuality({ wanted: 100, carried: 60, punctuality: 1 })
    expect(late).toBeLessThan(1)
    expect(full).toBeLessThan(late)
  })

  it('fällt deutlich schneller, als sie sich erholt', () => {
    const bad = new Map([['a|b', { wanted: 100, carried: 0, punctuality: 1 }]])
    const good = new Map([['a|b', { wanted: 100, carried: 100, punctuality: 1 }]])

    const dropped = updateSatisfaction(new Map([['a|b', 1]]), bad).get('a|b')!
    const recovered = updateSatisfaction(new Map([['a|b', 0]]), good).get('a|b')!

    expect(1 - dropped).toBeCloseTo(SATISFACTION_DROP_RATE, 6)
    expect(recovered).toBeCloseTo(SATISFACTION_RECOVERY_RATE, 6)
    expect(1 - dropped).toBeGreaterThan(recovered * 10)
  })

  it('erholt sich auch auf Relationen, die gar nicht mehr bedient werden', () => {
    const after = updateSatisfaction(new Map([['a|b', 0.5]]), new Map())
    expect(after.get('a|b')!).toBeGreaterThan(0.5)
  })

  it('wirkt als Abschlag im Logit-Modell', () => {
    expect(satisfactionOffset(1)).toBe(0)
    expect(satisfactionOffset(0.5)).toBeLessThan(0)
    expect(satisfactionOffset(0)).toBeLessThan(satisfactionOffset(0.5))
  })

  it('lässt eine überfüllte Linie über Wochen Fahrgäste verlieren', () => {
    const crowded = network({ trunkAsRail: false, busHeadway: 120, buses: 2 })
    const first = simulateDay(crowded, demand).lines.reduce((s, l) => s + l.totalPassengers, 0)

    const later = advanceDays(crowded, demand, 28)
    const afterFourWeeks = simulateDay(later, demand).lines.reduce((s, l) => s + l.totalPassengers, 0)

    expect(afterFourWeeks).toBeLessThan(first)
    const od = odKey(id(HUB), id(TARGET))
    expect(later.satisfaction.get(od)!).toBeLessThan(0.9)
  })

  it('lässt eine gut bediente Linie deutlich besser dastehen als eine überfüllte', () => {
    const od = odKey(id(HUB), id(TARGET))
    const crowded = advanceDays(network({ trunkAsRail: false, busHeadway: 120, buses: 2 }), demand, 28)
    // Reichlich bedient heisst seit der Fernverkehrskalibrierung mehr als
    // frueher: auf dieser Relation ist die Nachfrage rund doppelt so hoch, und
    // ein Viertelstundentakt laesst dort noch Leute stehen. Gebunden ist die
    // Kapazitaet am Takt, nicht an der Fahrzeugzahl - mehr Busse bei
    // gleichem Takt aendern nichts.
    const comfortable = advanceDays(network({ trunkAsRail: false, busHeadway: 6, buses: 80 }), demand, 28)

    expect(comfortable.satisfaction.get(od) ?? 1).toBeGreaterThan(0.93)
    expect(crowded.satisfaction.get(od)!).toBeLessThan(0.85)
  })

  it('gewinnt Fahrgäste nach einem Kapazitätsausbau nur langsam zurück', () => {
    let state = network({ trunkAsRail: false, busHeadway: 120, buses: 2 })
    state = advanceDays(state, demand, 28)
    const od = odKey(id(HUB), id(TARGET))
    const ruined = state.satisfaction.get(od)!
    expect(ruined).toBeLessThan(0.9)

    // Angebot vervielfachen: ab jetzt bleibt niemand mehr stehen.
    const line = [...state.lines.values()][0]!
    const bought = applyCommand(state, { kind: 'buy_vehicle', classId: 'intercity', units: 80 })
    if (!bought.ok) throw new Error(bought.reason)
    const patterned = applyCommand(bought.state, {
      kind: 'set_pattern',
      pattern: {
        lineId: line.id,
        direction: 'forward',
        vehicleIds: [...bought.state.fleet.keys()],
        days: DAYS_ALL,
        headway: { everyMinutes: 6, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
      },
    })
    if (!patterned.ok) throw new Error(patterned.reason)

    const oneWeek = advanceDays(patterned.state, demand, 7).satisfaction.get(od)!
    const halfYear = advanceDays(patterned.state, demand, 182).satisfaction.get(od) ?? 1

    expect(oneWeek).toBeGreaterThan(ruined)
    // Nach einer Woche ist der Ruf noch lange nicht repariert ...
    expect(oneWeek).toBeLessThan(ruined + 0.15)
    // ... nach einem halben Jahr schon.
    expect(halfYear).toBeGreaterThan(0.95)
  })
})

// ── Anschlüsse ──────────────────────────────────────────────────────────────

describe('Anschlüsse', () => {
  /** Verschiebt die Abfahrtsminute einer Linie. */
  function shift(state: GameState, lineName: string, minute: number): GameState {
    const line = lineNamed(state, lineName)
    const pattern = [...state.patterns.values()].find((p) => p.lineId === line.id)!
    const hour = Math.floor(pattern.headway!.firstDeparture / 3600)
    const result = applyCommand(state, {
      kind: 'set_pattern',
      pattern: { ...pattern, headway: { ...pattern.headway!, firstDeparture: hour * 3600 + minute * 60 } },
    })
    if (!result.ok) throw new Error(result.reason)
    return result.state
  }

  const feederConnection = (state: GameState): number => {
    const offers = offersOf(state)
    const list = lineConnections(state, offers, lineNamed(state, 'Zubringer').id)
    // Der Zubringer endet in der Umsteigestadt - dort kommt man nur in
    // Hinrichtung an, deshalb ist `outboundSec` hier immer gesetzt.
    return list.find((c) => c.stationName === HUB)!.toOther!.waitSec
  }

  it('macht die Umsteigezeit von der Abfahrtsminute abhängig', () => {
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const waits = [0, 15, 30, 45].map((m) => feederConnection(shift(base, 'Zubringer', m)))

    // Verschiedene Phasenlagen, verschiedene Anschluesse - vorher war das eine
    // Konstante (halber Takt).
    expect(new Set(waits.map((w) => Math.round(w / 60))).size).toBeGreaterThan(1)
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(20 * 60)
  })

  it('mittelt sich über alle Phasenlagen zum halben Takt plus Umsteigezeit', () => {
    // Die wichtigste Eigenschaft fuer das Balancing: die Mechanik verschiebt
    // nicht den Mittelwert, sie gibt dem Spieler die Wahl innerhalb davon.
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const all = Array.from({ length: 60 }, (_, m) => feederConnection(shift(base, 'Zubringer', m)))
    const mean = all.reduce((s, w) => s + w, 0) / all.length

    expect(mean / 60).toBeGreaterThan(28)
    expect(mean / 60).toBeLessThan(36)
  })

  it('senkt die Umsteigezeit nie unter die Mindestumsteigezeit', () => {
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const all = Array.from({ length: 60 }, (_, m) => feederConnection(shift(base, 'Zubringer', m)))
    expect(Math.min(...all)).toBeGreaterThanOrEqual(MIN_INTERCHANGE_SEC)
  })

  it('bringt einem guten Anschluss mehr Umsteiger als einem schlechten', () => {
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const byMinute = Array.from({ length: 12 }, (_, i) => shift(base, 'Zubringer', i * 5))

    const rated = byMinute.map((state) => ({
      wait: feederConnection(state),
      transfers: simulateDay(state, demand).lines.reduce((s, l) => s + (l.transferPassengers ?? 0), 0),
    }))

    const best = rated.reduce((a, b) => (a.wait <= b.wait ? a : b))
    const worst = rated.reduce((a, b) => (a.wait >= b.wait ? a : b))

    expect(best.transfers).toBeGreaterThan(worst.transfers)
  })

  it('bewertet die Umsteigezeit nachvollziehbar', () => {
    expect(connectionQuality(5 * 60)).toBe('good')
    expect(connectionQuality(15 * 60)).toBe('fair')
    expect(connectionQuality(40 * 60)).toBe('poor')
  })

  it('rechnet die Gegenrichtung aus dem symmetrischen Fahrplan', () => {
    const state = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const offers = offersOf(state)
    const feeder = offers.find((o) => o.lineId === lineNamed(state, 'Zubringer').id)!

    // Der Gegenzug startet am anderen Ende zur selben Zeit und erreicht Halt 0
    // nach einer vollen Fahrzeit.
    expect(departureAt(feeder, 0, 'forward')).toBe(feeder.firstDepartureSec)
    expect(arrivalAt(feeder, 0, 'backward')).toBeCloseTo(feeder.firstDepartureSec + feeder.oneWaySec, 6)
  })

  it('addiert bei zwei Umstiegen auch zwei Anschlusszeiten', () => {
    const state = network({ feeder: true, tail: true })
    const chain = chainsOf(state)
      .get(odKey(id(FEEDER), id(FAR)))!
      .find((c) => c.transfers === 2)!

    expect(chain.legWaits).toHaveLength(3)
    // Erste Wartezeit ist der halbe Takt, die beiden anderen sind Anschluesse.
    expect(chain.waitTimeSec).toBeCloseTo(chain.legWaits.reduce((s, w) => s + w, 0), 6)
    expect(chain.legWaits[1]!).toBeGreaterThanOrEqual(MIN_INTERCHANGE_SEC)
    expect(chain.legWaits[2]!).toBeGreaterThanOrEqual(MIN_INTERCHANGE_SEC)
  })
})

// ── Anschlusssicherung ──────────────────────────────────────────────────────

describe('Anschlusssicherung', () => {
  /**
   * Setzt einer Linie eine Verspaetung ins Angebot.
   *
   * Der Umweg ueber ein von Hand gesetztes Angebot ist Absicht: die Verspaetung
   * einer Linie haengt an Stoerungswuerfeln und Belegungskonflikten, und ein
   * Test, der erst ein unpuenktliches Netz bauen muss, prueft am Ende die
   * Stoerungen und nicht die Anschlusssicherung.
   */
  const delayed = (offers: readonly LineOffer[], lineId: LineId, sec: number): LineOffer[] =>
    offers.map((o) => (o.lineId === lineId ? { ...o, averageDelaySec: sec, punctuality: 0.7 } : o))

  /** Setzt die Wartebereitschaft einer Linie. */
  function hold(state: GameState, lineName: string, seconds: number): GameState {
    const result = applyCommand(state, {
      kind: 'set_connection_hold',
      lineId: lineNamed(state, lineName).id,
      seconds,
    })
    if (!result.ok) throw new Error(result.reason)
    return result.state
  }

  it('rechnet die erwartete Haltezeit geschlossen aus', () => {
    // Ohne Verspaetung des Zubringers gibt es nichts zu halten.
    expect(expectedHoldSec(0, 300, 600)).toBe(0)
    // Ohne Wartebereitschaft auch nicht.
    expect(expectedHoldSec(300, 0, 0)).toBe(0)

    // Mehr Puffer heisst weniger Warten, mehr Wartebereitschaft mehr.
    expect(expectedHoldSec(300, 600, 300)).toBeLessThan(expectedHoldSec(300, 0, 300))
    expect(expectedHoldSec(300, 120, 600)).toBeGreaterThan(expectedHoldSec(300, 120, 180))

    // Und nie mehr als die zugesagte Hoechstwartezeit.
    expect(expectedHoldSec(3000, 0, 300)).toBeLessThanOrEqual(300)
  })

  it('senkt mit jeder Minute Wartebereitschaft die verpassten Anschlüsse', () => {
    const chances = [0, 180, 300, 600].map((c) => missProbability(300, 120, c))
    for (let i = 1; i < chances.length; i++) expect(chances[i]!).toBeLessThan(chances[i - 1]!)

    // Ein Puffer wirkt genauso - nur ohne die eigene Linie zu verspaeten.
    expect(missProbability(300, 900, 0)).toBeLessThan(missProbability(300, 60, 0))
    // Ein puenktlicher Zubringer laesst niemanden stehen.
    expect(missProbability(0, 0, 0)).toBe(0)
  })

  it('lässt eine Linie ohne Wartebereitschaft unberührt', () => {
    const state = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const trunk = lineNamed(state, 'Hauptlinie').id
    const offers = delayed(offersOf(state), trunk, 8 * 60)

    const { offers: after, holds } = applyConnectionHolding(state, offers)
    const feeder = lineNamed(state, 'Zubringer').id

    expect(holds.get(feeder)!.seconds).toBe(0)
    expect(after.find((o) => o.lineId === feeder)!.averageDelaySec).toBe(0)
    expect(after.find((o) => o.lineId === feeder)!.punctuality).toBe(1)
  })

  it('holt sich beim Warten die Verspätung des Zubringers ins eigene Angebot', () => {
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const trunk = lineNamed(base, 'Hauptlinie').id
    const state = hold(base, 'Zubringer', 600)
    const feeder = lineNamed(state, 'Zubringer').id

    const offers = delayed(offersOf(state), trunk, 8 * 60)
    const { offers: after, holds } = applyConnectionHolding(state, offers)

    expect(holds.get(feeder)!.seconds).toBeGreaterThan(0)
    expect(holds.get(feeder)!.events.some((e) => e.fromLineId === trunk)).toBe(true)

    const own = after.find((o) => o.lineId === feeder)!
    // Die Wartezeit trifft die ganze Linie, nicht nur die Umsteiger.
    expect(own.averageDelaySec).toBeCloseTo(holds.get(feeder)!.seconds, 6)
    expect(own.punctuality).toBeLessThan(1)
    expect(own.heldSec).toBeGreaterThan(0)
  })

  it('macht einen knappen Anschluss hinter einem unpünktlichen Zubringer teurer als einen gepufferten', () => {
    // Dieselbe Linie, dieselbe Fahrzeit - nur die Phasenlage unterscheidet sich.
    // Vorher war das ein reiner Zeitunterschied; jetzt kommt das Risiko dazu.
    const state = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    const trunk = lineNamed(state, 'Hauptlinie').id
    const offers = delayed(offersOf(state), trunk, 10 * 60)

    const trunkOffer = offers.find((o) => o.lineId === trunk)!
    const feederIndex = offers.findIndex((o) => o.lineId !== trunk)
    const feederOffer = offers[feederIndex]!

    // Zwei Fassungen desselben Zubringers: einer faehrt kurz nach der Ankunft
    // des Zuges, einer eine Viertelstunde spaeter.
    const shifted = (minutes: number): LineOffer[] =>
      offers.map((o) =>
        o.lineId === feederOffer.lineId ? { ...o, firstDepartureSec: o.firstDepartureSec + minutes * 60 } : o,
      )

    const missOf = (list: readonly LineOffer[]): number => {
      const connection = lineConnections(state, list, trunkOffer.lineId).find((c) => c.stationName === HUB)!
      return connection.toOther!.missShare
    }

    const waits = [0, 5, 10, 15, 20, 25, 30].map((m) => ({ m, miss: missOf(shifted(m)) }))
    const best = waits.reduce((a, b) => (a.miss <= b.miss ? a : b))
    const worst = waits.reduce((a, b) => (a.miss >= b.miss ? a : b))

    // Der knappste Anschluss verliert die meisten Umsteiger.
    expect(worst.miss).toBeGreaterThan(best.miss)
  })

  it('rechnet einen verpassten Anschluss als vollen Takt Wartezeit in die Reisekette', () => {
    const state = network({ feeder: true, trunkAsRail: false, busHeadway: 60 })
    // Verspaetet ist der *Zubringer* - er bringt den Umsteiger zu spaet an den
    // Anschluss. Die Verspaetung der Anschlusslinie selbst spielt hier keine
    // Rolle; sie faehrt ja auch dann noch, wenn sie spaet dran ist.
    const feeder = lineNamed(state, 'Zubringer').id

    const chainWait = (offers: readonly LineOffer[]): number =>
      buildItineraries(state, offers)
        .get(odKey(id(FEEDER), id(TARGET)))!
        .find((c) => c.transfers === 1)!.waitTimeSec

    const punctual = offersOf(state)
    const late = delayed(punctual, feeder, 12 * 60)

    // Dieselben Fahrplaene, dieselbe Phasenlage - nur ist der Anschlusszug
    // jetzt unpuenktlich. Wer ihn verpasst, wartet einen ganzen Takt.
    expect(chainWait(late)).toBeGreaterThan(chainWait(punctual))
  })

  it('bewertet einen riskanten Anschluss trotz kurzer Zeit nicht als guten', () => {
    expect(connectionQuality(4 * 60, 0)).toBe('good')
    expect(connectionQuality(4 * 60, 0.4)).toBe('risky')
  })

  it('wartet je Halt nur einmal, auch bei zwei verspäteten Zubringern', () => {
    // Zwei parallele Linien am selben Halt sind kein doppelter Aufenthalt -
    // der Zug wartet einmal, bis der letzte da ist.
    const base = network({ feeder: true, trunkAsRail: false, busHeadway: 60, duplicateTrunk: true })
    const state = hold(base, 'Zubringer', 600)
    const feeder = lineNamed(state, 'Zubringer').id

    const offers = offersOf(state)
    const one = delayed(offers, lineNamed(state, 'Hauptlinie').id, 8 * 60)
    const two = delayed(one, lineNamed(state, 'Parallellinie').id, 8 * 60)

    const holdOf = (list: readonly LineOffer[]): number =>
      applyConnectionHolding(state, list).holds.get(feeder)!.seconds

    expect(holdOf(two)).toBeCloseTo(holdOf(one), 6)
    expect(applyConnectionHolding(state, two).holds.get(feeder)!.events).toHaveLength(1)
  })
})
