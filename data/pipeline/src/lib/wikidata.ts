/**
 * Wikidata-Abfragen fuer die Einrichtungen der Staedte.
 *
 * Zwei Dinge sind beim Wikidata Query Service anders, als man erwartet, und
 * beide haben hier die Form bestimmt:
 *
 * 1. **Der Geo-Box-Dienst ist langsamer als eine Laenderabfrage.** Die
 *    naheliegende Loesung — `SERVICE wikibase:box` mit der Bounding-Box der
 *    Region — laeuft zuverlaessig in den Timeout. Abgefragt wird deshalb je
 *    Land, und der Ausschnitt wird hier gefiltert. Nebeneffekt: derselbe
 *    Abruf traegt spaeter auch groessere Regionen.
 *
 * 2. **Der Dienst antwortet unregelmaessig.** Zeitueberschreitungen und 502er
 *    sind Normalbetrieb, keine Ausnahme. Deshalb Wiederholungen mit wachsendem
 *    Abstand — und ein Abbruch, der die Pipeline nicht scheitern laesst: ohne
 *    Einrichtungen ist der Datensatz aermer, aber brauchbar.
 */

const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'RailAndRoad/0.1 (Lernprojekt; Datensatzaufbereitung)'

export interface WikidataRow {
  readonly id: string
  readonly name: string
  readonly lng: number
  readonly lat: number
  /** Kennzahl fuer die Groesseneinstufung - Studierende, Beschaeftigte, Besucher. */
  readonly magnitude?: number
}

interface SparqlBinding {
  readonly [key: string]: { readonly value: string } | undefined
}

/** `Point(11.5 48.1)` -> [11.5, 48.1] */
function parsePoint(wkt: string): [number, number] | null {
  const match = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

export async function runQuery(query: string, attempts = 4): Promise<WikidataRow[]> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const json = (await response.json()) as { results: { bindings: SparqlBinding[] } }
      const rows: WikidataRow[] = []
      for (const binding of json.results.bindings) {
        const point = binding['coord']?.value ? parsePoint(binding['coord'].value) : null
        if (!point) continue
        const magnitude = binding['magnitude']?.value ? Number(binding['magnitude'].value) : undefined
        rows.push({
          id: binding['item']?.value.split('/').pop() ?? '?',
          name: binding['itemLabel']?.value ?? '?',
          lng: point[0],
          lat: point[1],
          ...(magnitude !== undefined && Number.isFinite(magnitude) ? { magnitude } : {}),
        })
      }
      return rows
    } catch (error) {
      if (attempt === attempts) {
        console.warn(`  Wikidata antwortet nicht (${(error as Error).message}) - dieser Typ bleibt leer.`)
        return []
      }
      const waitMs = 2000 * 2 ** (attempt - 1)
      console.warn(`  Wikidata: ${(error as Error).message}, neuer Versuch in ${waitMs / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  return []
}

/** ISO-Laendercode -> Wikidata-Entitaet. Nur die Laender der Ausbaustufen. */
export const COUNTRY_ITEMS: Readonly<Record<string, string>> = {
  DE: 'Q183',
  AT: 'Q40',
  CH: 'Q39',
  CZ: 'Q213',
  PL: 'Q36',
  SK: 'Q214',
  HU: 'Q28',
  NL: 'Q55',
  BE: 'Q31',
  LU: 'Q32',
  DK: 'Q35',
  FR: 'Q142',
  IT: 'Q38',
  SI: 'Q215',
}
