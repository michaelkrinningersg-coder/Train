/**
 * Auftragsprobe: sind die Aufträge überhaupt lösbar?
 *
 *   pnpm missions
 *
 * Der Kalibrierlauf (`tools/calibrate.ts`) prüft das *Modell* — ob eine Buslinie
 * plausible Zahlen liefert, ob ein Ausbau wirkt. Diese Datei prüft die
 * **Aufträge**: ob das Startkapital für das reicht, was verlangt wird, ob die
 * Ziele in der Frist erreichbar sind, und woran es sonst scheitert.
 *
 * Der Anlass war ein Testlauf im Browser. „Die Nord-Süd-Achse" gab 400 Mio. €
 * und verlangte Hamburg–München mit der Bahn. Der erste Abschnitt, Hamburg
 * nach Hannover, kostete 215 Mio. — nach dem zweiten war Schluss. Der Auftrag
 * war unlösbar, und niemandem wäre es aufgefallen, weil die Ziele nie jemand
 * nachgerechnet hatte.
 *
 * Gespielt wird hier nicht optimal, sondern **plausibel**: so, wie ein Spieler
 * es täte, der die Mechanik verstanden hat. Kommt eine solche Lösung nicht
 * durch, ist der Auftrag zu schwer — nicht der Spieler zu ungeschickt.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_CONNECTION_HOLD_SEC,
  DEFAULT_RAIL_FARE,
  DEFAULT_RUNTIME_RESERVE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
  SCENARIOS,
  formatDate,
  type City,
  type GameState,
  type Scenario,
  type TrackSpec,
} from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { formatMoney } from '@game/economy'
import type { ElevationGrid } from '@game/geo'
import {
  advanceDays,
  applyCommand,
  applyScenarioSetup,
  createGame,
  previewTrack,
  scenarioStatus,
} from '@game/sim'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const seed = join(repoRoot, 'data', 'seed')

const data = JSON.parse(readFileSync(join(seed, 'cities.germany.json'), 'utf8')) as { cities: City[] }
const cities = withPotentials(data.cities)
const demand: DemandMatrix = buildDemandMatrix(cities, { minTripsPerDay: 1 })
const cityOf = (name: string): City => {
  const city = cities.find((c) => c.name === name)
  if (!city) throw new Error(`Stadt fehlt im Datensatz: ${name}`)
  return city
}

/** Höhenraster für die Baukosten — ohne es wären alle Trassen flach und billig. */
function loadElevation(): ElevationGrid | undefined {
  const meta = join(seed, 'elevation.germany.json')
  const bin = join(seed, 'elevation.germany.bin')
  if (!existsSync(meta) || !existsSync(bin)) return undefined
  const header = JSON.parse(readFileSync(meta, 'utf8')) as {
    bounds: ElevationGrid['bounds']
    cols: number
    rows: number
    stepDeg: number
    noData: number
  }
  const buffer = readFileSync(bin)
  return {
    ...header,
    data: new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2),
  }
}
const elevation = loadElevation()

// ── Werkzeuge zum Spielen ───────────────────────────────────────────────────

/** Ein Spielzug. Schlägt er fehl, wird der Grund gemeldet statt verschluckt. */
function play(state: GameState, command: Parameters<typeof applyCommand>[1], label?: string): GameState {
  const result = applyCommand(state, command, { elevation })
  if (!result.ok) {
    console.log(`    ✗ ${label ?? command.kind}: ${result.reason}`)
    return state
  }
  return result.state
}

const railStationOf = (state: GameState, name: string) =>
  [...state.network.stations.values()].find((s) => s.name === name && s.mode !== 'bus')

const busStopOf = (state: GameState, name: string) =>
  [...state.network.stations.values()].find((s) => s.name === name && s.mode !== 'rail')

const SPECS: Readonly<Record<string, TrackSpec>> = {
  'einfach (120, 1 Gleis, Diesel)': { maxSpeed: 120, electrified: false, tracks: 1, signalling: 'classic' },
  'solide (160, 1 Gleis, elektrisch)': { maxSpeed: 160, electrified: true, tracks: 1, signalling: 'classic' },
  'zweigleisig (160, elektrisch)': { maxSpeed: 160, electrified: true, tracks: 2, signalling: 'classic' },
  'Schnellfahrstrecke (250, ETCS)': { maxSpeed: 250, electrified: true, tracks: 2, signalling: 'etcs_l2' },
}

/** Was ein Korridor kostet, ohne ihn zu bauen. */
function corridorCost(names: readonly string[], spec: TrackSpec): { km: number; cost: number; days: number } {
  let km = 0
  let cost = 0
  let days = 0
  for (let i = 1; i < names.length; i++) {
    const preview = previewTrack([cityOf(names[i - 1]!).centre, cityOf(names[i]!).centre], spec, elevation)
    km += preview.lengthKm
    cost += preview.cost
    days = Math.max(days, preview.buildDays)
  }
  return { km, cost, days }
}

// ── 1. Was die Korridore kosten ─────────────────────────────────────────────

const AXIS = ['Hamburg', 'Hannover', 'Kassel', 'Frankfurt am Main', 'Mannheim', 'Stuttgart', 'Augsburg', 'München']
const RUHR = ['Duisburg', 'Essen', 'Bochum', 'Dortmund']

console.log('═══ 1. Was die Korridore kosten ═══\n')
for (const [label, names] of [
  ['Nord-Süd-Achse (Hamburg–München)', AXIS],
  ['Ruhrschiene (Duisburg–Dortmund)', RUHR],
] as const) {
  console.log(`${label}:`)
  for (const [name, spec] of Object.entries(SPECS)) {
    const { km, cost, days } = corridorCost(names, spec)
    console.log(
      `  ${name.padEnd(34)} ${km.toFixed(0).padStart(4)} km  ${formatMoney(cost, { compact: true }).padStart(12)}` +
        `  längster Abschnitt ${String(days).padStart(4)} Tage`,
    )
  }
  console.log()
}

// ── 2. Die Aufträge durchspielen ────────────────────────────────────────────

console.log('═══ 2. Die Aufträge durchspielen ═══\n')

/** Startzustand eines Auftrags, wie ihn das Spiel herstellt. */
function begin(scenario: Scenario): GameState {
  return applyScenarioSetup(
    createGame({ cities, startingCash: scenario.startingCash, scenarioId: scenario.id }),
    scenario,
  )
}

/**
 * Bericht über einen Auftrag: wann welches Ziel fiel und wie es ausging.
 *
 * Gemeldet wird der **erste** Tag, an dem ein Ziel erfüllt war — nicht nur der
 * Endstand. Ein Auftrag, dessen Ziele nacheinander fallen und nie zusammen,
 * sieht am Ende genauso aus wie einer, bei dem nichts klappt.
 */
function report(
  base: Scenario,
  build: (state: GameState) => GameState,
  variant = '',
  cashOverride?: number,
): void {
  // Mit dem Ueberschreiben laesst sich fragen, *wie viel* Kapital ein Auftrag
  // braeuchte - ohne ihn dafuer zu aendern.
  const scenario: Scenario = cashOverride ? { ...base, startingCash: cashOverride } : base
  const checkEvery = 30
  console.log(
    `${scenario.title}${variant ? ` — ${variant}` : ''} · ` +
      `${formatMoney(scenario.startingCash, { compact: true })}, ${scenario.deadlineDays} Tage`,
  )

  let state = begin(scenario)
  state = build(state)

  const firstMet = new Map<string, number>()
  let won: number | null = null

  while (state.day < scenario.deadlineDays) {
    state = advanceDays(state, demand, Math.min(checkEvery, scenario.deadlineDays - state.day))
    const status = scenarioStatus(state, scenario)
    status.goals.forEach((goal) => {
      if (goal.done && !firstMet.has(goal.label)) firstMet.set(goal.label, state.day)
    })
    if (status.outcome === 'won' && won === null) won = state.day
    if (state.cash <= -5_000_000_00) break
  }

  const status = scenarioStatus(state, scenario)
  for (const goal of status.goals) {
    const met = firstMet.get(goal.label)
    // Geldziele stehen im Modell in Cent. Sie hier roh auszugeben ergab
    // "2.257.930 Tagesgewinn" fuer 22 579 Euro - eine Zahl, die man einmal
    // glaubt und dann falsch entscheidet.
    const money = goal.goal.kind === 'daily_profit' || goal.goal.kind === 'cash'
    const value =
      goal.goal.kind === 'connect'
        ? goal.done
          ? 'verbunden'
          : 'offen'
        : goal.goal.kind === 'satisfaction' || goal.goal.kind === 'punctuality'
          ? `${Math.round(goal.value * 100)} %`
          : money
            ? formatMoney(Math.round(goal.value), { compact: true })
            : Math.round(goal.value).toLocaleString('de-DE')
    console.log(
      `  ${goal.done ? '✓' : '✗'} ${goal.label.padEnd(46)} ${value.padStart(12)}` +
        (met !== undefined ? `  erreicht am Tag ${met}` : ''),
    )
  }
  console.log(
    `  → ${won !== null ? `erfüllt am Tag ${won} (${formatDate(won)})` : 'nicht erfüllt'}` +
      `  ·  Kasse ${formatMoney(state.cash, { compact: true })}` +
      `  ·  ${Math.round(state.lastDay?.passengers ?? 0).toLocaleString('de-DE')} Fahrgäste/Tag\n`,
  )
}

/** Buslinie über eine Städtefolge, mit Haltestellen wo nötig. */
function busLine(
  state: GameState,
  name: string,
  names: readonly string[],
  classId: string,
  vehicles: number,
  headway: number,
): GameState {
  let current = state
  for (const n of names) {
    if (!busStopOf(current, n)) current = play(current, { kind: 'place_bus_stop', cityId: cityOf(n).id }, `Halt ${n}`)
  }
  const before = new Set(current.fleet.keys())
  current = play(current, { kind: 'buy_vehicle', classId, units: vehicles }, `${vehicles}× ${classId}`)
  const fresh = [...current.fleet.values()].filter((v) => !before.has(v.id)).map((v) => v.id)
  if (fresh.length === 0) return current

  const stops = names.map((n) => busStopOf(current, n)).filter((s): s is NonNullable<typeof s> => Boolean(s))
  if (stops.length < 2) return current

  current = play(current, {
    kind: 'create_line',
    line: {
      name,
      mode: 'bus',
      stops: stops.map((s) => ({ stationId: s.id, dwellSeconds: 120, serves: true })),
      path: { kind: 'road' },
      fare: DEFAULT_BUS_FARE,
      runtimeReserve: DEFAULT_RUNTIME_RESERVE,
      connectionHoldSec: DEFAULT_CONNECTION_HOLD_SEC,
    },
  })
  const line = [...current.lines.values()].at(-1)
  if (!line) return current
  return play(current, {
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: fresh,
      days: DAYS_ALL,
      headway: { everyMinutes: headway, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
}

/** Bahnkorridor: Bahnhöfe, Strecken, Linie. */
function railCorridor(
  state: GameState,
  name: string,
  names: readonly string[],
  spec: TrackSpec,
  classId: string,
  trains: number,
  headway: number,
): GameState {
  let current = state
  for (const n of names) {
    if (!railStationOf(current, n)) {
      const city = cityOf(n)
      current = play(current, { kind: 'place_station', cityId: city.id, position: city.centre, platforms: 4 }, `Bahnhof ${n}`)
    }
  }
  for (let i = 1; i < names.length; i++) {
    const a = railStationOf(current, names[i - 1]!)
    const b = railStationOf(current, names[i]!)
    if (!a || !b) continue
    current = play(
      current,
      { kind: 'build_track', from: a.nodeId, to: b.nodeId, geometry: [a.position, b.position], spec },
      `Strecke ${names[i - 1]}–${names[i]}`,
    )
  }

  const before = new Set(current.fleet.keys())
  current = play(current, { kind: 'buy_vehicle', classId, units: trains }, `${trains}× ${classId}`)
  const fresh = [...current.fleet.values()].filter((v) => !before.has(v.id)).map((v) => v.id)
  if (fresh.length === 0) return current

  const stops = names.map((n) => railStationOf(current, n)).filter((s): s is NonNullable<typeof s> => Boolean(s))
  if (stops.length < 2) return current

  current = play(current, {
    kind: 'create_line',
    line: {
      name,
      mode: 'rail',
      stops: stops.map((s) => ({ stationId: s.id, dwellSeconds: 60, serves: true })),
      path: { kind: 'rail', tracks: [] },
      fare: DEFAULT_RAIL_FARE,
      runtimeReserve: DEFAULT_RUNTIME_RESERVE_RAIL,
      connectionHoldSec: DEFAULT_CONNECTION_HOLD_SEC,
    },
  })
  const line = [...current.lines.values()].at(-1)
  if (!line) return current
  return play(current, {
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: fresh,
      days: DAYS_ALL,
      headway: { everyMinutes: headway, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
}

const scenario = (id: string): Scenario => {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`Unbekannter Auftrag: ${id}`)
  return found
}

/**
 * Jeder Auftrag mit mehreren Lösungen — von knapp bis großzügig.
 *
 * Ein Ziel ist dann richtig gesetzt, wenn die knappe Lösung scheitert und die
 * ordentliche durchkommt. Mit nur einer Lösung sieht man das nicht: sie sagt
 * „geht" oder „geht nicht", aber nicht, wo dazwischen die Grenze liegt.
 */

report(
  scenario('first-line'),
  (state) => busLine(state, 'München – Augsburg', ['München', 'Augsburg'], 'minibus', 2, 120),
  'ein Minibus, 120-Minuten-Takt',
)
report(
  scenario('first-line'),
  (state) => busLine(state, 'München – Augsburg', ['München', 'Augsburg'], 'intercity', 4, 60),
  'vier Überlandbusse, Stundentakt',
)

report(
  scenario('ruhr'),
  (state) => busLine(state, 'Ruhrschiene', RUHR, 'intercity', 6, 30),
  'eine Achse, Halbstundentakt',
)
report(
  scenario('ruhr'),
  (state) => {
    let current = busLine(state, 'Ruhrschiene', RUHR, 'intercity', 12, 15)
    current = busLine(current, 'Ruhr Süd', ['Duisburg', 'Düsseldorf', 'Köln'], 'intercity', 8, 20)
    return current
  },
  'Achse im Viertelstundentakt plus Südast',
)

const FEEDERS: readonly (readonly [string, readonly string[]])[] = [
  ['Zubringer Bremen', ['Bremen', 'Hamburg']],
  ['Zubringer Braunschweig', ['Braunschweig', 'Hannover']],
  ['Zubringer Erfurt', ['Erfurt', 'Kassel']],
  ['Zubringer Wiesbaden', ['Wiesbaden', 'Mainz', 'Frankfurt am Main']],
  ['Zubringer Karlsruhe', ['Karlsruhe', 'Mannheim']],
  ['Zubringer Ulm', ['Ulm', 'Augsburg']],
  ['Zubringer Ingolstadt', ['Ingolstadt', 'München']],
]

for (const [label, spec, headway, trains, feeders] of [
  ['eingleisig elektrisch, Stundentakt', SPECS['solide (160, 1 Gleis, elektrisch)']!, 60, 14, false],
  ['zweigleisig, Stundentakt', SPECS['zweigleisig (160, elektrisch)']!, 60, 14, false],
  ['zweigleisig, Stundentakt + Zubringer', SPECS['zweigleisig (160, elektrisch)']!, 60, 14, true],
  ['zweigleisig, Halbstundentakt + Zubringer', SPECS['zweigleisig (160, elektrisch)']!, 30, 26, true],
] as const) {
  report(
    scenario('north-south'),
    (state) => {
      let current = railCorridor(state, 'Nord-Süd', AXIS, spec, 'hst_250', trains, headway)
      if (feeders) {
        for (const [name, stops] of FEEDERS) current = busLine(current, name, stops, 'intercity', 4, 60)
      }
      return current
    },
    label,
  )
}
