import { SEGMENTS } from '@game/domain'
import type { SegmentId } from '@game/domain'

/**
 * Stufe 3 des Nachfragemodells: Verkehrsmittelwahl als multinomiales Logit.
 * Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 4.
 */

export const MODES = ['rail', 'bus', 'car', 'none'] as const
export type Mode = (typeof MODES)[number]

/**
 * Alternativspezifische Konstanten - die Grundneigung eines Segments zu einem
 * Verkehrsmittel, unabhaengig von Preis und Zeit.
 *
 * Diese Tabelle ist der eigentliche Charaktergeber des Spiels: Schueler haben
 * kein Auto, Geschaeftsreisende steigen nicht in den Bus, Touristen sind
 * flexibel. Bewusst reine Daten, damit Balancing ohne Codeaenderung geht.
 */
export const ASC: Readonly<Record<SegmentId, Readonly<Record<Mode, number>>>> = {
  commuter: { rail: 0.3, bus: -1.8, car: 0, none: -2.2 },
  pupil: { rail: 0.9, bus: 0.2, car: -2.5, none: -1.8 },
  student: { rail: 0.6, bus: -0.4, car: -0.9, none: -1.2 },
  business: { rail: 0.7, bus: -2.6, car: 0, none: -0.6 },
  tourist: { rail: 0.45, bus: -1.0, car: 0, none: -0.4 },
  vfr: { rail: 0.1, bus: -1.1, car: 0, none: -0.9 },
}

/** Wartezeit = halber Takt, gedeckelt. Ohne Deckel wuerde ein Tagesrandkurs unendlich schlecht. */
export const MAX_WAIT_SEC = 45 * 60
/** Umsteigezeit zaehlt doppelt, Wartezeit fast doppelt - so misst es die Verkehrsplanung. */
export const TRANSFER_TIME_WEIGHT = 2.0
export const WAIT_TIME_WEIGHT = 1.8
/** Was volle Komfortwertung maximal wert ist, in Euro. */
export const COMFORT_VALUE_EUR = 5

/** Autokosten je km in Cent: Kraftstoff und Verschleiss, ohne Fixkosten. */
export const CAR_COST_PER_KM = 32
/** Umwegfaktor der Strasse gegenueber der Luftlinie. */
export const ROAD_DETOUR = 1.25
export const CAR_SPEED_KMH = 85

export interface Alternative {
  readonly mode: Mode
  /** Fahrpreis in Cent. */
  readonly priceCents: number
  readonly travelTimeSec: number
  /** Bereits gedeckelte Wartezeit; bei Auto null. */
  readonly waitTimeSec: number
  readonly transfers: number
  /** 0..1 */
  readonly comfort: number
}

/**
 * Generalisierte Kosten in Euro. Alle Zeitkomponenten werden ueber den Zeitwert
 * des Segments monetarisiert, damit sie mit dem Fahrpreis vergleichbar sind.
 */
export function generalisedCost(segment: SegmentId, alt: Alternative): number {
  const s = SEGMENTS[segment]
  const votPerHour = s.valueOfTime / 100
  const hours = (t: number): number => t / 3600

  const timeCost =
    votPerHour * (hours(alt.travelTimeSec) + WAIT_TIME_WEIGHT * hours(alt.waitTimeSec))
  const transferCost = votPerHour * TRANSFER_TIME_WEIGHT * hours(s.transferPenaltySec) * alt.transfers
  const comfortBonus = s.comfortWeight * alt.comfort * COMFORT_VALUE_EUR

  return alt.priceCents / 100 + timeCost + transferCost - comfortBonus
}

/**
 * Anteile aller angebotenen Alternativen. Nicht angebotene Verkehrsmittel
 * fehlen einfach in der Eingabe; Auto und "nicht reisen" sollten immer dabei
 * sein, damit die Anteile eine sinnvolle Basis haben.
 */
export function modeShares(segment: SegmentId, alternatives: readonly Alternative[]): Record<Mode, number> {
  const s = SEGMENTS[segment]
  const shares = { rail: 0, bus: 0, car: 0, none: 0 } as Record<Mode, number>
  if (alternatives.length === 0) return shares

  const utilities = alternatives.map((alt) => ASC[segment][alt.mode] + s.priceBeta * generalisedCost(segment, alt))

  // Verschiebung um das Maximum: mathematisch identisch, aber ohne Overflow.
  const max = Math.max(...utilities)
  const exps = utilities.map((u) => Math.exp(u - max))
  const sum = exps.reduce((a, b) => a + b, 0)

  alternatives.forEach((alt, i) => {
    shares[alt.mode] += (exps[i] ?? 0) / sum
  })

  return shares
}

/** Die immer verfuegbare Referenzalternative. */
export function carAlternative(greatCircleKm: number): Alternative {
  const roadKm = greatCircleKm * ROAD_DETOUR
  return {
    mode: 'car',
    priceCents: roadKm * CAR_COST_PER_KM,
    travelTimeSec: (roadKm / CAR_SPEED_KMH) * 3600,
    waitTimeSec: 0,
    transfers: 0,
    comfort: 0.5,
  }
}

/**
 * Bestandsverkehr: der oeffentliche Verkehr, den es ohne den Spieler bereits
 * gibt. Ohne ihn waere die erste Buslinie ein Monopol auf dem gesamten
 * oeffentlichen Verkehr eines Korridors - und damit absurd profitabel.
 *
 * Modelliert als durchschnittliches Regionalbahnangebot: Stundentakt,
 * 90 km/h Reisegeschwindigkeit, 18 Cent je Kilometer. Ab Phase 2 tritt das
 * eigene Netz des Spielers gegen genau dieses Angebot an; uebernimmt er eine
 * Relation vollstaendig, faellt der Bestandsverkehr dort weg.
 */
export const INCUMBENT_FARE_PER_KM = 18
export const INCUMBENT_DETOUR = 1.15

/**
 * Die Qualitaet des Bestandsangebots haengt von der kleineren der beiden Staedte
 * ab: Grossstaedte liegen an Hauptstrecken mit dichtem Takt, Kleinstaedte an
 * Nebenbahnen mit Umstieg und langen Wartezeiten. Ohne diese Staffelung waere
 * zwischen Bayreuth und Hof dasselbe Angebot unterstellt wie zwischen Muenchen
 * und Augsburg - und keine einzige Nebenrelation waere je bedienbar.
 */
const INCUMBENT_TIERS = [
  { minPopulation: 200_000, speedKmh: 95, headwayMin: 60, transfers: 0 },
  { minPopulation: 80_000, speedKmh: 80, headwayMin: 90, transfers: 0 },
  { minPopulation: 40_000, speedKmh: 70, headwayMin: 120, transfers: 1 },
  { minPopulation: 0, speedKmh: 60, headwayMin: 180, transfers: 1 },
] as const

export function incumbentTransit(greatCircleKm: number, smallerCityPopulation: number): Alternative {
  const tier = INCUMBENT_TIERS.find((t) => smallerCityPopulation >= t.minPopulation) ?? INCUMBENT_TIERS[3]
  const routeKm = greatCircleKm * INCUMBENT_DETOUR
  return {
    mode: 'rail',
    priceCents: routeKm * INCUMBENT_FARE_PER_KM,
    travelTimeSec: (routeKm / tier.speedKmh) * 3600,
    waitTimeSec: waitFromHeadway(tier.headwayMin),
    transfers: tier.transfers,
    comfort: 0.55,
  }
}

export const noTravelAlternative: Alternative = {
  mode: 'none',
  priceCents: 0,
  travelTimeSec: 0,
  waitTimeSec: 0,
  transfers: 0,
  comfort: 0,
}

/** Wartezeit aus dem Takt: halber Takt, gedeckelt bei 45 Minuten. */
export function waitFromHeadway(headwayMinutes: number): number {
  return Math.min((headwayMinutes * 60) / 2, MAX_WAIT_SEC)
}
