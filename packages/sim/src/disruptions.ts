import type { GameState, Line, TrackSegment, Vehicle, VehicleId } from '@game/domain'

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

/**
 * Anteil der Störungen, der am Fahrzeug liegt und nicht an der Strecke.
 *
 * Vorher entschied eine harte Schwelle: unter 60 % Zustand lag es am Fahrzeug,
 * darüber an der Strecke. Als reine Beschriftung einer Warnung ging das durch;
 * seit daran ein Werkstattaufenthalt hängt, nicht mehr — ein Fuhrpark bei 61 %
 * wäre unverwüstlich und einer bei 59 % ständig kaputt. Diese Kante ist keine
 * Entscheidung, die ein Spieler treffen können soll, sondern eine, die er nur
 * verlieren kann.
 *
 * Fünf Prozent bleiben auch bei einem neuen Fahrzeug: es gibt keinen Zustand,
 * in dem nichts kaputtgehen kann.
 */
export function vehicleShare(condition: number): number {
  return Math.max(0.05, 1 - Math.max(0, Math.min(1, condition)))
}

export function disruptionSeconds(dice: number): number {
  // Kurze Störungen sind häufig, lange selten - deshalb quadratisch verteilt.
  return DISRUPTION_MIN_SEC + (DISRUPTION_MAX_SEC - DISRUPTION_MIN_SEC) * dice ** 2
}

/**
 * Ab dieser Störungsdauer bleibt es nicht bei einer Verspätung.
 *
 * Eine Viertelstunde Aufenthalt ist eine Störung, die der Zug aussitzt; eine
 * halbe Stunde ist ein Schaden, mit dem er nicht weiterfährt. Die Schwelle ist
 * gesetzt, nicht gemessen — verteidigen lässt sich, dass es *eine* gibt: ohne
 * sie wäre entweder jede Kleinigkeit ein Werkstattfall oder keiner.
 */
export const BREAKDOWN_THRESHOLD_SEC = 30 * 60

/**
 * Anteil der schweren Fahrzeugstörungen, nach denen der Zug wirklich stehen
 * bleibt.
 *
 * Ohne diesen dritten Wurf wäre jede fünfte Störung eines gealterten Fahrzeugs
 * ein Werkstattfall — bei zwei Störungen am Tag also alle zweieinhalb Tage
 * einer. Ein zehn Jahre alter Triebwagen fällt nicht alle zweieinhalb Tage aus.
 * Der Anteil ist auf Betriebsjahre kalibriert: rund 3 Schäden im Jahr bei 60 %
 * Zustand, rund 14 bei 30 %, bezogen auf einen Umlauf von sechs Fahrzeugen im
 * Halbstundentakt (siehe `pnpm calibrate`, Abschnitt 7).
 */
export const BREAKDOWN_SHARE = 0.12

/** Kürzeste Reparaturdauer — ein Tag Diagnose, ein Tag Arbeit. */
export const BREAKDOWN_MIN_DAYS = 2
/** Und die längste, bei einem heruntergefahrenen Fahrzeug. */
export const BREAKDOWN_MAX_DAYS = 24

/**
 * Wie lange ein Schaden das Fahrzeug festhält.
 *
 * Zwei Faktoren: wie schwer die Störung war, und in welchem Zustand das Fahrzeug
 * ist. Der zweite ist der wichtigere — an einem gepflegten Fahrzeug ist ein
 * Schaden ein Schaden, an einem heruntergefahrenen kommt beim Zerlegen das
 * nächste zum Vorschein.
 */
export function breakdownDays(seconds: number, condition: number): number {
  const severity = Math.min(1, Math.max(0, seconds - BREAKDOWN_THRESHOLD_SEC) / (DISRUPTION_MAX_SEC - BREAKDOWN_THRESHOLD_SEC))
  const wear = 1 - Math.max(0, Math.min(1, condition))
  const span = BREAKDOWN_MAX_DAYS - BREAKDOWN_MIN_DAYS
  return Math.round(BREAKDOWN_MIN_DAYS + span * (0.35 * severity + 0.65 * wear))
}

export interface Disruption {
  readonly runId: string
  readonly seconds: number
  readonly cause: 'vehicle' | 'track'
  /** Welches Fahrzeug es getroffen hat — für den Werkstattfall. */
  readonly vehicleId: VehicleId | null
  /**
   * Tage in der Werkstatt, 0 wenn der Zug weiterfahren konnte.
   *
   * Erst hiermit bekommt die Reserve ihren Zweck: bis jetzt ging ein Fahrzeug
   * nur freiwillig ins Werk, und wer ein Ersatzfahrzeug vorhielt, hielt es für
   * einen Fall vor, der nie eintrat.
   */
  readonly workshopDays: number
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
 * Je Zuglauf einmal, und je Zuglauf mit **seinem** Fahrzeug. Das war vorher
 * anders: der Zustand des ersten Fahrzeugs galt für alle Läufe der Linie. Damit
 * ließ sich ein schrottreifer Zug hinter fünf guten verstecken, und ein einzelner
 * Werkstattfall wäre nicht zuzuordnen gewesen.
 *
 * Trifft es, verlängert sich die Belegung — und was daraus an Folgeverspätung
 * entsteht, rechnet die Ereignisschleife ohnehin schon. Ist die Störung schwer
 * genug und liegt sie am Fahrzeug, fährt es überhaupt nicht weiter.
 */
export function rollDisruptions(options: {
  readonly seed: number
  readonly day: number
  readonly runs: readonly { readonly id: string; readonly vehicleId: VehicleId | null }[]
  readonly vehicleOf: (id: VehicleId) => Vehicle | undefined
  readonly trackAgeYears: number
  readonly loadFactor: number
}): Disruption[] {
  const out: Disruption[] = []
  // Ein Fahrzeug faehrt mehrere Laeufe am Tag. Der erste Schaden nimmt es aus
  // dem Verkehr - danach kann es nicht noch einmal liegenbleiben.
  const broken = new Set<VehicleId>()

  for (const run of options.runs) {
    const vehicle = run.vehicleId ? options.vehicleOf(run.vehicleId) : undefined
    const condition = vehicle?.condition ?? 1
    const rate = failureRate({ condition, trackAgeYears: options.trackAgeYears, loadFactor: options.loadFactor })

    const dice = roll(options.seed, options.day, run.id)
    if (dice >= rate) continue
    // Ein zweiter, unabhaengiger Wurf fuer die Dauer - sonst waeren knapp
    // ausgeloeste Stoerungen immer die langen.
    const severity = roll(options.seed, options.day, run.id, 'dauer')
    const seconds = disruptionSeconds(severity)
    const cause = roll(options.seed, options.day, run.id, 'ursache') < vehicleShare(condition) ? 'vehicle' : 'track'

    // Der dritte Wurf: liegt der Zug wirklich, oder faehrt er weiter? Ohne ihn
    // waere jede fuenfte Stoerung eines gealterten Fahrzeugs ein Werkstattfall.
    const breaks =
      cause === 'vehicle' &&
      seconds >= BREAKDOWN_THRESHOLD_SEC &&
      vehicle !== undefined &&
      !broken.has(vehicle.id) &&
      roll(options.seed, options.day, run.id, 'schaden') < BREAKDOWN_SHARE
    if (breaks) broken.add(vehicle.id)

    out.push({
      runId: run.id,
      seconds,
      cause,
      vehicleId: run.vehicleId,
      workshopDays: breaks ? breakdownDays(seconds, condition) : 0,
    })
  }
  return out
}
