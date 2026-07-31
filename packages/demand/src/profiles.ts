import { SEGMENT_IDS } from '@game/domain'
import type { SegmentId } from '@game/domain'

/**
 * Tages-, Wochen- und Jahresganglinien je Segment.
 * Siehe docs/03-NACHFRAGEMODELL.md Abschnitt 5.
 *
 * Diese Tabellen sind der Grund, warum der Spieler seinen Fahrplan an die
 * Nachfrage anpassen muss, statt starr durchzutakten: ein Bus um 3 Uhr nachts
 * findet niemanden.
 */

const normalise = (values: readonly number[]): readonly number[] => {
  const sum = values.reduce((a, b) => a + b, 0)
  return sum > 0 ? values.map((v) => v / sum) : values.map(() => 0)
}

/** Stundenanteile 0-23, Summe 1. */
export const HOURLY_PROFILE: Readonly<Record<SegmentId, readonly number[]>> = {
  // Zwei scharfe Spitzen, dazwischen fast nichts.
  commuter: normalise([0, 0, 0, 0, 1, 4, 14, 20, 12, 5, 3, 3, 3, 4, 5, 8, 15, 18, 11, 5, 2, 1, 0, 0]),
  // Hinweg in einer Stunde, Rueckweg ueber den fruehen Nachmittag verteilt.
  pupil: normalise([0, 0, 0, 0, 0, 1, 8, 30, 10, 1, 1, 1, 4, 14, 12, 9, 5, 2, 1, 0, 0, 0, 0, 0]),
  student: normalise([0, 0, 0, 0, 0, 1, 3, 6, 8, 8, 7, 7, 7, 8, 9, 10, 10, 9, 7, 5, 3, 2, 1, 0]),
  // Flacher als bei Pendlern: Geschaeftsreisen verteilen sich ueber den Tag.
  business: normalise([0, 0, 0, 0, 1, 4, 9, 12, 10, 7, 6, 5, 5, 5, 6, 7, 9, 10, 8, 5, 3, 1, 0, 0]),
  tourist: normalise([0, 0, 0, 0, 0, 1, 3, 5, 8, 10, 11, 10, 9, 9, 8, 8, 7, 5, 3, 2, 1, 0, 0, 0]),
  vfr: normalise([0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 8, 8, 8, 8, 9, 9, 9, 8, 6, 3, 2, 1, 0, 0]),
}

/** Wochentagsfaktoren, Index 0 = Montag. */
export const WEEKDAY_FACTOR: Readonly<Record<SegmentId, readonly number[]>> = {
  commuter: [1.05, 1.08, 1.08, 1.06, 0.95, 0.18, 0.1],
  pupil: [1.0, 1.0, 1.0, 1.0, 0.95, 0.05, 0.0],
  // Semesterrhythmus: Freitag hin, Sonntag zurueck.
  student: [0.9, 0.85, 0.85, 0.95, 1.5, 0.8, 1.3],
  business: [1.05, 1.2, 1.2, 1.15, 0.85, 0.25, 0.3],
  tourist: [0.75, 0.7, 0.75, 0.85, 1.15, 1.6, 1.4],
  vfr: [0.7, 0.65, 0.7, 0.8, 1.4, 1.5, 1.35],
}

/** Monatsfaktoren, Index 0 = Januar. */
export const MONTH_FACTOR: Readonly<Record<SegmentId, readonly number[]>> = {
  commuter: [0.98, 1.0, 1.02, 1.0, 1.0, 0.98, 0.9, 0.88, 1.02, 1.02, 1.0, 0.85],
  // Sommerferien.
  pupil: [1.0, 1.0, 1.0, 0.9, 1.0, 0.95, 0.25, 0.15, 0.95, 1.0, 1.0, 0.6],
  // Vorlesungsfreie Zeit.
  student: [1.05, 0.8, 0.5, 1.0, 1.1, 1.1, 0.9, 0.45, 0.6, 1.1, 1.15, 0.8],
  business: [0.95, 1.05, 1.1, 1.05, 1.05, 1.05, 0.8, 0.7, 1.1, 1.1, 1.05, 0.8],
  tourist: [0.5, 0.55, 0.7, 0.9, 1.15, 1.5, 1.9, 2.2, 1.4, 1.0, 0.5, 0.7],
  vfr: [0.85, 0.85, 0.95, 1.05, 1.05, 1.05, 1.15, 1.15, 1.0, 1.0, 0.9, 1.4],
}

export function hourShare(segment: SegmentId, hour: number): number {
  return HOURLY_PROFILE[segment][hour] ?? 0
}

/** Kombinierter Wochen- und Jahresfaktor eines Tages. */
export function dayFactor(segment: SegmentId, weekday: number, month: number): number {
  return (WEEKDAY_FACTOR[segment][weekday] ?? 1) * (MONTH_FACTOR[segment][month] ?? 1)
}

/** Prueft beim Start, dass keine Tabelle versehentlich unvollstaendig ist. */
export function assertProfilesConsistent(): void {
  for (const seg of SEGMENT_IDS) {
    if (HOURLY_PROFILE[seg].length !== 24) throw new Error(`Stundenprofil ${seg} hat nicht 24 Werte`)
    if (WEEKDAY_FACTOR[seg].length !== 7) throw new Error(`Wochenprofil ${seg} hat nicht 7 Werte`)
    if (MONTH_FACTOR[seg].length !== 12) throw new Error(`Monatsprofil ${seg} hat nicht 12 Werte`)
  }
}
