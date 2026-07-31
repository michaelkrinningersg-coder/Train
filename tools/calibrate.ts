/**
 * Kalibrierungsbericht fuer das Nachfrage- und Wirtschaftsmodell.
 *
 *   pnpm calibrate
 *
 * Prueft in einem Durchlauf drei Dinge, die sich beim Balancing gegenseitig
 * beeinflussen und deshalb zusammen betrachtet werden muessen:
 *
 *   1. Sind die Nachfragegroessen je Relation plausibel?
 *   2. Reagieren die Verkehrsmittelanteile richtig auf Preis und Takt?
 *   3. Traegt sich eine Linie wirtschaftlich - und zwar nur dann, wenn sie
 *      zur Nachfrage passt?
 *
 * Die Ausgabe ist bewusst zum Lesen gedacht, nicht zum Bestehen: es gibt keine
 * feste Sollgroesse, sondern Groessenordnungen, die man gegen die Wirklichkeit
 * halten kann. Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 8.
 */
import { existsSync, readFileSync } from 'node:fs'
import { SEGMENTS, SEGMENT_IDS, trackUpkeepPerDay, type City, type CityId } from '@game/domain'
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
import { advanceDays, applyCommand, createGame, lineMetrics } from '@game/sim'

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
