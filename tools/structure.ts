import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toDate, type City, type GameState } from '@game/domain'
import { buildDemandMatrix, withPotentials } from '@game/demand'
import { advanceDays, createGame, rollStructuralChanges, UNIVERSITY_MIN_POPULATION } from '@game/sim'

/**
 * Wie viel Strukturwandel kommt in dreißig Jahren zusammen?
 *
 * Die Rate ist eine Zahl, die man nicht raten sollte: zu klein, und der Wandel
 * ist eine Fußnote, die kein Spieler je bemerkt; zu groß, und das Netz ist nie
 * fertig, weil sich ständig irgendwo etwas verschiebt. Dieses Werkzeug spielt
 * die Jahre durch und zählt.
 *
 * Aufruf: `pnpm structure`
 */

const seed = join(fileURLToPath(new URL('../data/seed', import.meta.url)))
const data = JSON.parse(readFileSync(join(seed, 'cities.germany.json'), 'utf8')) as { cities: City[] }
const cities: City[] = withPotentials(data.cities)
const demand = buildDemandMatrix(cities, { minTripsPerDay: 1 })

const employers = cities.filter((c) => c.facilities.some((f) => f.type === 'major_employer'))
const candidates = cities.filter(
  (c) => c.population >= UNIVERSITY_MIN_POPULATION && !c.facilities.some((f) => f.type === 'university'),
)
console.log(
  `${cities.length} Städte · ${employers.length} mit großem Arbeitgeber · ${candidates.length} ohne Hochschule\n`,
)

// Ohne Linien: hier interessiert allein der Wandel, nicht der Betrieb.
let state: GameState = createGame({ cities, startingCash: 0 })
const YEARS = 30

const byYear: { year: number; notes: string[] }[] = []
for (let y = 0; y < YEARS; y++) {
  const before = state.facilityChanges.length
  state = advanceDays(state, demand, 365)
  const fresh = state.facilityChanges.slice(before)
  if (fresh.length > 0) byYear.push({ year: toDate(state.day).year, notes: fresh.map((f) => f.note) })
}

for (const { year, notes } of byYear) console.log(`${year}  ${notes.join(' | ')}`)

const total = state.facilityChanges.length
const closures = state.facilityChanges.filter((c) => c.type === 'major_employer' && c.size === 0).length
const shrinks = state.facilityChanges.filter((c) => c.type === 'major_employer' && c.size > 0).length
const universities = state.facilityChanges.filter((c) => c.type === 'university').length
console.log(
  `\n${total} Ereignisse in ${YEARS} Jahren (${(total / YEARS).toFixed(1)} je Jahr) · ` +
    `${closures} Schließungen · ${shrinks} Ab- und Ansiedlungen · ${universities} neue Hochschulen`,
)

// Wirkt der Wandel auch? Eine Aenderung, die die Nachfrage nicht bewegt, waere
// eine Meldung ohne Inhalt.
const after = buildDemandMatrix(withPotentials([...state.cities.values()]), { minTripsPerDay: 1 })
console.log(
  `\nNachfrage insgesamt: ${Math.round(demand.totalTripsPerDay).toLocaleString('de-DE')} → ` +
    `${Math.round(after.totalTripsPerDay).toLocaleString('de-DE')} Reisen/Tag`,
)

const closed = state.facilityChanges.find((c) => c.type === 'major_employer' && c.size === 0)
if (closed) {
  const name = cities.find((c) => c.id === closed.cityId)?.name ?? String(closed.cityId)
  const into = (m: typeof demand): number =>
    m.pairs.filter((p) => p.to === closed.cityId).reduce((s, p) => s + p.trips.commuter, 0)
  console.log(`Einpendler nach ${name}: ${Math.round(into(demand))} → ${Math.round(into(after))} je Tag`)
}

// Gegenprobe auf Reproduzierbarkeit: derselbe Tag, derselbe Wurf.
const again = rollStructuralChanges({ ...state, day: state.day })
const twice = rollStructuralChanges({ ...state, day: state.day })
console.log(
  `Reproduzierbar: ${JSON.stringify(again) === JSON.stringify(twice) ? 'ja' : 'NEIN — der Wurf ist nicht deterministisch'}`,
)
