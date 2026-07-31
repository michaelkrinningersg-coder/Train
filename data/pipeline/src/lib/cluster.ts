import { distanceKm } from '@game/geo'
import type { LngLat } from '@game/domain'
import type { GeoNamesPlace } from './geonames.js'

/**
 * GeoNames listet Verwaltungseinheiten, keine Agglomerationen: Berlin, Potsdam und
 * Bernau erscheinen getrennt, London zerfaellt in Boroughs. Ohne Zusammenfassung
 * bekaeme das Spiel Dutzende winziger "Staedte" im Umland jeder Metropole.
 *
 * Siehe docs/05-DATENPIPELINE.md Abschnitt 1.
 */
export const MERGE_RADIUS_KM = 25
/** Erst ab diesem Groessenverhaeltnis gilt ein Ort als Vorort und nicht als eigene Stadt. */
export const MIN_SIZE_RATIO = 2
/** Maximaler Anteil der Einwohner, der dem Zentrum zugeschlagen wird (bei Distanz 0). */
export const ABSORB_SHARE_MAX = 0.6

/**
 * Der zugeschlagene Anteil faellt mit der Entfernung: ein Ort 3 km vom Zentrum ist
 * faktisch ein Stadtteil, ein Ort 20 km entfernt eine eigene Stadt mit eigenem
 * Bahnhof und eigener Pendlerbeziehung. Eine pauschale Quote wuerde Erlangen
 * genauso behandeln wie Unterhaching - und das waere fuer das Spiel falsch.
 */
export function absorbShare(distanceKm: number): number {
  const t = Math.max(0, 1 - distanceKm / MERGE_RADIUS_KM)
  const share = ABSORB_SHARE_MAX * t ** 1.5
  // Unterhalb dieser Schwelle ist der Ort keine Vorstadt mehr, sondern eine
  // eigenstaendige Stadt am Rand des Suchradius. Ohne die Kappung entstuenden
  // Eintraege wie "Fuerstenfeldbruck +107", die nur Rauschen sind.
  return share < 0.05 ? 0 : share
}

export interface ClusteredCity {
  readonly place: GeoNamesPlace
  population: number
  readonly absorbed: { readonly name: string; readonly population: number }[]
}

const posOf = (p: GeoNamesPlace): LngLat => [p.lng, p.lat]

/**
 * Entfernt Doppeleintraege desselben Ortes (GeoNames fuehrt manche Staedte mehrfach,
 * etwa als PPL und als PPLA). Es gewinnt der Eintrag mit der hoechsten Einwohnerzahl.
 */
export function deduplicate(places: readonly GeoNamesPlace[]): GeoNamesPlace[] {
  const sorted = [...places].sort((a, b) => b.population - a.population)
  const kept: GeoNamesPlace[] = []
  for (const p of sorted) {
    const duplicate = kept.some((k) => k.name === p.name && distanceKm(posOf(k), posOf(p)) < 15)
    if (!duplicate) kept.push(p)
  }
  return kept
}

/**
 * Fasst Vororte mit ihrem Zentrum zusammen. Verarbeitung absteigend nach Groesse,
 * dadurch ist jedes bereits etablierte Zentrum garantiert mindestens so gross wie
 * der gerade betrachtete Ort und die Zuordnung ist deterministisch.
 */
export function clusterAgglomerations(places: readonly GeoNamesPlace[], minPopulation: number): ClusteredCity[] {
  const sorted = [...places].sort((a, b) => b.population - a.population || a.name.localeCompare(b.name))
  const centres: ClusteredCity[] = []

  for (const place of sorted) {
    let centre: ClusteredCity | undefined
    let centreDistance = Infinity

    // Das naechstgelegene passende Zentrum gewinnt, nicht das erstbeste.
    for (const candidate of centres) {
      if (candidate.population < place.population * MIN_SIZE_RATIO) continue
      const d = distanceKm(posOf(candidate.place), posOf(place))
      if (d <= MERGE_RADIUS_KM && d < centreDistance) {
        centre = candidate
        centreDistance = d
      }
    }

    if (!centre) {
      centres.push({ place, population: place.population, absorbed: [] })
      continue
    }

    const moved = Math.round(place.population * absorbShare(centreDistance))
    if (moved > 0) {
      centre.population += moved
      centre.absorbed.push({ name: place.name, population: moved })
    }

    // Der Vorort bleibt als eigener Ort bestehen, sofern noch genug Substanz da ist.
    const remaining = place.population - moved
    if (remaining >= minPopulation * 0.6) {
      centres.push({ place, population: remaining, absorbed: [] })
    }
  }

  return centres.sort((a, b) => b.population - a.population)
}
