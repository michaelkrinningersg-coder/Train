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
export function buildDemandMatrix(cities: readonly City[], options: GravityOptions = {}): DemandMatrix {
  const minTrips = options.minTripsPerDay ?? 1
  const month = options.month ?? 5

  const potentials = cities.map((c) => c.potential ?? cityPotentials(c, month))

  // Distanzen einmal vorab: symmetrisch, daher nur die obere Dreiecksmatrix.
  const n = cities.length
  const dist: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = cities[i]
      const b = cities[j]
      if (!a || !b) continue
      const d = distanceKm(a.centre, b.centre)
      dist[i]![j] = d
      dist[j]![i] = d
    }
  }

  const pairs: ODPair[] = []
  const byKey = new Map<string, ODPair>()
  let total = 0

  for (let i = 0; i < n; i++) {
    const from = cities[i]
    if (!from) continue

    // Nenner der Normierung je Segment.
    const denominator = {} as Record<SegmentId, number>
    for (const seg of SEGMENT_IDS) denominator[seg] = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const pot = potentials[j]
      if (!pot) continue
      const d = dist[i]![j]!
      for (const seg of SEGMENT_IDS) {
        denominator[seg] += pot[seg].destination * decay(d, seg)
      }
    }

    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const to = cities[j]
      const pot = potentials[j]
      const fromPot = potentials[i]
      if (!to || !pot || !fromPot) continue

      const d = dist[i]![j]!
      const trips = {} as Record<SegmentId, number>
      let pairTotal = 0

      for (const seg of SEGMENT_IDS) {
        const denom = denominator[seg]
        const value = denom > 0 ? (fromPot[seg].origin * pot[seg].destination * decay(d, seg)) / denom : 0
        trips[seg] = value
        pairTotal += value
      }

      if (pairTotal < minTrips) continue

      const pair: ODPair = { from: from.id, to: to.id, distanceKm: d, trips, totalTrips: pairTotal }
      pairs.push(pair)
      byKey.set(odKey(from.id, to.id), pair)
      total += pairTotal
    }
  }

  pairs.sort((a, b) => b.totalTrips - a.totalTrips)
  return { pairs, byKey, totalTripsPerDay: total }
}
