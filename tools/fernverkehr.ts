import { readFileSync } from 'node:fs'
import { SEGMENTS, SEGMENT_IDS, type City, type SegmentId, type SegmentParams } from '@game/domain'
import { buildDemandMatrix, odKey, withPotentials, type SegmentTable } from '@game/demand'

/**
 * Kalibrierung der Fernverkehrsnachfrage.
 *
 *   pnpm fernverkehr          nur messen
 *   pnpm fernverkehr --fit    zusätzlich die Parameter anpassen
 *
 * ## Warum es dieses Werkzeug gibt
 *
 * Das Nachfragemodell war im Nahbereich plausibel und im Fernbereich um ein
 * Vielfaches zu schwach. Gemessen wurde das an der Nord-Süd-Achse: 728 Reisen
 * am Tag zwischen Hamburg und München, über *alle* Verkehrsmittel. Damit kann
 * keine 4,5-Milliarden-Trasse sich je tragen — die Kernfantasie des Spiels war
 * im Modell wirtschaftlich sinnlos, und der Auftrag „Die Nord-Süd-Achse" nur
 * deshalb lösbar, weil ich ihm sieben Milliarden Startkapital geschenkt hatte.
 * Das war ein Symptom kuriert.
 *
 * ## Die Anker
 *
 * Kalibriert wird gegen veröffentlichte Zahlen, nicht gegen Bauchgefühl. Alle
 * Anker beziehen sich auf **2019**, das letzte Jahr vor der Pandemie.
 *
 * | Größe | Wert | Quelle |
 * |---|---|---|
 * | Eisenbahn-Fernverkehr, Reisende | 151,4 Mio./Jahr = 414 800/Tag | Destatis PD20_124 |
 * | Eisenbahn-Fernverkehr, Leistung | 44,7 Mrd. Pkm/Jahr = 122,5 Mio./Tag | Destatis PD20_124 |
 * | daraus: mittlere Reiseweite | 295 km | — |
 * | Modal Split Verkehrsleistung, MIV | 78,4 % | Umweltbundesamt |
 *
 * Daraus abgeleitet, und **diese Ableitung ist die unsicherste Stelle**:
 *
 * - Gesamtverkehrsleistung Personenverkehr ≈ 1 180 Mrd. Pkm/Jahr. (Aus dem
 *   MIV-Anteil von 78,4 % und den rund 917 Mrd. Pkw-Pkm gegengerechnet.)
 * - Reisen über 100 km sind rund 2 % aller Wege, tragen aber **rund 37 % der
 *   Verkehrsleistung** — die übliche Größenordnung aus MiD-Auswertungen.
 * - Also: **≈ 1,20 Mrd. Pkm/Tag** über 100 km, alle Verkehrsmittel.
 * - Gegenprobe: der Fernverkehr der Bahn wäre darin 122,5/1 200 = **10,2 %**.
 *   Das passt zu einem Schienenanteil von rund 8 % über alle Distanzen, leicht
 *   erhöht im Fernbereich. Die Ableitung ist also in sich stimmig — was kein
 *   Beweis ist, aber mehr als nichts.
 *
 * Der Datensatz erfasst **nicht ganz Deutschland**: 694 Städte mit zusammen
 * rund 49 der 83 Mio. Einwohner. Die Ziele werden entsprechend herunter-
 * skaliert. Das ist eher zu streng als zu großzügig, weil den Städten in der
 * Pipeline ein Teil des Umlands zugeschlagen wurde.
 */

const YEAR = 365

/** Reisende und Leistung des Eisenbahn-Fernverkehrs 2019, auf den Tag gerechnet. */
const RAIL_LONG_DISTANCE_TRIPS_PER_DAY = 151_400_000 / YEAR
const RAIL_LONG_DISTANCE_PKM_PER_DAY = 44_700_000_000 / YEAR

/** Gesamtverkehrsleistung und der Anteil, der auf Reisen über 100 km entfällt. */
const TOTAL_PKM_PER_DAY = 1_180_000_000_000 / YEAR
const LONG_DISTANCE_PKM_SHARE = 0.37

/** Einwohner Deutschlands, gegen die der Datensatz skaliert wird. */
const GERMANY_POPULATION = 83_000_000

const data = JSON.parse(readFileSync('data/seed/cities.germany.json', 'utf8')) as { cities: City[] }
const baseCities = data.cities
const covered = baseCities.reduce((s, c) => s + c.population, 0)
const scale = covered / GERMANY_POPULATION

/** Zielwerte für den erfassten Ausschnitt. */
const TARGET_PKM_FAR = TOTAL_PKM_PER_DAY * LONG_DISTANCE_PKM_SHARE * scale
/** Mittlere Weite im Fernbereich, aus derselben Ableitung. */
const TARGET_MEAN_FAR = 250
const TARGET_TRIPS_FAR = TARGET_PKM_FAR / TARGET_MEAN_FAR

interface Measurement {
  readonly totalTrips: number
  readonly tripsFar: number
  readonly pkmFar: number
  readonly meanFar: number
  readonly hamburgMuenchen: number
  readonly muenchenBerlin: number
}

const FAR_KM = 100

function measure(params: SegmentTable): Measurement {
  const cities = withPotentials(baseCities, 5, params)
  const m = buildDemandMatrix(cities, { minTripsPerDay: 0.01, params })

  let tripsFar = 0
  let pkmFar = 0
  for (const p of m.pairs) {
    if (p.distanceKm < FAR_KM) continue
    tripsFar += p.totalTrips
    pkmFar += p.totalTrips * p.distanceKm
  }

  const id = (name: string): string => cities.find((c) => c.name === name)?.id ?? ''
  const both = (a: string, b: string): number =>
    (m.byKey.get(odKey(id(a) as never, id(b) as never))?.totalTrips ?? 0) +
    (m.byKey.get(odKey(id(b) as never, id(a) as never))?.totalTrips ?? 0)

  return {
    totalTrips: m.totalTripsPerDay,
    tripsFar,
    pkmFar,
    meanFar: pkmFar / tripsFar,
    hamburgMuenchen: both('Hamburg', 'München'),
    muenchenBerlin: both('München', 'Berlin'),
  }
}

/**
 * Parametersatz aus zwei Reglern.
 *
 * Gedreht wird nur an den drei **Fernsegmenten** — Geschäftsreisende, Touristen
 * und Besuchsreisende. Pendler und Schüler bleiben unangetastet: deren Verkehr
 * ist im Modell plausibel, und ihn mitzuziehen hieße, einen richtigen Teil
 * kaputtzumachen, um einen falschen zu reparieren.
 *
 * - `level` hebt die erzeugten Reisen je Person.
 * - `reach` streckt die Abklinglänge, verschiebt also innerhalb des Segments
 *   von nah nach fern, **ohne** die Gesamtzahl zu ändern (die Normierung je
 *   Quellstadt sorgt dafür).
 *
 * Zwei Regler und nicht einer, weil sie verschiedene Fehler beheben: zu wenig
 * Fernverkehr *insgesamt* und zu wenig davon *weit weg*.
 */
const FAR_SEGMENTS: readonly SegmentId[] = ['business', 'tourist', 'vfr']

function tune(level: number, reach: number): SegmentTable {
  const out = {} as Record<SegmentId, SegmentParams>
  for (const id of SEGMENT_IDS) {
    const s = SEGMENTS[id]
    out[id] = FAR_SEGMENTS.includes(id)
      ? { ...s, tripsPerPersonDay: s.tripsPerPersonDay * level, decayKm: s.decayKm * reach }
      : s
  }
  return out
}

/** Abstand zum Ziel, in log-Raum — ein Faktor 2 zu viel wiegt wie ein Faktor 2 zu wenig. */
function error(m: Measurement): number {
  const rel = (value: number, target: number): number => Math.log(value / target) ** 2
  return rel(m.tripsFar, TARGET_TRIPS_FAR) + rel(m.pkmFar, TARGET_PKM_FAR)
}

const mio = (n: number): string => (n / 1e6).toFixed(2)
const tsd = (n: number): string => Math.round(n).toLocaleString('de-DE')

console.log(`${baseCities.length} Städte, ${(covered / 1e6).toFixed(1)} Mio. Einwohner (${(scale * 100).toFixed(0)} % von Deutschland)\n`)
console.log('Anker (2019, auf den erfassten Ausschnitt skaliert):')
console.log(`  Reisen  ab ${FAR_KM} km   ${tsd(TARGET_TRIPS_FAR).padStart(11)} /Tag`)
console.log(`  Leistung ab ${FAR_KM} km  ${mio(TARGET_PKM_FAR).padStart(11)} Mio. Pkm/Tag`)
console.log(
  `  zum Vergleich: der ganze Eisenbahn-Fernverkehr Deutschlands ist ` +
    `${tsd(RAIL_LONG_DISTANCE_TRIPS_PER_DAY)} Reisen und ${mio(RAIL_LONG_DISTANCE_PKM_PER_DAY)} Mio. Pkm am Tag\n`,
)

const report = (label: string, m: Measurement): void => {
  console.log(
    `${label.padEnd(22)} ` +
      `gesamt ${mio(m.totalTrips).padStart(5)} Mio. · ` +
      `ab ${FAR_KM} km ${mio(m.tripsFar).padStart(5)} Mio. (${(m.tripsFar / TARGET_TRIPS_FAR).toFixed(2)}× Ziel) · ` +
      `${mio(m.pkmFar).padStart(6)} Mio. Pkm (${(m.pkmFar / TARGET_PKM_FAR).toFixed(2)}×) · ` +
      `Ø ${m.meanFar.toFixed(0)} km`,
  )
  console.log(
    ' '.repeat(22) + ` Hamburg–München ${tsd(m.hamburgMuenchen).padStart(6)}/Tag · ` +
      `München–Berlin ${tsd(m.muenchenBerlin).padStart(6)}/Tag`,
  )
}

const heute = measure(SEGMENTS)
report('heute', heute)

if (!process.argv.includes('--fit')) {
  console.log('\n(mit --fit werden Parameter gesucht)')
  process.exit(0)
}

console.log('\nSuche über Niveau und Reichweite der drei Fernsegmente:\n')
let best: { level: number; reach: number; m: Measurement; e: number } | null = null
for (const level of [1, 1.5, 2, 2.5, 3, 3.5, 4, 5]) {
  const row: string[] = []
  for (const reach of [1, 1.25, 1.5, 1.75, 2]) {
    const m = measure(tune(level, reach))
    const e = error(m)
    if (!best || e < best.e) best = { level, reach, m, e }
    row.push(`${(m.tripsFar / TARGET_TRIPS_FAR).toFixed(2)}/${(m.pkmFar / TARGET_PKM_FAR).toFixed(2)}`)
  }
  console.log(`  Niveau ×${level.toFixed(2)}  ` + row.map((r) => r.padStart(12)).join(''))
}
console.log(`  ${' '.repeat(14)}` + [1, 1.25, 1.5, 1.75, 2].map((r) => `Reichw. ×${r}`.padStart(12)).join(''))
console.log('  (Reisen/Ziel · Leistung/Ziel — 1,00/1,00 wäre genau getroffen)\n')

if (best) {
  console.log(`Bester Satz: Niveau ×${best.level}, Reichweite ×${best.reach}`)
  report('kalibriert', best.m)
  console.log('\nDaraus für segments.ts:')
  for (const id of FAR_SEGMENTS) {
    const s = SEGMENTS[id]
    console.log(
      `  ${id.padEnd(9)} tripsPerPersonDay ${s.tripsPerPersonDay} → ${(s.tripsPerPersonDay * best.level).toFixed(4)}` +
        `   decayKm ${s.decayKm} → ${Math.round(s.decayKm * best.reach)}`,
    )
    const perYear = s.populationShare * s.tripsPerPersonDay * best.level * YEAR
    console.log(`  ${' '.repeat(9)} entspricht ${perYear.toFixed(1)} Reisen je Einwohner und Jahr`)
  }
}
