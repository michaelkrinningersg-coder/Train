/**
 * Farbtokens. Das Spiel ist bewusst nur dunkel: die Karte ist die Buehne, die
 * Spieldaten sollen leuchten. Die Werte stammen aus der validierten
 * Referenzpalette (dunkle Flaeche #1a1a19).
 *
 * Wichtig zur Kodierung: die Einwohnerzahl wird ueber die *Groesse* der Punkte
 * kodiert, nicht zusaetzlich ueber die Farbe. Die drei Kartenfarben trennen
 * stattdessen die drei Datenarten: Staedte (blau), Nachfrage (orange), eigenes
 * Netz (aqua). Als Satz gegen die dunkle Flaeche geprueft.
 *
 * Die Wirtschaftlichkeit einer Linie wird bewusst NICHT ueber Rot/Gruen auf der
 * Karte kodiert - dieses Paar ist fuer Rotgruenblinde nicht unterscheidbar und
 * ein Linienzug traegt keine Beschriftung, die das auffangen koennte. Zahlen und
 * Status stehen in der Seitenleiste, wo Farbe, Zahl und Wort zusammenstehen.
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
  /** Nachfrage-Overlay (Slot 2, orange). */
  demand: '#c98500',
  /** Eigenes Liniennetz (Slot 3, aqua). */
  line: '#199e70',

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
