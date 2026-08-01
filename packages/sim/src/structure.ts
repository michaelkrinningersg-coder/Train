import { applyFacilityChange, toDate, type City, type FacilityChange, type GameState } from '@game/domain'
import { roll } from './disruptions.js'

/**
 * Strukturwandel — was aus einer Stadt über Jahrzehnte wird.
 *
 * Bis hierher war die Landkarte eingefroren: dieselben Hochschulen, dieselben
 * Zechen, dasselbe Pendleraufkommen im Jahr 2020 wie 1990. Für ein Spiel, das
 * über dreißig Jahre läuft, ist das die größte verbliebene Unwahrheit im
 * Nachfragemodell. Ein Netz soll nicht einmal richtig gebaut und dann verwaltet
 * werden, sondern **nachziehen müssen**.
 *
 * ## Woher die Ereignisse kommen
 *
 * Nicht aus einem Drehbuch, sondern aus der Stadt selbst. Zwei Kräfte, beide
 * aus der Zeit, in der das Spiel spielt:
 *
 * - **Der große Arbeitgeber.** Er kann abbauen und ganz verschwinden, und er
 *   kann sich anderswo ansiedeln. Das trifft den Pendlerverkehr, also genau
 *   den Verkehr, der ein Netz trägt — und es trifft ihn langsam genug, dass
 *   man umsteuern kann. Das Werk, das zumacht, ist die Geschichte dieser
 *   dreißig Jahre.
 * - **Hochschulausbau.** Mittelgroße Städte ohne Hochschule bekommen eine.
 *   Studentenverkehr ist ein anderes Muster als Pendlerverkehr: andere Zeiten,
 *   andere Ziele, andere Zahlungsbereitschaft.
 *
 * Der Entwurf sah zuerst das Zechensterben über `industrial_cluster` vor. Beim
 * Nachzählen im Datensatz hatte **keine einzige** der 694 deutschen Städte
 * diese Einrichtung — die Pipeline vergibt sie nicht. Ein Modellzweig, der nie
 * feuert, ist schlimmer als keiner, weil ihn niemand vermisst. `major_employer`
 * gibt es 93-mal und es beschreibt dieselbe Kraft.
 *
 * ## Warum jährlich und warum so wenig
 *
 * Gerollt wird am 1. Januar, und es kommen im Mittel gut zwei Ereignisse im
 * Jahr heraus. Häufiger wäre kein Wandel mehr, sondern Rauschen: der Spieler
 * könnte nicht mehr unterscheiden, ob seine Linie schlecht liegt oder ob sich
 * gerade wieder etwas verschoben hat. Über dreißig Jahre summiert sich das
 * trotzdem zu einer spürbar anderen Landkarte.
 *
 * Alles ist aus `(seed, Jahr, Stadt)` gehasht, nie aus `Math.random()` — zwei
 * Läufe desselben Spielstands ergeben denselben Wandel.
 */

/** Ab dieser Einwohnerzahl kommt eine Stadt für eine neue Hochschule infrage. */
export const UNIVERSITY_MIN_POPULATION = 40_000
/** Und ab dieser für eine Ansiedlung. */
export const EMPLOYER_MIN_POPULATION = 50_000

/**
 * Wie wahrscheinlich eine infrage kommende Stadt in einem Jahr getroffen wird.
 *
 * Klein, und das ist der Punkt. Für Deutschland sind das 93 Städte mit großem
 * Arbeitgeber, 126 Kandidaten für eine Hochschule und 114 für eine Ansiedlung —
 * zusammen ergeben die Sätze gut zwei Ereignisse im Jahr.
 */
export const DECLINE_CHANCE_PER_YEAR = 0.008
export const UNIVERSITY_CHANCE_PER_YEAR = 0.004
export const ARRIVAL_CHANCE_PER_YEAR = 0.004

/** Fällt an diesem Tag der Jahreswechsel, an dem gerollt wird? */
export function isStructureDay(day: number): boolean {
  const date = toDate(day)
  return date.month === 0 && date.dayOfMonth === 1
}

/**
 * Der Wandel eines Jahres.
 *
 * Läuft über alle Städte, ist aber billig: ein Hash je Kandidat, einmal im
 * Spieljahr. Für Deutschland sind das 694 Hashes gegen 365 Betriebstage.
 */
export function rollStructuralChanges(state: GameState): FacilityChange[] {
  if (!isStructureDay(state.day)) return []

  const year = toDate(state.day).year
  const changes: FacilityChange[] = []

  for (const city of state.cities.values()) {
    const employer = city.facilities.find((f) => f.type === 'major_employer')

    // Hoechstens ein Ereignis je Stadt und Jahr: zwei Meldungen ueber dieselbe
    // Stadt am selben Tag waeren fuer den Spieler eine einzige Verwirrung.
    if (employer) {
      if (roll(state.seed, year, city.id, 'decline') < DECLINE_CHANCE_PER_YEAR) {
        const size = (employer.size - 1) as 0 | 1 | 2 | 3
        changes.push({
          day: state.day,
          cityId: city.id,
          type: 'major_employer',
          size,
          note:
            size === 0
              ? `${city.name}: das Werk schließt. Die Pendler bleiben weg.`
              : `${city.name}: der große Arbeitgeber baut ab.`,
        })
      }
      continue
    }

    if (
      city.population >= EMPLOYER_MIN_POPULATION &&
      roll(state.seed, year, city.id, 'arrival') < ARRIVAL_CHANCE_PER_YEAR
    ) {
      changes.push({
        day: state.day,
        cityId: city.id,
        type: 'major_employer',
        size: 1,
        note: `${city.name}: ein großer Arbeitgeber siedelt sich an.`,
      })
      continue
    }

    const hasUniversity = city.facilities.some((f) => f.type === 'university')
    if (
      !hasUniversity &&
      city.population >= UNIVERSITY_MIN_POPULATION &&
      roll(state.seed, year, city.id, 'university') < UNIVERSITY_CHANCE_PER_YEAR
    ) {
      changes.push({
        day: state.day,
        cityId: city.id,
        type: 'university',
        size: 1,
        note: `${city.name} bekommt eine Fachhochschule.`,
      })
    }
  }

  return changes
}

/**
 * Städte auf den Stand einer Änderungsliste bringen.
 *
 * Gibt `null` zurück, wenn nichts anzuwenden war — daran erkennt der Aufrufer,
 * dass er sich das Neubauen der Potenziale und der Nachfragematrix sparen kann.
 * Das ist kein Mikrooptimieren: die Matrix zu bauen kostet für Deutschland
 * rund eine Sekunde, und die will man nicht an jedem Betriebstag zahlen.
 */
export function applyChanges(
  cities: ReadonlyMap<City['id'], City>,
  changes: readonly FacilityChange[],
): Map<City['id'], City> | null {
  if (changes.length === 0) return null

  const next = new Map(cities)
  let touched = false
  for (const change of changes) {
    const city = next.get(change.cityId)
    if (!city) continue
    next.set(change.cityId, applyFacilityChange(city, change))
    touched = true
  }
  return touched ? next : null
}
