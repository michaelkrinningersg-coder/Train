import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

const BASE_URL = 'https://download.geonames.org/export/dump/alternatenames'

/**
 * Das GeoNames-Feld `name` liefert fuer bekannte Staedte englische Exonyme:
 * "Munich", "Nuremberg", "Cologne", "Warsaw". Fuer eine Karte, die reale Orte
 * zeigt, ist der Endonym richtig - also der Name in der Landessprache.
 *
 * Bewusst nur fuer eindeutig einsprachige Laender. Bei mehrsprachigen Laendern
 * (CH, BE, LU) gibt es keinen einen richtigen Namen; dort ist das GeoNames-Feld
 * `name` bereits der lokale Name (Zuerich, Geneve, Lausanne) und bleibt stehen.
 */
export const LOCAL_LANGUAGES: Readonly<Record<string, string>> = {
  DE: 'de',
  AT: 'de',
  PL: 'pl',
  CZ: 'cs',
  SK: 'sk',
  HU: 'hu',
  NL: 'nl',
  FR: 'fr',
  IT: 'it',
  SI: 'sl',
  DK: 'da',
  ES: 'es',
  PT: 'pt',
  SE: 'sv',
  NO: 'no',
  FI: 'fi',
}

const COL = {
  geonameId: 1,
  language: 2,
  name: 3,
  isPreferred: 4,
  isColloquial: 6,
  isHistoric: 7,
} as const

async function downloadAlternateNames(country: string, cacheDir: string): Promise<string | null> {
  const txtPath = join(cacheDir, `alt-${country}.txt`)
  if (existsSync(txtPath)) return readFile(txtPath, 'utf8')

  const url = `${BASE_URL}/${country}.zip`
  process.stdout.write(`  laden ${url} ... `)
  const res = await fetch(url)
  if (!res.ok) {
    process.stdout.write(`HTTP ${res.status}, ueberspringe\n`)
    return null
  }
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const entry = files[`${country}.txt`]
  if (!entry) {
    process.stdout.write('keine Daten\n')
    return null
  }
  const text = new TextDecoder('utf8').decode(entry)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(txtPath, text, 'utf8')
  process.stdout.write('ok\n')
  return text
}

/**
 * geonameId -> Name in der Landessprache. Nur Eintraege mit isPreferredName=1
 * werden uebernommen; ohne dieses Flag ist die Liste voll von Varianten,
 * Ortsteilen und Bahnhofsnamen ("Bahnhof Grenzau").
 */
export async function loadLocalNames(
  countries: readonly string[],
  cacheDir: string,
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>()

  for (const country of countries) {
    const language = LOCAL_LANGUAGES[country]
    if (!language) continue

    const text = await downloadAlternateNames(country, cacheDir)
    if (!text) continue

    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const f = line.split('\t')
      if (f[COL.language] !== language) continue
      if (f[COL.isPreferred] !== '1') continue
      if (f[COL.isColloquial] === '1' || f[COL.isHistoric] === '1') continue

      const id = f[COL.geonameId]
      const name = f[COL.name]
      if (!id || !name) continue

      // Mehrere bevorzugte Varianten: die kuerzeste gewinnt (Kurzform vor Langform).
      const existing = names.get(id)
      if (!existing || name.length < existing.length) names.set(id, name)
    }
  }

  return names
}
