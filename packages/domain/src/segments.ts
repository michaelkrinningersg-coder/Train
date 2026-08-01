import type { Money } from './ids.js'

/**
 * Reisendensegmente. Jedes Segment hat eine eigene Distanzvorliebe,
 * Zahlungsbereitschaft und Tagesganglinie - siehe docs/03-NACHFRAGEMODELL.md.
 */
export const SEGMENT_IDS = [
  'commuter', // Berufspendler
  'pupil', // Schüler
  'student', // Studenten
  'business', // Geschäftsreisende
  'tourist', // Touristen
  'vfr', // Besuchsreisende (visiting friends & relatives)
] as const

export type SegmentId = (typeof SEGMENT_IDS)[number]

export interface SegmentParams {
  readonly id: SegmentId
  readonly label: string
  /** Anteil der Bevoelkerung, der ueberhaupt zu diesem Segment gehoert. */
  readonly populationShare: number
  /** Reisen pro Person dieses Segments und Tag. */
  readonly tripsPerPersonDay: number
  /** Distanzabklingkonstante d0 in km. */
  readonly decayKm: number
  /** Untergrenze der Distanz, verhindert die Singularitaet bei d -> 0. */
  readonly minDistanceKm: number
  /** Groessendegression omega der Zielattraktivitaet. */
  readonly destinationExponent: number
  /** Zeitwert in Cent pro Stunde. */
  readonly valueOfTime: Money
  /** Preissensitivitaet beta (negativ). */
  readonly priceBeta: number
  /** Umsteigestrafe in Sekunden. */
  readonly transferPenaltySec: number
  /** Gewicht des Komfortnutzens, 0 = egal. */
  readonly comfortWeight: number
}

/**
 * Bewusst als reine Datentabelle, damit Balancing ohne Codeaenderung moeglich
 * ist — `buildDemandMatrix` nimmt eine abweichende Tabelle entgegen, und genau
 * davon lebt `pnpm fernverkehr`.
 *
 * Die drei Fernsegmente sind seit Phase 5h **gemessen** und nicht mehr
 * geschaetzt. Vorher erzeugte das Modell 728 Reisen am Tag zwischen Hamburg und
 * Muenchen ueber alle Verkehrsmittel; damit kann sich keine Fernstrecke je
 * tragen. Kalibriert wurde gegen den Eisenbahn-Fernverkehr 2019 (Destatis:
 * 151,4 Mio. Reisende, 44,7 Mrd. Pkm) und den Modal Split des
 * Umweltbundesamts — siehe `tools/fernverkehr.ts` und
 * docs/03-NACHFRAGEMODELL.md Abschnitt 8.
 *
 * Die uebrigen Werte sind weiterhin Startwerte fuer die Kalibrierung.
 */
export const SEGMENTS: Readonly<Record<SegmentId, SegmentParams>> = {
  commuter: {
    id: 'commuter',
    label: 'Berufspendler',
    populationShare: 0.48,
    tripsPerPersonDay: 0.085,
    decayKm: 35,
    minDistanceKm: 5,
    destinationExponent: 1.15,
    valueOfTime: 1200,
    priceBeta: -0.055,
    transferPenaltySec: 900,
    comfortWeight: 0.1,
  },
  pupil: {
    id: 'pupil',
    label: 'Schüler',
    populationShare: 0.11,
    tripsPerPersonDay: 0.06,
    decayKm: 18,
    minDistanceKm: 3,
    destinationExponent: 0.8,
    valueOfTime: 300,
    priceBeta: -0.14,
    transferPenaltySec: 900,
    comfortWeight: 0,
  },
  student: {
    id: 'student',
    label: 'Studenten',
    populationShare: 0.035,
    tripsPerPersonDay: 0.045,
    decayKm: 160,
    minDistanceKm: 20,
    destinationExponent: 0.6,
    valueOfTime: 500,
    priceBeta: -0.11,
    transferPenaltySec: 480,
    comfortWeight: 0.05,
  },
  business: {
    id: 'business',
    label: 'Geschäftsreisende',
    populationShare: 0.05,
    // 2,2 Geschaeftsreisen je Einwohner und Jahr.
    tripsPerPersonDay: 0.12,
    decayKm: 420,
    minDistanceKm: 40,
    destinationExponent: 1.25,
    valueOfTime: 4500,
    priceBeta: -0.012,
    transferPenaltySec: 1500,
    comfortWeight: 0.6,
  },
  tourist: {
    id: 'tourist',
    label: 'Touristen',
    populationShare: 1.0,
    // 8,8 Reisen je Einwohner und Jahr - Urlaubs- und Kurzreisen zaehlen
    // doppelt, weil Hin- und Rueckfahrt je eine Reise sind.
    tripsPerPersonDay: 0.024,
    decayKm: 600,
    minDistanceKm: 60,
    destinationExponent: 0.55,
    valueOfTime: 800,
    priceBeta: -0.048,
    transferPenaltySec: 480,
    comfortWeight: 0.2,
  },
  vfr: {
    id: 'vfr',
    label: 'Besuchsreisende',
    populationShare: 1.0,
    // 17,5 Besuchsreisen je Einwohner und Jahr, also alle drei Wochen eine.
    tripsPerPersonDay: 0.048,
    decayKm: 260,
    minDistanceKm: 25,
    destinationExponent: 1.0,
    valueOfTime: 900,
    priceBeta: -0.06,
    transferPenaltySec: 900,
    comfortWeight: 0.1,
  },
}

/** Exponent des Potenzterms der Abklingfunktion, siehe docs/03 Abschnitt 3. */
export const DISTANCE_POWER = -0.6
