/**
 * Spielkalender. Intern zaehlt das Spiel nur ganze Tage seit Spielbeginn - das
 * haelt den Zustand klein und serialisierbar. Reale Daten braucht es fuer die
 * Saisonalitaet (Tourismus, Schulferien) und fuer die Fahrzeugverfuegbarkeit.
 */
export const EPOCH_YEAR = 1990
export const EPOCH_MONTH = 0
export const EPOCH_DAY = 1

const MS_PER_DAY = 86_400_000
const epochMs = Date.UTC(EPOCH_YEAR, EPOCH_MONTH, EPOCH_DAY)

export interface GameDate {
  readonly year: number
  /** 0 = Januar. */
  readonly month: number
  readonly dayOfMonth: number
  /** 0 = Montag, 6 = Sonntag. Bewusst nicht die JS-Konvention mit Sonntag = 0. */
  readonly weekday: number
}

export function toDate(day: number): GameDate {
  const d = new Date(epochMs + day * MS_PER_DAY)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    dayOfMonth: d.getUTCDate(),
    weekday: (d.getUTCDay() + 6) % 7,
  }
}

const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const
const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const

export function formatDate(day: number): string {
  const d = toDate(day)
  return `${WEEKDAY_NAMES[d.weekday]}, ${d.dayOfMonth}. ${MONTH_NAMES[d.month]} ${d.year}`
}

export function formatDateShort(day: number): string {
  const d = toDate(day)
  return `${String(d.dayOfMonth).padStart(2, '0')}.${String(d.month + 1).padStart(2, '0')}.${d.year}`
}

export const isWeekend = (day: number): boolean => toDate(day).weekday >= 5

/** Bitmaske Mo=1 bis So=64 - passend zu ServicePattern.days. */
export const dayBit = (day: number): number => 1 << toDate(day).weekday
