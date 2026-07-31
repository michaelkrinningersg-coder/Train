import type { Loan, Money } from '@game/domain'

/**
 * Kredite. Bewusst einfach gehalten: endfaellige Darlehen mit taeglich
 * anfallenden Zinsen und freiwilliger Sondertilgung. Ein Annuitaetenplan
 * brachte fuer das Spielgefuehl nichts, was diese Form nicht auch liefert.
 */

export const BASE_INTEREST_RATE = 0.055
/** Je laenger die Laufzeit, desto teurer. */
export const TERM_RATE_STEP = 0.004

export function interestRateFor(termYears: number): number {
  return BASE_INTEREST_RATE + TERM_RATE_STEP * Math.max(0, termYears - 5)
}

/**
 * Kreditrahmen. Wer schon hoch verschuldet ist, bekommt weniger - das
 * verhindert die Endlosschleife "Kredit nimmt Kredit auf".
 */
export function creditLimit(equity: Money, existingDebt: Money): Money {
  const limit = Math.max(0, Math.round(equity * 1.5) - existingDebt)
  return Math.max(0, limit)
}

export const totalDebt = (loans: readonly Loan[]): Money => loans.reduce((sum, l) => sum + l.principal, 0)

/** Taegliche Zinslast aller Kredite. */
export function dailyInterest(loans: readonly Loan[]): Money {
  return Math.round(loans.reduce((sum, l) => sum + (l.principal * l.interestRate) / 365, 0))
}

/** Faellige Rueckzahlung: am Ende der Laufzeit wird der Rest faellig. */
export function maturedLoans(loans: readonly Loan[], day: number): readonly Loan[] {
  return loans.filter((l) => day >= l.takenOnDay + l.termYears * 365)
}
