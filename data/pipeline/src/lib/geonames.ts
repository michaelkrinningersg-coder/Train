import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

const BASE_URL = 'https://download.geonames.org/export/dump'

/** Spalten des GeoNames-Dumps, siehe https://download.geonames.org/export/dump/readme.txt */
const COL = {
  geonameId: 0,
  name: 1,
  asciiName: 2,
  latitude: 4,
  longitude: 5,
  featureClass: 6,
  featureCode: 7,
  countryCode: 8,
  admin1: 10,
  admin2: 11,
  population: 14,
} as const

/**
 * Nur echte Siedlungen. Bewusst ohne PPLX (Stadtteil), PPLL (Weiler),
 * PPLQ/PPLW (aufgegeben/zerstoert) - die wuerden Agglomerationen doppelt zaehlen.
 */
const ACCEPTED_FEATURE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG'])

export interface GeoNamesPlace {
  readonly geonameId: string
  readonly name: string
  readonly country: string
  readonly admin1: string
  readonly admin2: string
  readonly lng: number
  readonly lat: number
  readonly population: number
  readonly featureCode: string
}

async function downloadCountry(country: string, cacheDir: string): Promise<string> {
  const txtPath = join(cacheDir, `${country}.txt`)
  if (existsSync(txtPath)) {
    return readFile(txtPath, 'utf8')
  }

  const url = `${BASE_URL}/${country}.zip`
  process.stdout.write(`  laden ${url} ... `)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GeoNames-Download fehlgeschlagen fuer ${country}: HTTP ${res.status}`)
  }
  const zipped = new Uint8Array(await res.arrayBuffer())
  const files = unzipSync(zipped)
  const entry = files[`${country}.txt`]
  if (!entry) {
    throw new Error(`${country}.txt nicht im Archiv gefunden (enthalten: ${Object.keys(files).join(', ')})`)
  }
  const text = new TextDecoder('utf8').decode(entry)

  await mkdir(cacheDir, { recursive: true })
  await writeFile(txtPath, text, 'utf8')
  process.stdout.write(`${(zipped.length / 1024 / 1024).toFixed(1)} MB\n`)
  return text
}

function parseLine(line: string): GeoNamesPlace | null {
  const f = line.split('\t')
  if (f.length < 15) return null
  if (f[COL.featureClass] !== 'P') return null

  const featureCode = f[COL.featureCode] ?? ''
  if (!ACCEPTED_FEATURE_CODES.has(featureCode)) return null

  const population = Number(f[COL.population] ?? '0')
  const lat = Number(f[COL.latitude])
  const lng = Number(f[COL.longitude])
  if (!Number.isFinite(population) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return {
    geonameId: f[COL.geonameId] ?? '',
    name: f[COL.name] ?? '',
    country: f[COL.countryCode] ?? '',
    admin1: f[COL.admin1] ?? '',
    admin2: f[COL.admin2] ?? '',
    lng,
    lat,
    population,
    featureCode,
  }
}

export async function loadPlaces(countries: readonly string[], cacheDir: string): Promise<GeoNamesPlace[]> {
  const out: GeoNamesPlace[] = []
  for (const country of countries) {
    const text = await downloadCountry(country, cacheDir)
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const place = parseLine(line)
      if (place) out.push(place)
    }
  }
  return out
}
