import type { GameState, Line, TrackSegment, Vehicle } from '@game/domain'

/**
 * Störungen.
 *
 * Bis hierher entstand Verspätung ausschließlich aus dem Fahrplan: zwei Züge,
 * die dieselbe Stelle brauchen. Ein zwanzig Jahre alter Triebwagen auf einer
 * ebenso alten Strecke fuhr so pünktlich wie ein neuer, und der Posten
 * „Fahrzeugunterhalt" im Finanzreiter war eine Zahl ohne Entscheidung dahinter.
 *
 * Eine Störung ist hier kein eigenes Ereignis, sondern **zusätzliche
 * Belegungszeit**: der Zug steht länger auf dem Abschnitt, alles Folgende
 * verschiebt sich. Damit fällt sie in dieselbe Ereignisschleife wie ein zu
 * dichter Takt, und sie trifft eine ausgelastete Strecke härter als eine leere —
 * genau wie in der Wirklichkeit.
 *
 * **Deterministisch trotz Zufall.** Der Würfel ist eine Hashfunktion aus Spiel-
 * seed, Tag und Fahrzeug- beziehungsweise Streckenkennung. Derselbe Spielstand
 * ergibt denselben Tag — sonst wäre ein Spielstand kein Spielstand, sondern eine
 * Wette, und zweimal dasselbe zu laden brächte zwei verschiedene Ergebnisse.
 */

/** Grundwahrscheinlichkeit je Zuglauf, bei neuwertigem Fahrzeug und Strecke. */
export const BASE_FAILURE_RATE = 0.004
/** Ein schrottreifes Fahrzeug fällt so viel häufiger aus wie ein neues. */
export const CONDITION_FACTOR = 12
/** Und eine Strecke am Ende ihrer Lebensdauer. */
export const TRACK_AGE_FACTOR = 3
/** Nach so vielen Jahren gilt eine Strecke als erneuerungsbedürftig. */
export const TRACK_LIFETIME_YEARS = 40

/** Wie lange eine Störung aufhält, in Sekunden. */
export const DISRUPTION_MIN_SEC = 3 * 60
export const DISRUPTION_MAX_SEC = 45 * 60

/**
 * Ein Wert aus [0,1) aus ganzen Zahlen — dieselbe Eingabe, derselbe Wert.
 *
 * Kein `Math.random()`: der Spielzustand muss aus sich heraus reproduzierbar
 * bleiben. Die Mischfunktion ist ein gewöhnlicher 32-Bit-Hash (splitmix-artig);
 * sie muss nicht kryptografisch sein, nur gleichmäßig und billig.
 */
export function roll(...parts: readonly (number | string)[]): number {
  let hash = 0x9e3779b9
  for (const part of parts) {
    const text = typeof part === 'number' ? String(part) : part
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    hash = Math.imul(hash ^ (hash >>> 15), 0x2545f491)
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000
}

/**
 * Störanfälligkeit eines Zuglaufs.
 *
 * Drei Faktoren, alle multiplikativ: Fahrzeugzustand, Streckenalter und
 * Auslastung. Der dritte ist der interessante — eine volle Strecke bietet mehr
 * Gelegenheiten, dass etwas schiefgeht, und sie verzeiht weniger.
 */
export function failureRate(options: {
  readonly condition: number
  readonly trackAgeYears: number
  readonly loadFactor: number
}): number {
  const wear = 1 + CONDITION_FACTOR * (1 - Math.max(0, Math.min(1, options.condition))) ** 2
  const age = 1 + TRACK_AGE_FACTOR * Math.min(1, Math.max(0, options.trackAgeYears) / TRACK_LIFETIME_YEARS)
  const load = 1 + Math.max(0, options.loadFactor - 0.8)
  return BASE_FAILURE_RATE * wear * age * load
}

export function disruptionSeconds(dice: number): number {
  // Kurze Störungen sind häufig, lange selten - deshalb quadratisch verteilt.
  return DISRUPTION_MIN_SEC + (DISRUPTION_MAX_SEC - DISRUPTION_MIN_SEC) * dice ** 2
}

export interface Disruption {
  readonly runId: string
  readonly seconds: number
  readonly cause: 'vehicle' | 'track'
}

/** Mittleres Alter der befahrenen Strecken einer Linie, in Jahren. */
export function lineTrackAgeYears(state: GameState, line: Line): number {
  const tracks = [...state.network.tracks.values()]
  if (tracks.length === 0) return 0
  const used = tracks.filter((t: TrackSegment) => t.readyOnDay <= state.day)
  if (used.length === 0) return 0
  const sum = used.reduce((s, t) => s + (state.day - t.builtOnDay) / 365, 0)
  void line
  return sum / used.length
}

/**
 * Würfelt die Störungen eines Betriebstags.
 *
 * Je Zuglauf einmal. Trifft es, verlängert sich seine Belegung — und was daraus
 * an Folgeverspätung entsteht, rechnet die Ereignisschleife ohnehin schon.
 */
export function rollDisruptions(options: {
  readonly seed: number
  readonly day: number
  readonly runIds: readonly string[]
  readonly vehicle: Vehicle | undefined
  readonly trackAgeYears: number
  readonly loadFactor: number
}): Disruption[] {
  const condition = options.vehicle?.condition ?? 1
  const rate = failureRate({ condition, trackAgeYears: options.trackAgeYears, loadFactor: options.loadFactor })

  const out: Disruption[] = []
  for (const runId of options.runIds) {
    const dice = roll(options.seed, options.day, runId)
    if (dice >= rate) continue
    // Ein zweiter, unabhaengiger Wurf fuer die Dauer - sonst waeren knapp
    // ausgeloeste Stoerungen immer die langen.
    const severity = roll(options.seed, options.day, runId, 'dauer')
    out.push({
      runId,
      seconds: disruptionSeconds(severity),
      cause: condition < 0.6 ? 'vehicle' : 'track',
    })
  }
  return out
}
