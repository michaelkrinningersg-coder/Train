import type { LedgerEntry, Money } from '@game/domain'

/**
 * Das Journal ist die einzige Wahrheit ueber Geld. Der Kontostand wird daraus
 * fortgeschrieben, nicht daneben gefuehrt - so kann Anzeige und Kasse nicht
 * auseinanderlaufen.
 */

/** Wie viele Tage Journal vorgehalten werden. Aelteres interessiert niemanden mehr. */
export const LEDGER_HISTORY_DAYS = 400

export function trimLedger(entries: readonly LedgerEntry[], currentDay: number): readonly LedgerEntry[] {
  const cutoff = currentDay - LEDGER_HISTORY_DAYS
  return entries.filter((e) => e.day >= cutoff)
}

export const sumEntries = (entries: readonly LedgerEntry[]): Money => entries.reduce((s, e) => s + e.amount, 0)

export function sumByCategory(entries: readonly LedgerEntry[]): Record<string, Money> {
  const out: Record<string, Money> = {}
  for (const e of entries) out[e.category] = (out[e.category] ?? 0) + e.amount
  return out
}

export function entriesForDays(entries: readonly LedgerEntry[], fromDay: number, toDay: number): LedgerEntry[] {
  return entries.filter((e) => e.day >= fromDay && e.day <= toDay)
}

/** Euro-Betrag aus Cent, fuer die Anzeige. */
export function formatMoney(cents: Money, options: { readonly compact?: boolean } = {}): string {
  const euro = cents / 100
  if (options.compact) {
    const abs = Math.abs(euro)
    if (abs >= 1_000_000) return `${(euro / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Mio. €`
    if (abs >= 10_000) return `${(euro / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Tsd. €`
  }
  return `${euro.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`
}
