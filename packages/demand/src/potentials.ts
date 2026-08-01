import { FACILITY_BOOSTS, SEGMENTS, SEGMENT_IDS } from '@game/domain'
import type { City, SegmentId, SegmentParams, SegmentPotential } from '@game/domain'

/**
 * Die Segmenttabelle, gegen die gerechnet wird.
 *
 * Sie ist überall vorbelegt und muss deshalb nirgends angegeben werden — außer
 * beim Kalibrieren. Dort wird derselbe Datensatz mit hundert Parametersätzen
 * durchgerechnet, und das ginge sonst nur, indem man die Tabelle im Quelltext
 * ändert und neu startet. Genau das versprach ihr Kommentar von Anfang an nicht
 * tun zu müssen.
 */
export type SegmentTable = Readonly<Record<SegmentId, SegmentParams>>

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
export function cityPotentials(
  city: City,
  month = 5,
  params: SegmentTable = SEGMENTS,
): Record<SegmentId, SegmentPotential> {
  const out = {} as Record<SegmentId, SegmentPotential>

  for (const id of SEGMENT_IDS) {
    const s = params[id]
    const countryFactor = COUNTRY_FACTOR[city.country]?.[id] ?? 1

    out[id] = {
      origin: city.population * s.populationShare * s.tripsPerPersonDay * countryFactor,
      destination: city.population ** s.destinationExponent * facilityBoost(city, id, month),
    }
  }

  return out
}

export function withPotentials(cities: readonly City[], month = 5, params: SegmentTable = SEGMENTS): City[] {
  return cities.map((c) => ({ ...c, potential: cityPotentials(c, month, params) }))
}
