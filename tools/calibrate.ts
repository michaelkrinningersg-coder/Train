/**
 * Kalibrierungsbericht fuer das Nachfrage- und Wirtschaftsmodell.
 *
 *   pnpm calibrate
 *
 * Prueft in einem Durchlauf die Dinge, die sich beim Balancing gegenseitig
 * beeinflussen und deshalb zusammen betrachtet werden muessen:
 *
 *   1. Sind die Nachfragegroessen je Relation plausibel?
 *   2. Reagieren die Verkehrsmittelanteile richtig auf Preis und Takt?
 *   3. Traegt sich eine Linie wirtschaftlich - und zwar nur dann, wenn sie
 *      zur Nachfrage passt?
 *   4. Stehen die Baukosten einer Strecke im richtigen Verhaeltnis dazu?
 *   5. Wo bricht welche Ausbaustufe unter welchem Takt zusammen?
 *   6. Was kostet Ueberlastung ueber Monate, was bringt ein Zubringer, und
 *      was macht die Abfahrtsminute mit den Anschluessen?
 *
 * Die Ausgabe ist bewusst zum Lesen gedacht, nicht zum Bestehen: es gibt keine
 * feste Sollgroesse, sondern Groessenordnungen, die man gegen die Wirklichkeit
 * halten kann. Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 8.
 */
import { existsSync, readFileSync } from 'node:fs'
import {
  DAYS_ALL,
  DEFAULT_RAIL_FARE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
  SEGMENTS,
  SEGMENT_IDS,
  trackUpkeepPerDay,
  type City,
  type CityId,
  type GameState,
  type TrackSpec,
} from '@game/domain'
import {
  buildDemandMatrix,
  carAlternative,
  incumbentTransit,
  modeShares,
  noTravelAlternative,
  withPotentials,
} from '@game/demand'
import { formatMoney, railStationCost, trackBuildCost } from '@game/economy'
import { distanceKm, terrainStats, type ElevationGrid } from '@game/geo'
import {
  advanceDays,
  applyCommand,
  createGame,
  isMinor,
  lineConnections,
  lineMetrics,
  prepareLines,
  simulateDay,
  simulateRailLine,
} from '@game/sim'

const data = JSON.parse(readFileSync('data/seed/cities.bavaria.json', 'utf8')) as { cities: City[] }
const cities = withPotentials(data.cities)
const demand = buildDemandMatrix(cities, { minTripsPerDay: 1 })
const name = (id: CityId): string => cities.find((c) => c.id === id)?.name ?? '?'

console.log('═══ 1. Nachfrage ═══\n')
console.log(
  `${demand.pairs.length} Relationen, ${Math.round(demand.totalTripsPerDay).toLocaleString('de-DE')} Reisen/Tag ` +
    `bei ${cities.length} Städten\n`,
)

const merged = new Map<string, number>()
for (const p of demand.pairs) {
  const key = [p.from, p.to].sort().join('|')
  merged.set(key, (merged.get(key) ?? 0) + p.totalTrips)
}
console.log('Stärkste Relationen (beide Richtungen, alle Verkehrsmittel):')
for (const [key, trips] of [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const [a, b] = key.split('|') as [CityId, CityId]
  const km = demand.byKey.get(`${a}|${b}`)?.distanceKm ?? 0
  console.log(
    `  ${`${name(a)} – ${name(b)}`.padEnd(32)} ${Math.round(trips).toString().padStart(6)}/Tag  ${km.toFixed(0).padStart(4)} km`,
  )
}

console.log('\n═══ 2. Verkehrsmittelwahl ═══\n')
console.log('Anteile auf einer 60-km-Relation zwischen zwei Großstädten, ohne eigenes Angebot:')
for (const seg of SEGMENT_IDS) {
  const s = modeShares(seg, [carAlternative(60), incumbentTransit(60, 300_000), noTravelAlternative])
  console.log(
    `  ${SEGMENTS[seg].label.padEnd(20)} Auto ${(s.car * 100).toFixed(0).padStart(3)} %` +
      `  Bestandsverkehr ${(s.rail * 100).toFixed(0).padStart(3)} %` +
      `  bleibt zuhause ${(s.none * 100).toFixed(0).padStart(3)} %`,
  )
}

console.log('\n═══ 3. Wirtschaftlichkeit ═══\n')

/** Baut eine Linie, fährt eine Woche und meldet das Wochenmittel. */
function corridor(names: string[], buses: number, classId = 'intercity', headway = 60): void {
  // Reichlich Kapital, damit der Test nicht am Startbudget scheitert.
  let state = createGame({ cities, startingCash: 50_000_000_00 })

  for (const n of names) {
    const city = cities.find((c) => c.name === n)
    if (!city) {
      console.log(`  ${n}: Stadt nicht im Datensatz`)
      return
    }
    const r = applyCommand(state, { kind: 'place_bus_stop', cityId: city.id })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }

  const bought = applyCommand(state, { kind: 'buy_vehicle', classId, units: buses })
  if (!bought.ok) throw new Error(bought.reason)
  state = bought.state

  const stops = [...state.network.stations.values()]
  const created = applyCommand(state, {
    kind: 'create_line',
    line: {
      name: names.join(' – '),
      mode: 'bus',
      stops: names.map((n) => ({ stationId: stops.find((s) => s.name === n)!.id, dwellSeconds: 120, serves: true })),
      path: { kind: 'road' },
      fare: { perKm: { first: 25, second: 15 }, baseFare: 250, priceIndex: 1 },
      runtimeReserve: 1.07,
    },
  })
  if (!created.ok) throw new Error(created.reason)
  state = created.state

  const line = [...state.lines.values()][0]!
  const metrics = lineMetrics(state, line)!
  const patterned = applyCommand(state, {
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: [...state.fleet.keys()],
      days: 127,
      headway: { everyMinutes: headway, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  if (!patterned.ok) throw new Error(patterned.reason)

  // Eine volle Woche, weil die Wochenganglinie einen einzelnen Tag unbrauchbar macht.
  const after = advanceDays(patterned.state, demand, 7)
  const days = after.history.slice(-7)
  const avg = (pick: (d: (typeof days)[number]) => number): number => days.reduce((s, d) => s + pick(d), 0) / 7

  const invested =
    buses * (classId === 'minibus' ? 8_500_000 : classId === 'citybus' ? 18_000_000 : 24_000_000) +
    [...after.network.stations.values()].reduce((s, st) => s + st.buildCost, 0)
  const profit = avg((d) => d.profit)
  const peak = Math.max(...days.map((d) => d.lines[0]?.peakLoadFactor ?? 0))

  console.log(
    `  ${names.join('–').padEnd(28)} ${metrics.lengthKm.toFixed(0).padStart(4)} km  ` +
      `${buses}× ${classId.padEnd(12)} ${headway}′  ` +
      `${Math.round(avg((d) => d.passengers)).toString().padStart(5)} Fg  ` +
      `${formatMoney(profit).padStart(11)}/Tag  ` +
      `Spitze ${(peak * 100).toFixed(0).padStart(4)} %  ` +
      (profit > 0 ? `amortisiert in ${(invested / profit / 365).toFixed(1)} Jahren` : 'VERLUST'),
  )
}

console.log('Dichte Fernkorridore — hier soll sich eine Linie tragen:')
corridor(['München', 'Augsburg'], 4)
corridor(['München', 'Augsburg'], 8, 'coach', 30)
corridor(['Nürnberg', 'Fürth', 'Erlangen'], 4)

console.log('\nMittlere Korridore — Grenzfall:')
corridor(['München', 'Ingolstadt'], 4)
corridor(['Würzburg', 'Schweinfurt'], 3)

console.log('\nSchwache Korridore — hier soll sich der Bus NICHT tragen:')
corridor(['Bayreuth', 'Hof'], 3)
corridor(['Bayreuth', 'Hof'], 1, 'minibus', 180)
corridor(['Kempten', 'Memmingen'], 3)

console.log('\nÜberangebot — soll bestraft werden:')
corridor(['München', 'Augsburg'], 24, 'intercity', 10)

console.log('\n═══ 4. Schieneninfrastruktur ═══\n')

/** Höhenraster, falls vorhanden - sonst wird flaches Gelände unterstellt. */
function loadElevation(): ElevationGrid | undefined {
  const metaPath = 'data/seed/elevation.bavaria.json'
  const binPath = 'data/seed/elevation.bavaria.bin'
  if (!existsSync(metaPath) || !existsSync(binPath)) return undefined
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Omit<ElevationGrid, 'data'>
  const buf = readFileSync(binPath)
  return { ...meta, data: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2) }
}

const elevation = loadElevation()
console.log(elevation ? 'Höhenraster geladen.\n' : 'Kein Höhenraster — flaches Gelände unterstellt.\n')

const SPEC_SIMPLE = { maxSpeed: 120, electrified: false, tracks: 1, signalling: 'classic' } as const
const SPEC_FULL = { maxSpeed: 200, electrified: true, tracks: 2, signalling: 'etcs_l1' } as const

function corridorCost(a: string, b: string): void {
  const from = cities.find((c) => c.name === a)
  const to = cities.find((c) => c.name === b)
  if (!from || !to) {
    console.log(`  ${a} – ${b}: nicht im Datensatz`)
    return
  }

  const path = [from.centre, to.centre]
  const km = distanceKm(from.centre, to.centre)
  const terrain = elevation ? terrainStats(elevation, path).terrainFactor : 1

  const simple = trackBuildCost(km, SPEC_SIMPLE, terrain)
  const full = trackBuildCost(km, SPEC_FULL, terrain)
  const stations =
    railStationCost(from.population, 0, 4) + railStationCost(to.population, 0, 4)
  const upkeep = trackUpkeepPerDay({
    id: 'x' as never, from: 'a' as never, to: 'b' as never, geometry: path,
    lengthKm: km, maxSpeed: 120, electrified: false, tracks: 1, signalling: 'classic',
    terrainFactor: terrain, gradientPermille: 0, builtOnDay: 0, readyOnDay: 0,
  })

  console.log(
    `  ${`${a} – ${b}`.padEnd(28)} ${km.toFixed(0).padStart(4)} km  Gelände ×${terrain.toFixed(2)}  ` +
      `einfach ${formatMoney(simple, { compact: true }).padStart(11)}  ` +
      `Vollausbau ${formatMoney(full, { compact: true }).padStart(11)}  ` +
      `Bahnhöfe ${formatMoney(stations, { compact: true }).padStart(10)}  ` +
      `Unterhalt ${formatMoney(upkeep).padStart(9)}/Tag`,
  )
}

corridorCost('München', 'Augsburg')
corridorCost('München', 'Ingolstadt')
corridorCost('Nürnberg', 'München')
corridorCost('München', 'Rosenheim')
corridorCost('Kempten', 'Memmingen')
corridorCost('Bayreuth', 'Hof')

console.log(
  '\nZur Einordnung: eine gut laufende Buslinie erwirtschaftet rund 5 000 €/Tag,\n' +
    'also etwa 1,8 Mio. €/Jahr. Die erste Bahnstrecke ist damit das Ziel mehrerer\n' +
    'Spieljahre Busbetrieb — genau so ist die Progression gedacht.',
)

console.log('\n═══ 5. Bahnbetrieb ═══\n')

/**
 * Baut eine Bahnlinie und meldet, was die Betriebssimulation daraus macht.
 * Die interessante Zahl ist nicht der Gewinn, sondern das Verhaeltnis von Takt
 * zu Puenktlichkeit: ab welcher Dichte bricht welche Ausbaustufe ein?
 */
function railCorridor(options: {
  readonly names: string[]
  readonly spec: TrackSpec
  readonly headway: number
  readonly trains: number
  readonly classId?: string
  readonly loop?: boolean
  readonly label: string
}): void {
  let state = createGame({ cities, startingCash: 50_000_000_000_00 })

  const chosen = options.names.map((n) => cities.find((c) => c.name === n))
  if (chosen.some((c) => !c)) {
    console.log(`  ${options.label}: Stadt nicht im Datensatz`)
    return
  }

  for (const c of chosen) {
    const r = applyCommand(state, { kind: 'place_station', cityId: c!.id, position: c!.centre, platforms: 4 })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }

  const nodes = options.names.map((n) => [...state.network.stations.values()].find((s) => s.name === n)!.nodeId)
  for (let i = 1; i < nodes.length; i++) {
    const r = applyCommand(state, { kind: 'build_track', from: nodes[i - 1]!, to: nodes[i]!, geometry: [], spec: options.spec })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }

  // Erst die Bauzeit abwarten: eine Ueberholstelle laesst sich nur auf einer
  // fertigen Strecke setzen, und Zuege fahren ohnehin erst danach.
  const ready = Math.max(...[...state.network.tracks.values()].map((t) => t.readyOnDay))
  state = advanceDays(state, demand, Math.max(0, ready - state.day))

  if (options.loop) {
    for (const track of [...state.network.tracks.values()]) {
      const g = track.geometry
      const a = g[0]!
      const b = g[g.length - 1]!
      const middle: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const r = applyCommand(state, { kind: 'place_passing_loop', trackId: track.id, position: middle, capacity: 2 })
      if (!r.ok) throw new Error(r.reason)
      state = r.state
    }
    // Auch die Ueberholstelle hat Bauzeit, und solange sie laeuft, sind die
    // beiden Teilstrecken gesperrt - dann faehrt gar nichts.
    const loopReady = Math.max(...[...state.network.tracks.values()].map((t) => t.readyOnDay))
    state = advanceDays(state, demand, Math.max(0, loopReady - state.day))
  }

  const bought = applyCommand(state, { kind: 'buy_vehicle', classId: options.classId ?? 'emu_regional', units: options.trains })
  if (!bought.ok) throw new Error(bought.reason)
  state = bought.state

  const created = applyCommand(state, {
    kind: 'create_line',
    line: {
      name: options.names.join(' – '),
      mode: 'rail',
      stops: options.names.map((n) => ({
        stationId: [...state.network.stations.values()].find((s) => s.name === n)!.id,
        dwellSeconds: 60,
        serves: true,
      })),
      path: { kind: 'rail', tracks: [] },
      fare: DEFAULT_RAIL_FARE,
      runtimeReserve: DEFAULT_RUNTIME_RESERVE_RAIL,
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
      headway: { everyMinutes: options.headway, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
    },
  })
  if (!patterned.ok) throw new Error(patterned.reason)

  // Auf einen Dienstag stellen: der Wochentag veraendert die Pendlernachfrage so
  // stark, dass ein Vergleich sonst nichts aussagt. Dieselbe Falle wie bei den
  // Buskorridoren.
  let final = patterned.state
  while (new Date(Date.UTC(1990, 0, 1 + final.day)).getUTCDay() !== 2) final = advanceDays(final, demand, 1)

  const result = simulateRailLine(final, demand, line.id)
  if (!result) {
    console.log(`  ${options.label}: keine Simulation moeglich`)
    return
  }

  const serious = result.conflicts.filter((c) => !isMinor(c)).length
  const worstLink = Math.max(0, ...result.linkLoadFactors ?? [])
  const contribution = result.revenue - result.operatingCost

  console.log(
    `  ${options.label.padEnd(34)} ${String(options.headway).padStart(3)}′  ` +
      `${result.departuresPerDirection.toString().padStart(2)} Züge/Ri  ` +
      `Pünktl. ${(result.punctuality * 100).toFixed(0).padStart(3)} %  ` +
      `Ø ${(result.averageDelaySec / 60).toFixed(1).padStart(5)} min  ` +
      `${serious.toString().padStart(3)} Konfl.  ` +
      `${Math.round(result.totalPassengers).toString().padStart(5)} Fg  ` +
      `Abschn. ${(worstLink * 100).toFixed(0).padStart(3)} %  ` +
      `${formatMoney(contribution, { compact: true }).padStart(10)}/Tag`,
  )
}

const RAIL_SINGLE: TrackSpec = { maxSpeed: 160, electrified: true, tracks: 1, signalling: 'classic' }
const RAIL_DOUBLE: TrackSpec = { maxSpeed: 160, electrified: true, tracks: 2, signalling: 'classic' }
const RAIL_ETCS: TrackSpec = { maxSpeed: 200, electrified: true, tracks: 2, signalling: 'etcs_l2' }
const MA = ['München', 'Augsburg']

console.log('Eingleisig — hier soll der Takt an die Grenze stoßen:')
railCorridor({ names: MA, spec: RAIL_SINGLE, headway: 120, trains: 4, label: 'München–Augsburg eingleisig' })
railCorridor({ names: MA, spec: RAIL_SINGLE, headway: 60, trains: 4, label: 'München–Augsburg eingleisig' })
railCorridor({ names: MA, spec: RAIL_SINGLE, headway: 30, trains: 6, label: 'München–Augsburg eingleisig' })

console.log('\nDieselbe Strecke mit einer Überholstelle in Streckenmitte:')
railCorridor({ names: MA, spec: RAIL_SINGLE, headway: 60, trains: 4, loop: true, label: '… + Überholstelle' })
railCorridor({ names: MA, spec: RAIL_SINGLE, headway: 30, trains: 6, loop: true, label: '… + Überholstelle' })

console.log('\nZweigleisig — die Gegenrichtung stört nicht mehr:')
railCorridor({ names: MA, spec: RAIL_DOUBLE, headway: 30, trains: 6, label: 'München–Augsburg zweigleisig' })
railCorridor({ names: MA, spec: RAIL_DOUBLE, headway: 15, trains: 10, label: 'München–Augsburg zweigleisig' })

console.log('\nAusbau nützt nur dem Zug, der ihn nutzen kann:')
railCorridor({ names: MA, spec: RAIL_DOUBLE, headway: 30, trains: 8, classId: 'emu_regional', label: 'Triebwagen 140 auf 160er Gleis' })
railCorridor({ names: MA, spec: RAIL_ETCS, headway: 30, trains: 8, classId: 'emu_regional', label: 'Triebwagen 140 auf 200er Gleis' })
railCorridor({ names: MA, spec: RAIL_ETCS, headway: 30, trains: 8, classId: 'hst_250', label: 'Hochgeschw. 250 auf 200er Gleis' })

console.log('\nKapazität — dieselbe Trasse, mehr Sitzplätze je Zug:')
railCorridor({ names: MA, spec: RAIL_ETCS, headway: 30, trains: 8, classId: 'push_pull_double', label: 'Doppelstock, 30′' })

console.log('\nSchwacher Korridor — soll sich auch mit Bahn nicht tragen:')
railCorridor({ names: ['Bayreuth', 'Hof'], spec: RAIL_SINGLE, headway: 120, trains: 2, label: 'Bayreuth–Hof eingleisig' })

console.log(
  '\nZu lesen ist die Tabelle über die Spalte Pünktlichkeit: solange sie bei 100 % steht,\n' +
    'verträgt die Strecke den Takt. Auf einer durchgehend eingleisigen Strecke steht sie\n' +
    'nie dort — jede Begegnung kostet Wartezeit, unabhängig vom Takt. Deshalb ändert der\n' +
    'Sprung von 120′ auf 60′ nichts an der Verspätung, wohl aber die Überholstelle.\n' +
    'Die Spalte Abschnitt zeigt den am stärksten belasteten Abschnitt: über 100 % bleiben\n' +
    'Fahrgäste stehen, und dann hilft ein größerer Zug mehr als ein dichterer Takt.\n' +
    'Die letzte Spalte ist Erlös minus Energie und Personal — ohne Fahrzeugunterhalt,\n' +
    'Verwaltung und Infrastruktur. Bayreuth–Hof steht dort mit +717 €/Tag und ist\n' +
    'trotzdem ein Verlustgeschäft: allein der Streckenunterhalt kostet 1 882 €/Tag\n' +
    '(Abschnitt 4), von den 122 Mio. € Baukosten ganz zu schweigen.',
)

console.log('\n═══ 6. Netzwirkungen ═══\n')

/**
 * Umsteigen und Ueberlastung sind Eigenschaften des Netzes, nicht einer Linie -
 * deshalb ein eigener Abschnitt. Gemessen wird ueber ein halbes Jahr, weil die
 * Zufriedenheit Wochen braucht, um sich einzupendeln.
 */
function busLine(
  state: GameState,
  name: string,
  cityNames: readonly string[],
  vehicles: number,
  headway: number,
  departureMinute = 0,
): GameState {
  let next = state
  const apply = (command: Parameters<typeof applyCommand>[1]): void => {
    const r = applyCommand(next, command)
    if (!r.ok) throw new Error(r.reason)
    next = r.state
  }

  const before = new Set(next.fleet.keys())
  for (const n of cityNames) {
    const c = cities.find((x) => x.name === n)!
    if (![...next.network.stations.values()].some((s) => s.name === n && s.mode === 'bus')) {
      apply({ kind: 'place_bus_stop', cityId: c.id })
    }
  }
  apply({ kind: 'buy_vehicle', classId: 'intercity', units: vehicles })
  const fresh = [...next.fleet.values()].filter((v) => !before.has(v.id)).map((v) => v.id)

  apply({
    kind: 'create_line',
    line: {
      name,
      mode: 'bus',
      stops: cityNames.map((n) => ({
        stationId: [...next.network.stations.values()].find((s) => s.name === n && s.mode === 'bus')!.id,
        dwellSeconds: 120,
        serves: true,
      })),
      path: { kind: 'road' },
      fare: { perKm: { first: 25, second: 15 }, baseFare: 250, priceIndex: 1 },
      runtimeReserve: 1.07,
    },
  })
  const line = [...next.lines.values()].find((l) => l.name === name)!
  apply({
    kind: 'set_pattern',
    pattern: {
      lineId: line.id,
      direction: 'forward',
      vehicleIds: fresh,
      days: DAYS_ALL,
      headway: {
        everyMinutes: headway,
        firstDeparture: 5 * 3600 + departureMinute * 60,
        lastDeparture: 21 * 3600,
      },
    },
  })
  return next
}

function networkCase(label: string, build: (s: GameState) => GameState, days: number): void {
  let state = build(createGame({ cities, startingCash: 50_000_000_00 }))
  state = advanceDays(state, demand, days)

  const week = state.history.slice(-7)
  const passengers = week.reduce((s, d) => s + d.passengers, 0) / 7
  const profit = week.reduce((s, d) => s + d.profit, 0) / 7
  const transfers = week.reduce((s, d) => s + d.lines.reduce((t, l) => t + (l.transferPassengers ?? 0), 0), 0) / 7
  const satisfactions = [...state.satisfaction.values()]
  const worst = satisfactions.length > 0 ? Math.min(...satisfactions) : 1
  const peak = Math.max(0, ...week.flatMap((d) => d.lines.map((l) => l.peakLoadFactor)))

  console.log(
    `  ${label.padEnd(38)} ${Math.round(passengers).toString().padStart(5)} Fg  ` +
      `Umsteiger ${Math.round(transfers).toString().padStart(4)}  ` +
      `Spitze ${(peak * 100).toFixed(0).padStart(4)} %  ` +
      `Zufriedenheit min ${(worst * 100).toFixed(0).padStart(3)} %  ` +
      `${formatMoney(profit).padStart(11)}/Tag`,
  )
}

console.log('Überlastung — dieselbe Relation, verschieden viel Kapazität (Wochenmittel nach 6 Monaten):')
for (const [vehicles, headway] of [[2, 120], [4, 60], [8, 30], [16, 15]] as const) {
  networkCase(
    `München–Augsburg, ${headway}′ mit ${vehicles} Bussen`,
    (s) => busLine(s, 'M–A', ['München', 'Augsburg'], vehicles, headway),
    182,
  )
}

console.log('\nUmsteigen — jede weitere Linie erschließt Relationen, die es vorher nicht gab:')
const trunk = (s: GameState): GameState => busLine(s, 'M–A', ['München', 'Augsburg'], 8, 30)
const withFeeder = (s: GameState): GameState =>
  busLine(trunk(s), 'L–A', ['Landsberg am Lech', 'Augsburg'], 3, 60)
const withTail = (s: GameState): GameState =>
  busLine(withFeeder(s), 'M–R', ['München', 'Rosenheim'], 3, 60)

networkCase('nur München–Augsburg', trunk, 182)
networkCase('+ Zubringer Landsberg–Augsburg', withFeeder, 182)
networkCase('+ Anschluss München–Rosenheim', withTail, 182)

console.log('\nAnschlüsse — dieselben zwei Linien, nur die Abfahrtsminute des Zubringers verschoben:')
for (const minute of [0, 10, 20, 30, 40, 50]) {
  const build = (s: GameState): GameState =>
    busLine(busLine(s, 'M–A', ['München', 'Augsburg'], 8, 60), 'L–A', ['Landsberg am Lech', 'Augsburg'], 3, 60, minute)

  const state = advanceDays(build(createGame({ cities, startingCash: 50_000_000_00 })), demand, 21)
  const offers = prepareLines(state).flatMap((p) => (p.kind === 'idle' ? [] : [p.offer]))
  const feeder = [...state.lines.values()].find((l) => l.name === 'L–A')!
  const link = lineConnections(state, offers, feeder.id).find((c) => c.stationName === 'Augsburg')!
  const day = simulateDay(state, demand)

  console.log(
    `  Abfahrt :${String(minute).padStart(2, '0')}` +
      `   Umstieg auf die Fernlinie ${((link.toOtherSec ?? 0) / 60).toFixed(0).padStart(3)} min` +
      `  zurück ${((link.fromOtherSec ?? 0) / 60).toFixed(0).padStart(3)} min` +
      `  Summe ${(((link.toOtherSec ?? 0) + (link.fromOtherSec ?? 0)) / 60).toFixed(0).padStart(3)} min` +
      `  ·  Umsteiger ${Math.round(day.lines.reduce((s, l) => s + (l.transferPassengers ?? 0), 0)).toString().padStart(4)}` +
      `  Fahrgäste ${Math.round(day.lines.reduce((s, l) => s + l.totalPassengers, 0)).toString().padStart(5)}`,
  )
}

console.log(
  '\nDie Zufriedenheit pendelt sich ungefähr dort ein, wo der Anteil der tatsächlich\n' +
    'mitgenommenen Reisenden liegt — überproportional gewichtet, weil ein einmal\n' +
    'stehen gelassener Fahrgast länger nachträgt, als eine Durchschnittsrechnung\n' +
    'nahelegt. Sie fällt in Tagen und erholt sich in Monaten: ein überfahrener\n' +
    'Korridor lässt sich nicht mit einem einzigen zusätzlichen Bus reparieren.\n' +
    'Der Umsteigeblock zeigt den zweiten Effekt: Landsberg hat keine eigene\n' +
    'Verbindung nach München, bekommt sie aber über den Umstieg in Augsburg. Die\n' +
    'dritte Linie bringt mehr als ihre eigene Relation — Landsberg erreicht über\n' +
    'zwei Umstiege auch Rosenheim. Genau das ist der Unterschied zwischen einer\n' +
    'Sammlung von Korridoren und einem Netz.\n\n' +
    'Der Anschlussblock ist die dritte Stellschraube und die billigste: die\n' +
    'Abfahrtsminute zu verschieben kostet keinen Cent. Über alle Phasenlagen\n' +
    'gemittelt ergibt sich wieder der halbe Takt — die Mechanik verschiebt also\n' +
    'nicht das Balancing, sie gibt dem Spieler die Wahl innerhalb davon. Und sie\n' +
    'hat eine eingebaute Härte: bei gleichem Takt beider Linien ist die *Summe*\n' +
    'beider Umsteigerichtungen weitgehend festgelegt. Man kann wählen, welche\n' +
    'Richtung man bevorzugt, und man kann die gute Hälfte der Phasenlagen treffen\n' +
    '— aber beide Richtungen zugleich kurz zu bekommen geht nur, wenn Fahrzeit\n' +
    'und Takt zueinander passen. Das ist genau die Rechnung hinter einem\n' +
    'Integralen Taktfahrplan.',
)
