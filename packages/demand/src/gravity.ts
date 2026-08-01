import { DISTANCE_POWER, SEGMENTS, SEGMENT_IDS } from '@game/domain'
import type { City, CityId, SegmentId } from '@game/domain'
import { distanceKm } from '@game/geo'
import { cityPotentials } from './potentials.js'

/**
 * Stufe 2 des Nachfragemodells: Verteilung ueber ein Gravitationsmodell.
 * Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 3.
 */

/**
 * Abklingfunktion: Potenzterm fuer den steilen Nahbereichsabfall, Exponentialterm
 * gegen die Fernbereichsauslaeufer. Die Untergrenze verhindert die Singularitaet
 * bei d gegen 0.
 */
export function decay(distance: number, segment: SegmentId): number {
  const s = SEGMENTS[segment]
  const d = Math.max(distance, s.minDistanceKm)
  return d ** DISTANCE_POWER * Math.exp(-d / s.decayKm)
}

export interface ODPair {
  readonly from: CityId
  readonly to: CityId
  readonly distanceKm: number
  /** Reisen pro Tag je Segment, Jahresmittel. */
  readonly trips: Readonly<Record<SegmentId, number>>
  readonly totalTrips: number
}

export interface DemandMatrix {
  readonly pairs: readonly ODPair[]
  /** Schneller Zugriff ueber "from|to". */
  readonly byKey: ReadonlyMap<string, ODPair>
  readonly totalTripsPerDay: number
  /**
   * Womit diese Matrix gebaut wurde.
   *
   * Nicht Zierde: aendern sich die Staedte im Lauf des Spiels, muss die Matrix
   * neu gebaut werden - und zwar mit derselben Schwelle wie beim ersten Mal.
   * Sonst waere die Nachfrage nach einem Strukturwandel nicht deshalb anders,
   * weil eine Zeche geschlossen hat, sondern weil ploetzlich mehr Kleinstpaare
   * mitzaehlen.
   */
  readonly minTripsPerDay: number
}

export const odKey = (from: CityId, to: CityId): string => `${from}|${to}`

export interface GravityOptions {
  /** Paare unterhalb dieser Tagesreisenzahl werden verworfen. */
  readonly minTripsPerDay?: number
  /** Monat fuer die Saisonalitaet der Zielattraktivitaet. */
  readonly month?: number
}

/**
 * Baut die gerichtete Nachfragematrix.
 *
 * Die Normierung ueber alle Ziele sorgt dafuer, dass jede Stadt exakt ihr
 * Quellpotenzial verteilt. Dadurch veraendert das Hinzufuegen weiterer Staedte
 * die Gesamtnachfrage nicht, sondern nur ihre Verteilung - genau das, was fuer
 * die spaetere Erweiterung von Bayern auf Europa noetig ist.
 */
/**
 * Baut die gerichtete Nachfragematrix.
 *
 * ## Warum diese Schleife anders aussieht als die Formel
 *
 * Die Rechnung ist quadratisch in der Städtezahl, und die Städtezahl ist von
 * Bayern auf Deutschland um den Faktor elf gewachsen — aus 4 000 Relationen
 * wurden 480 000. In der ersten, geradeaus geschriebenen Fassung dauerte das
 * viereinhalb Sekunden, jedes Mal beim Start und bei jedem Laden eines
 * Spielstands.
 *
 * Drei Dinge machen den Unterschied, keines davon ändert eine einzige Ziffer am
 * Ergebnis:
 *
 * 1. **Die Abklingwerte einer Zeile werden einmal gerechnet.** Nenner und Zähler
 *    brauchen dieselben Werte; vorher rechnete jede Schleife sie neu. Das sind
 *    zwei Millionen Aufrufe von `pow` und `exp` weniger.
 * 2. **Typisierte Felder statt verschachtelter Arrays** für die Distanzen —
 *    zusammenhängender Speicher statt 694 einzelner Objekte.
 * 3. **Die Segmentparameter stehen als Zahlenfelder daneben**, nicht als
 *    Objektzugriff in der innersten Schleife. Bei drei Millionen Durchläufen
 *    kostet ein `SEGMENTS[segment].decayKm` mehr als die Exponentialfunktion.
 *
 * Zwischengespeichert wird bewusst **nur eine Zeile**. Die ganze Abklingmatrix
 * wären bei 694 Städten 23 MB und bei einem europäischen Datensatz einige
 * hundert — der Speicher wäre der nächste Engpass, und zwar ein härterer.
 *
 * Die Normierung über alle Ziele sorgt dafür, dass jede Stadt exakt ihr
 * Quellpotenzial verteilt. Dadurch verändert das Hinzufügen weiterer Städte die
 * Gesamtnachfrage nicht, sondern nur ihre Verteilung — genau das, was für die
 * Erweiterung von Bayern auf Deutschland und später auf Europa nötig ist.
 */
export function buildDemandMatrix(cities: readonly City[], options: GravityOptions = {}): DemandMatrix {
  const minTrips = options.minTripsPerDay ?? 1
  const month = options.month ?? 5

  const potentials = cities.map((c) => c.potential ?? cityPotentials(c, month))

  const n = cities.length
  const segments = SEGMENT_IDS.length

  // Segmentparameter als Zahlenfelder - siehe Punkt 3 im Dateikopf.
  const minDistance = new Float64Array(segments)
  const decayKm = new Float64Array(segments)
  SEGMENT_IDS.forEach((seg, s) => {
    minDistance[s] = SEGMENTS[seg].minDistanceKm
    decayKm[s] = SEGMENTS[seg].decayKm
  })

  // Quell- und Zielpotenziale flach, damit die innerste Schleife nur noch
  // Zahlen liest.
  const origin = new Float64Array(n * segments)
  const destination = new Float64Array(n * segments)
  for (let i = 0; i < n; i++) {
    const pot = potentials[i]
    if (!pot) continue
    SEGMENT_IDS.forEach((seg, s) => {
      origin[i * segments + s] = pot[seg].origin
      destination[i * segments + s] = pot[seg].destination
    })
  }

  // Distanzen einmal vorab: symmetrisch, daher nur die obere Dreiecksmatrix.
  const dist = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = cities[i]
      const b = cities[j]
      if (!a || !b) continue
      const d = distanceKm(a.centre, b.centre)
      dist[i * n + j] = d
      dist[j * n + i] = d
    }
  }

  const pairs: ODPair[] = []
  const byKey = new Map<string, ODPair>()
  let total = 0

  // Abklingwerte der gerade bearbeiteten Zeile, wiederverwendet fuer Nenner und
  // Zaehler.
  const rowDecay = new Float64Array(n * segments)
  const denominator = new Float64Array(segments)

  for (let i = 0; i < n; i++) {
    const from = cities[i]
    if (!from) continue

    denominator.fill(0)
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = dist[i * n + j]!
      // Der Potenzterm haengt nur an der Entfernung, nicht am Segment. Bei
      // Entfernungen ueber allen Mindestwerten - also fast immer - reicht ein
      // `pow` je Staedtepaar statt sechs.
      const power = d ** DISTANCE_POWER
      for (let s = 0; s < segments; s++) {
        const clamped = d > minDistance[s]! ? d : minDistance[s]!
        const value = (clamped === d ? power : clamped ** DISTANCE_POWER) * Math.exp(-clamped / decayKm[s]!)
        rowDecay[j * segments + s] = value
        denominator[s]! += destination[j * segments + s]! * value
      }
    }

    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const to = cities[j]
      if (!to) continue

      const trips = {} as Record<SegmentId, number>
      let pairTotal = 0

      for (let s = 0; s < segments; s++) {
        const denom = denominator[s]!
        const value =
          denom > 0
            ? (origin[i * segments + s]! * destination[j * segments + s]! * rowDecay[j * segments + s]!) / denom
            : 0
        trips[SEGMENT_IDS[s]!] = value
        pairTotal += value
      }

      if (pairTotal < minTrips) continue

      const pair: ODPair = {
        from: from.id,
        to: to.id,
        distanceKm: dist[i * n + j]!,
        trips,
        totalTrips: pairTotal,
      }
      pairs.push(pair)
      byKey.set(odKey(from.id, to.id), pair)
      total += pairTotal
    }
  }

  pairs.sort((a, b) => b.totalTrips - a.totalTrips)
  return { pairs, byKey, totalTripsPerDay: total, minTripsPerDay: minTrips }
}
