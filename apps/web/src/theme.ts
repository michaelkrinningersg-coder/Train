/**
 * Farbtokens. Das Spiel ist bewusst nur dunkel: die Karte ist die Buehne, die
 * Spieldaten sollen leuchten. Die Werte stammen aus der validierten
 * Referenzpalette (dunkle Flaeche #1a1a19).
 *
 * Wichtig zur Kodierung: die Einwohnerzahl wird ueber die *Groesse* der Punkte
 * kodiert, nicht zusaetzlich ueber die Farbe. Doppelte Kodierung derselben
 * Groesse bringt keine Information - und die Farbe wird spaeter fuer den
 * Netzstatus gebraucht (angebunden / nicht angebunden / ueberlastet).
 */
export const THEME = {
  surface: '#1a1a19',
  plane: '#0d0d0d',
  water: '#101014',
  land: '#1f1f1d',
  border: '#383835',

  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  hairline: 'rgba(255, 255, 255, 0.10)',

  /** Staedte. Kategorischer Slot 1 (blau), auf dunkler Flaeche >= 3:1. */
  city: '#3987e5',
  /** Reserviert fuer den zweiten Datenkontext (Slot 2, orange). */
  accent2: '#c98500',

  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
} as const

/** Hex -> RGBA-Tupel fuer deck.gl. */
export function rgba(hex: string, alpha = 255): [number, number, number, number] {
  const v = hex.replace('#', '')
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
    alpha,
  ]
}
