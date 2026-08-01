import type { CityId, LngLat } from './ids.js'
import type { SegmentId } from './segments.js'

export const FACILITY_TYPES = [
  'university',
  'school_centre',
  'landmark',
  'nature',
  'theme_park',
  'major_employer',
  'industrial_cluster',
  'finance_hub',
  'trade_fair',
  'capital',
  'airport_hub',
] as const

export type FacilityType = (typeof FACILITY_TYPES)[number]

/** Klartext fuer die Anzeige. */
export const FACILITY_LABELS: Readonly<Record<FacilityType, string>> = {
  university: 'Hochschule',
  school_centre: 'Schulzentrum',
  landmark: 'Sehenswürdigkeiten',
  nature: 'Naturziel',
  theme_park: 'Freizeitpark',
  major_employer: 'Großer Arbeitgeber',
  industrial_cluster: 'Industriestandort',
  finance_hub: 'Finanzplatz',
  trade_fair: 'Messestandort',
  capital: 'Landeshauptstadt',
  airport_hub: 'Flughafen',
}

/** Groessenstufe als Wort - „Stufe 2" sagt niemandem etwas. */
export const FACILITY_SIZE_LABELS: readonly [string, string, string] = ['klein', 'bedeutend', 'herausragend']

export interface Facility {
  readonly type: FacilityType
  readonly size: 1 | 2 | 3
  readonly name?: string
  /** Monatsindex 0-11 -> Multiplikator, fuer saisonale Ziele (Skigebiet, Messe). */
  readonly seasonality?: readonly number[]
}

/**
 * Einrichtungsfaktoren wirken ausschliesslich auf die Zielattraktivitaet.
 * Heidelberg zieht Studenten an, es produziert sie nicht.
 */
export const FACILITY_BOOSTS: Readonly<
  Record<FacilityType, { readonly segment: SegmentId; readonly bySize: readonly [number, number, number] }[]>
> = {
  university: [{ segment: 'student', bySize: [1.6, 2.6, 4.0] }],
  school_centre: [{ segment: 'pupil', bySize: [1.3, 1.8, 2.4] }],
  landmark: [{ segment: 'tourist', bySize: [1.5, 2.5, 4.5] }],
  nature: [{ segment: 'tourist', bySize: [1.4, 2.2, 3.5] }],
  theme_park: [{ segment: 'tourist', bySize: [1.5, 2.0, 3.0] }],
  major_employer: [{ segment: 'commuter', bySize: [1.3, 1.8, 2.5] }],
  industrial_cluster: [{ segment: 'commuter', bySize: [1.4, 2.0, 2.8] }],
  finance_hub: [{ segment: 'business', bySize: [1.8, 2.8, 4.0] }],
  trade_fair: [{ segment: 'business', bySize: [1.4, 2.2, 3.2] }],
  capital: [{ segment: 'business', bySize: [1.5, 1.5, 1.5] }],
  airport_hub: [
    { segment: 'tourist', bySize: [1.3, 1.45, 1.6] },
    { segment: 'business', bySize: [1.3, 1.45, 1.6] },
  ],
}

export interface SegmentPotential {
  /** Reisen pro Tag, die diese Stadt in diesem Segment erzeugt. */
  readonly origin: number
  /** Dimensionslose Zielattraktivitaet. */
  readonly destination: number
}

export interface City {
  readonly id: CityId
  readonly name: string
  /** ISO 3166-1 alpha-2. */
  readonly country: string
  /** Erste Verwaltungsebene (GeoNames admin1), z. B. '02' fuer Bayern. */
  readonly admin1?: string
  readonly centre: LngLat
  readonly population: number
  /** Abgeleitet aus population, bestimmt das Einzugsgebiet eines Bahnhofs. */
  readonly radiusKm: number
  readonly facilities: readonly Facility[]
  /** Vorberechnet in der Datenpipeline, siehe docs/03-NACHFRAGEMODELL.md. */
  readonly potential?: Readonly<Record<SegmentId, SegmentPotential>>
  /** Orte, deren Einwohner dieser Stadt teilweise zugeschlagen wurden. */
  readonly absorbed?: readonly { readonly name: string; readonly population: number }[]
}

/**
 * Eine Einrichtung, die entsteht, wächst oder verschwindet.
 *
 * Ein Spiel läuft über Jahrzehnte, und in Jahrzehnten ändert sich, wofür eine
 * Stadt gut ist. Das Zechensterben im Ruhrgebiet und der Ausbau der
 * Fachhochschulen sind keine Randnotiz, sondern genau die Kräfte, die eine
 * Relation aufblühen oder verdorren lassen — und ein Netz, das darauf nicht
 * reagiert, ist nach zwanzig Jahren am Bedarf vorbei gebaut.
 *
 * Der Wandel steht als **Liste von Ereignissen** im Spielstand und nicht als
 * veränderte Städteliste. Das hat zwei Gründe: die Liste ist winzig, während
 * die Städte ein Drittel des Zustands ausmachen — und Haupt- und Rechenthread
 * halten ihre Städte getrennt, können aber dieselbe Liste anwenden und kommen
 * damit garantiert auf denselben Stand.
 */
export interface FacilityChange {
  readonly day: number
  readonly cityId: CityId
  readonly type: FacilityType
  /** Neue Größe. **0 bedeutet: die Einrichtung verschwindet.** */
  readonly size: 0 | 1 | 2 | 3
  /** Was in der Meldung steht. */
  readonly note: string
}

/**
 * Einen Wandel auf eine Stadt anwenden. Reine Funktion, beide Threads rufen
 * sie mit derselben Liste auf.
 */
export function applyFacilityChange(city: City, change: FacilityChange): City {
  const rest = city.facilities.filter((f) => f.type !== change.type)
  if (change.size === 0) return { ...city, facilities: rest }

  const existing = city.facilities.find((f) => f.type === change.type)
  const facility: Facility = existing
    ? { ...existing, size: change.size }
    : { type: change.type, size: change.size }
  return { ...city, facilities: [...rest, facility] }
}

/**
 * Stadtradius aus der Einwohnerzahl. ~7 km bei 100k, ~22 km bei 1 Mio.
 * Siehe docs/05-DATENPIPELINE.md Abschnitt 1.
 */
export function cityRadiusKm(population: number): number {
  return 1.2 * Math.sqrt(Math.max(population, 1) / 3000)
}
