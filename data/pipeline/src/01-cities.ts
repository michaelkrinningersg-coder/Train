/**
 * Pipeline-Schritt 01: GeoNames -> Staedte mit realen Einwohnerzahlen.
 *
 *   pnpm data:cities                 # Bayern (Standard)
 *   pnpm data:cities -- --region=dach
 *
 * Ergebnis: data/seed/cities.<region>.json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cityRadiusKm, type City } from '@game/domain'
import { bboxOf } from '@game/geo'
import { loadPlaces } from './lib/geonames.js'
import { loadLocalNames } from './lib/localNames.js'
import { clusterAgglomerations, deduplicate } from './lib/cluster.js'
import { resolveRegion } from './regions.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cacheDir = join(here, '..', '.cache')
const seedDir = join(repoRoot, 'data', 'seed')

function parseArgs(argv: readonly string[]): { region: string | undefined } {
  const regionArg = argv.find((a) => a.startsWith('--region='))
  return { region: regionArg?.slice('--region='.length) }
}

async function main(): Promise<void> {
  const { region: regionId } = parseArgs(process.argv.slice(2))
  const region = resolveRegion(regionId)

  console.log(`Region: ${region.label} (${region.countries.join(', ')})`)

  const all = await loadPlaces(region.countries, cacheDir)
  console.log(`  ${all.length.toLocaleString('de-DE')} Siedlungen aus GeoNames gelesen`)

  const inRegion = all.filter((p) => {
    const allowed = region.admin1?.[p.country]
    return allowed ? allowed.includes(p.admin1) : true
  })

  const aboveThreshold = inRegion.filter((p) => p.population >= region.minPopulation)
  console.log(`  ${aboveThreshold.length} Orte ab ${region.minPopulation.toLocaleString('de-DE')} Einwohnern`)

  const unique = deduplicate(aboveThreshold)
  if (unique.length !== aboveThreshold.length) {
    console.log(`  ${aboveThreshold.length - unique.length} Doppeleintraege entfernt`)
  }

  // GeoNames liefert im Feld `name` englische Exonyme ("Munich"). Auf einer Karte
  // realer Orte gehoert der Endonym hin.
  const localNames = await loadLocalNames(region.countries, cacheDir)
  const localised = unique.map((p) => {
    const local = localNames.get(p.geonameId)
    return local && local !== p.name ? { ...p, name: local } : p
  })
  const renamed = localised.filter((p, i) => p.name !== unique[i]?.name).length
  if (renamed > 0) console.log(`  ${renamed} Namen auf die Landessprache gesetzt`)

  const clustered = clusterAgglomerations(localised, region.minPopulation)
  const absorbedCount = clustered.reduce((n, c) => n + c.absorbed.length, 0)
  console.log(`  ${absorbedCount} Vororte ihren Zentren zugeschlagen -> ${clustered.length} Staedte`)

  const cities: City[] = clustered.map((c) => ({
    id: `gn:${c.place.geonameId}` as City['id'],
    name: c.place.name,
    country: c.place.country,
    admin1: c.place.admin1,
    centre: [round(c.place.lng, 5), round(c.place.lat, 5)],
    population: c.population,
    radiusKm: round(cityRadiusKm(c.population), 2),
    facilities: [],
    ...(c.absorbed.length > 0 ? { absorbed: c.absorbed } : {}),
  }))

  const bbox = bboxOf(cities.map((c) => c.centre))
  const output = {
    region: region.id,
    label: region.label,
    generatedFrom: 'GeoNames (CC BY 4.0), https://www.geonames.org/',
    minPopulation: region.minPopulation,
    view: region.view,
    bbox,
    cities,
  }

  await mkdir(seedDir, { recursive: true })
  const outPath = join(seedDir, `cities.${region.id}.json`)
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  const totalPop = cities.reduce((n, c) => n + c.population, 0)
  console.log(`\n  ${cities.length} Staedte, ${totalPop.toLocaleString('de-DE')} Einwohner gesamt`)
  console.log('  Groesste:')
  for (const c of cities.slice(0, 8)) {
    console.log(`    ${c.name.padEnd(22)} ${c.population.toLocaleString('de-DE').padStart(10)}  r=${c.radiusKm} km`)
  }
  console.log(`\n  -> ${outPath}`)
}

const round = (v: number, digits: number): number => Number(v.toFixed(digits))

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
