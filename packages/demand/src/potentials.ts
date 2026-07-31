import { FACILITY_BOOSTS, SEGMENTS, SEGMENT_IDS } from '@game/domain'
import type { City, SegmentId, SegmentPotential } from '@game/domain'

/**
 * Stufe 1 des Nachfragemodells: Verkehrserzeugung.
 * Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 2.
 */

/**
 * Laenderkorrektur (Studierendenquote, Motorisierung, Urlaubstage). Startwert
 * ueberall 1,0 - die Struktur steht, die Werte kommen mit der Kalibrierung
 * gegen Eurostat.
 */
export const COUNTRY_FACTOR: Readonly<Record<string, Partial<Record<SegmentId, number>>>> = {}

/** Multiplikator aller Einrichtungen einer Stadt fuer ein Segment. */
export function facilityBoost(city: City, segment: SegmentId, month: number): number {
  let factor = 1
  for (const facility of city.facilities) {
    for (const boost of FACILITY_BOOSTS[facility.type]) {
      if (boost.segment !== segment) continue
      factor *= boost.bySize[facility.size - 1] ?? 1
    }
    if (facility.seasonality) {
      factor *= facility.seasonality[month] ?? 1
    }
  }
  return factor
}

/**
 * Quellpotenzial (erzeugte Reisen pro Tag) und Zielattraktivitaet je Segment.
 *
 * Einrichtungen wirken ausschliesslich auf die Zielattraktivitaet: Heidelberg
 * zieht Studenten an, es produziert sie nicht.
 */
export function cityPotentials(city: City, month = 5): Record<SegmentId, SegmentPotential> {
  const out = {} as Record<SegmentId, SegmentPotential>

  for (const id of SEGMENT_IDS) {
    const s = SEGMENTS[id]
    const countryFactor = COUNTRY_FACTOR[city.country]?.[id] ?? 1

    out[id] = {
      origin: city.population * s.populationShare * s.tripsPerPersonDay * countryFactor,
      destination: city.population ** s.destinationExponent * facilityBoost(city, id, month),
    }
  }

  return out
}

export function withPotentials(cities: readonly City[], month = 5): City[] {
  return cities.map((c) => ({ ...c, potential: cityPotentials(c, month) }))
}
