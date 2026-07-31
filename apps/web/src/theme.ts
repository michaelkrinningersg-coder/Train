/**
 * Farbtokens.
 *
 * Die Bedienoberfläche ist immer dunkel - die Karte ist die Bühne. Die Karte
 * selbst kann der Spieler umschalten, und weil eine helle OSM-Karte eine völlig
 * andere Grundfläche ist als der dunkle Spielstil, gibt es zwei geprüfte
 * Markenpaletten statt einer automatisch umgerechneten.
 *
 * Zur Kodierung: die Einwohnerzahl steckt in der *Größe* der Punkte, nicht
 * zusätzlich in der Farbe. Die drei Kartenfarben trennen die drei Datenarten:
 * Städte, Nachfrage, eigenes Netz.
 *
 * Die Wirtschaftlichkeit einer Linie wird bewusst NICHT über Rot/Grün auf der
 * Karte kodiert - dieses Paar ist für Rotgrünblinde nicht unterscheidbar und ein
 * Linienzug trägt keine Beschriftung, die das auffangen könnte. Zahlen und
 * Status stehen in der Seitenleiste, wo Farbe, Zahl und Wort zusammenstehen.
 *
 * Die Auslastung ist der eine Fall, der doch auf die Karte gehört - sie ist eine
 * *Ortsfrage*, und eine Tabelle beantwortet sie nicht. Sie bekommt deshalb keine
 * Rot/Grün-Achse, sondern eine **sequenzielle Rampe mit monoton fallender
 * Helligkeit**: hell heisst leer, dunkel heisst voll. Wer keine Farben
 * unterscheidet, sieht die Reihenfolge trotzdem, und die Strichstaerke sagt
 * dasselbe noch einmal.
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

  city: '#3987e5',
  demand: '#c98500',
  line: '#199e70',

  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
} as const

/** Helligkeit der Basiskarte. Bestimmt, welche Markenpalette greift. */
export type Tone = 'dark' | 'light'

export interface MarkPalette {
  readonly city: string
  readonly demand: string
  readonly line: string
  readonly track: string
  /** Umrandung der Marken - hebt sie gegen beliebige Kartenfarben ab. */
  readonly casing: string
  readonly label: string
  readonly labelHalo: string
  readonly selected: string
  /** Auslastungsrampe: leer bis ueberfuellt, Helligkeit monoton fallend. */
  readonly load: readonly [string, string, string, string]
}

/**
 * Auf einer detaillierten OSM-Karte hat keine einzelne Farbe garantierten
 * Kontrast: der Untergrund reicht von Weiß über Waldgrün bis Wasserblau.
 * Deshalb bekommt jede Linie eine Umrandung in der Gegenfarbe der Karte - das
 * ist die kartografische Standardlösung und wirkt unabhängig davon, worüber die
 * Linie gerade verläuft.
 */
export const MARKS: Readonly<Record<Tone, MarkPalette>> = {
  dark: {
    city: '#3987e5',
    demand: '#c98500',
    line: '#199e70',
    track: '#e6e6e1',
    casing: '#0d0d0d',
    label: '#e8e7df',
    labelHalo: '#0d0d0d',
    selected: '#ffffff',
    load: ['#fff3b0', '#fdbb2d', '#e9642c', '#b01b2e'],
  },
  light: {
    // Eigene Stufen für die helle Fläche, nicht die dunklen umgerechnet.
    city: '#2a78d6',
    demand: '#eb6834',
    line: '#0f7a53',
    track: '#1c1c1a',
    casing: '#ffffff',
    label: '#161615',
    labelHalo: '#ffffff',
    selected: '#0b0b0b',
    // Auf weisser Flaeche faengt die Rampe dunkler an, sonst ist das leere Ende
    // schlicht nicht zu sehen.
    load: ['#d9a441', '#e07b23', '#c22f1c', '#7d1128'],
  },
}

/** Hex -> RGBA-Tupel für deck.gl. */
export function rgba(hex: string, alpha = 255): [number, number, number, number] {
  const v = hex.replace('#', '')
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
    alpha,
  ]
}

/**
 * Farbe einer Auslastung, 0..1+ auf die Rampe abgebildet.
 *
 * Über 100 Prozent bleibt die Farbe am dunklen Ende stehen — der Unterschied
 * zwischen 120 und 180 Prozent ist keiner, den man auf der Karte lesen will.
 * Dass die Grenze überschritten ist, sagt zusätzlich die Strichstärke.
 */
export function loadColor(ramp: MarkPalette['load'], load: number, alpha = 235): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, load))
  const span = ramp.length - 1
  const index = Math.min(span - 1, Math.floor(t * span))
  const local = t * span - index
  const a = rgba(ramp[index]!)
  const b = rgba(ramp[index + 1]!)
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
    alpha,
  ]
}
