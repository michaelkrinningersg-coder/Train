import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cityRadiusKm, type City, type Facility, type FacilityType } from '@game/domain'
import { distanceKm } from '@game/geo'
import { resolveRegion } from './regions.js'
import { COUNTRY_ITEMS, runQuery, type WikidataRow } from './lib/wikidata.js'

/**
 * Einrichtungen der Staedte aus Wikidata.
 *
 * Bis hierher stand `facilities: []` in jeder Stadt — der Mechanismus im
 * Nachfragemodell war fertig und bekam keine Daten. Damit unterschieden sich
 * Staedte nur durch ihre Einwohnerzahl, und Erlangen war eine kleine Version von
 * Nuernberg statt eine Universitaetsstadt.
 *
 * Jede Einrichtung wird der naechsten Stadt zugeschlagen, in deren Einzugsgebiet
 * sie liegt. Die **Groessenstufe** kommt aus einer Kennzahl der Sache selbst —
 * Studierende, Beschaeftigte, Besucher —, nicht aus der Stadt: eine Universitaet
 * mit 40 000 Studierenden praegt einen Ort anders als eine mit 2 000, und das
 * gilt unabhaengig davon, wie gross der Ort ist.
 *
 * Aufruf:  pnpm data:facilities [-- --region=bavaria]
 */

const here = dirname(fileURLToPath(import.meta.url))
const seedDir = join(here, '..', '..', '..', 'data', 'seed')

/**
 * Wie weit eine Einrichtung vom Stadtzentrum entfernt sein darf, gemessen in
 * Stadtradien. Etwas grosszuegiger als der Radius selbst, weil Flughaefen und
 * Universitaetscampus regelmaessig am Rand oder knapp davor liegen.
 */
const CATCHMENT_RADII = 1.6

interface FacilityQuery {
  readonly type: FacilityType
  readonly label: string
  /** Schwellen der Kennzahl fuer Groesse 2 und 3; darunter Groesse 1. */
  readonly thresholds: readonly [number, number]
  /** Ohne Kennzahl: diese Stufe. */
  readonly fallbackSize: 1 | 2 | 3
  /**
   * Schwellen der *Anzahl* fuer Groesse 2 und 3.
   *
   * Gesetzt aus der Verteilung, die der Lauf selbst ausgibt — bei den
   * Sehenswuerdigkeiten liegt der Median bayerischer Staedte bei 10 und
   * Muenchen bei 292, da waere eine Schwelle bei 30 fast ueberall erreicht.
   * Wechselt die Region, gehoert die Zeile mit der Verteilung noch einmal
   * gelesen.
   *
   * Die Kennzahlen in Wikidata sind lueckenhaft — Besucherzahlen stehen bei den
   * wenigsten Museen. Wie viele Ziele eine Stadt hat, weiss der Datensatz
   * dagegen zuverlaessig, und es ist fuer die touristische Bedeutung fast das
   * bessere Mass: Muenchen ist nicht wegen eines Hauses ein Reiseziel, sondern
   * wegen dreissig. Gewertet wird das Groessere von beidem.
   */
  readonly countThresholds: readonly [number, number]
  build(countryItem: string): string
}

/**
 * Die Abfragen bleiben bewusst einfach gehalten. `wdt:P31/wdt:P279*` ueber tiefe
 * Klassenbaeume ist beim Query Service der schnellste Weg in einen Timeout;
 * einige wenige, konkrete Klassen liefern fast dieselbe Ausbeute und antworten.
 */
const QUERIES: readonly FacilityQuery[] = [
  {
    type: 'university',
    countThresholds: [2, 4],
    label: 'Universitaeten',
    thresholds: [12_000, 30_000],
    fallbackSize: 1,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord ?magnitude WHERE {
        VALUES ?class { wd:Q3918 wd:Q875538 }
        ?item wdt:P31 ?class ; wdt:P17 wd:${country} ; wdt:P625 ?coord .
        OPTIONAL { ?item wdt:P2196 ?magnitude }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
  {
    type: 'landmark',
    countThresholds: [18, 60],
    label: 'Sehenswuerdigkeiten',
    thresholds: [300_000, 1_000_000],
    fallbackSize: 1,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord ?magnitude WHERE {
        VALUES ?class { wd:Q33506 wd:Q23413 wd:Q751876 wd:Q16560 }
        ?item wdt:P31 ?class ; wdt:P17 wd:${country} ; wdt:P625 ?coord .
        OPTIONAL { ?item wdt:P1174 ?magnitude }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
  {
    type: 'nature',
    countThresholds: [2, 4],
    label: 'Naturziele',
    thresholds: [1, 2],
    fallbackSize: 2,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord WHERE {
        VALUES ?class { wd:Q46169 wd:Q1970725 }
        ?item wdt:P31 ?class ; wdt:P17 wd:${country} ; wdt:P625 ?coord .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
  {
    type: 'theme_park',
    countThresholds: [2, 3],
    label: 'Freizeitparks',
    thresholds: [1_000_000, 3_000_000],
    fallbackSize: 1,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord ?magnitude WHERE {
        ?item wdt:P31 wd:Q194195 ; wdt:P17 wd:${country} ; wdt:P625 ?coord .
        OPTIONAL { ?item wdt:P1174 ?magnitude }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
  {
    type: 'airport_hub',
    countThresholds: [2, 3],
    label: 'Flughaefen',
    thresholds: [5_000_000, 20_000_000],
    fallbackSize: 1,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord ?magnitude WHERE {
        ?item wdt:P31 wd:Q1248784 ; wdt:P17 wd:${country} ; wdt:P625 ?coord .
        OPTIONAL { ?item wdt:P3872 ?magnitude }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
  {
    type: 'major_employer',
    countThresholds: [3, 10],
    label: 'Grosse Arbeitgeber',
    thresholds: [20_000, 80_000],
    fallbackSize: 1,
    build: (country) => `
      SELECT ?item ?itemLabel ?coord ?magnitude WHERE {
        ?item wdt:P31 wd:Q4830453 ; wdt:P17 wd:${country} ; wdt:P1128 ?magnitude ;
              wdt:P159 ?seat .
        ?seat wdt:P625 ?coord .
        FILTER(?magnitude >= 5000)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
      }`,
  },
]

function sizeFromMagnitude(query: FacilityQuery, magnitude: number | undefined): 1 | 2 | 3 {
  if (magnitude === undefined) return query.fallbackSize
  if (magnitude >= query.thresholds[1]) return 3
  if (magnitude >= query.thresholds[0]) return 2
  return 1
}

function sizeFromCount(query: FacilityQuery, count: number): 1 | 2 | 3 {
  if (count >= query.countThresholds[1]) return 3
  if (count >= query.countThresholds[0]) return 2
  return 1
}

/** Naechste Stadt, in deren erweitertem Einzugsgebiet der Punkt liegt. */
function assignTo(cities: readonly City[], row: WikidataRow): City | null {
  let best: City | null = null
  let bestDistance = Infinity
  for (const city of cities) {
    const km = distanceKm(city.centre, [row.lng, row.lat])
    const limit = cityRadiusKm(city.population) * CATCHMENT_RADII
    if (km <= limit && km < bestDistance) {
      best = city
      bestDistance = km
    }
  }
  return best
}

async function main(): Promise<void> {
  const regionArg = process.argv.find((a) => a.startsWith('--region='))?.split('=')[1]
  const region = resolveRegion(regionArg)
  const path = join(seedDir, `cities.${region.id}.json`)

  const dataset = JSON.parse(await readFile(path, 'utf8')) as { cities: City[] } & Record<string, unknown>
  const cities = dataset.cities
  console.log(`Einrichtungen fuer ${cities.length} Staedte in ${region.label}\n`)

  const countryItems = region.countries.map((c) => COUNTRY_ITEMS[c]).filter((c): c is string => Boolean(c))
  if (countryItems.length === 0) throw new Error(`Keine Wikidata-Entitaet fuer ${region.countries.join(', ')}`)

  const collected = new Map<string, Facility[]>()
  const add = (cityId: string, facility: Facility): void => {
    const list = collected.get(cityId)
    if (list) list.push(facility)
    else collected.set(cityId, [facility])
  }

  for (const query of QUERIES) {
    const rows: WikidataRow[] = []
    for (const country of countryItems) rows.push(...(await runQuery(query.build(country))))

    let placed = 0
    const seen = new Set<string>()
    for (const row of rows) {
      const city = assignTo(cities, row)
      if (!city) continue
      // Dieselbe Sache steht in Wikidata gern mehrfach; eine Universitaet je
      // Stadt und Name genuegt.
      const key = `${city.id}|${row.name}`
      if (seen.has(key)) continue
      seen.add(key)

      add(city.id, {
        type: query.type,
        size: sizeFromMagnitude(query, row.magnitude),
        name: row.name,
      })
      placed++
    }
    const counts = [...collected.values()]
      .map((list) => list.filter((f) => f.type === query.type).length)
      .filter((n) => n > 0)
      .sort((a, b) => b - a)
    const quantile = (q: number): number => counts[Math.min(counts.length - 1, Math.floor(counts.length * q))] ?? 0
    console.log(
      `  ${query.label.padEnd(22)} ${String(rows.length).padStart(5)} gefunden, ${String(placed).padStart(4)} zugeordnet` +
        `  | Staedte ${String(counts.length).padStart(3)}  max ${String(counts[0] ?? 0).padStart(4)}` +
        `  p10 ${String(quantile(0.1)).padStart(3)}  p35 ${String(quantile(0.35)).padStart(3)}  median ${String(quantile(0.5)).padStart(3)}`,
    )
  }

  // Landeshauptstadt: die groesste Stadt der Region bekommt den Verwaltungsbonus.
  const capital = [...cities].sort((a, b) => b.population - a.population)[0]
  if (capital) add(capital.id, { type: 'capital', size: 1, name: 'Landeshauptstadt' })

  const byType = new Map(QUERIES.map((q) => [q.type, q]))

  const enriched = cities.map((city) => {
    const facilities = collected.get(city.id) ?? []

    // Je Typ eine Einrichtung. Ihre Stufe ist das Groessere aus "wie bedeutend
    // ist die groesste" und "wie viele gibt es" - drei mittlere Museen machen
    // keine dreifache Stadt, dreissig aber sehr wohl ein Reiseziel.
    const grouped = new Map<FacilityType, Facility[]>()
    for (const f of facilities) {
      const list = grouped.get(f.type)
      if (list) list.push(f)
      else grouped.set(f.type, [f])
    }

    const chosen: Facility[] = []
    for (const [type, list] of grouped) {
      const query = byType.get(type)
      const best = list.reduce((a, b) => (b.size > a.size ? b : a))
      const size = query
        ? (Math.max(best.size, sizeFromCount(query, list.length)) as 1 | 2 | 3)
        : best.size
      chosen.push({ type, size, ...(best.name ? { name: best.name } : {}) })
    }

    return { ...city, facilities: chosen.sort((a, b) => a.type.localeCompare(b.type)) }
  })

  await writeFile(path, `${JSON.stringify({ ...dataset, cities: enriched }, null, 2)}\n`, 'utf8')

  const withFacilities = enriched.filter((c) => c.facilities.length > 0)
  console.log(`\n  ${withFacilities.length} von ${cities.length} Staedten haben Einrichtungen`)
  console.log('\n  Beispiele:')
  for (const city of [...withFacilities].sort((a, b) => b.facilities.length - a.facilities.length).slice(0, 10)) {
    const list = city.facilities.map((f) => `${f.type}(${f.size})`).join(' ')
    console.log(`    ${city.name.padEnd(20)} ${list}`)
  }
  console.log(`\n  -> ${path}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
