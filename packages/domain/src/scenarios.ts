import type { Money } from './ids.js'

/**
 * Aufträge: der Grund, überhaupt zu spielen.
 *
 * Bis hierher konnte man bauen, und es rechnete. Was fehlte, war die Frage, auf
 * die das eine Antwort ist. Ein Verkehrsbetrieb ohne Auftrag ist eine
 * Simulation; erst eine Vorgabe mit Frist macht daraus eine Entscheidung — denn
 * eine Entscheidung braucht etwas, das man verlieren kann.
 *
 * ## Warum Ziele und keine Punktzahl
 *
 * Eine Punktzahl würde alles auf eine Achse zwingen und damit genau die
 * Abwägungen einebnen, die das Spiel ausmacht: Takt gegen Kosten, Puffer gegen
 * Reisezeit, Reserve gegen Unterhalt. Ein Auftrag sagt stattdessen, *was* am
 * Ende dastehen soll, und lässt offen, wie man dorthin kommt. Zwei Spieler
 * lösen „verbinde Köln und Berlin und trag dich dabei" auf zwei verschiedene
 * Weisen, und beide haben recht.
 *
 * ## Warum die Ziele aus dem Spielzustand ablesbar sein müssen
 *
 * Jedes Ziel hier ist eine Frage an `GameState` und an das Ergebnis des letzten
 * Betriebstags — nichts wird nebenher mitgeschrieben. Damit übersteht der
 * Fortschritt Speichern und Laden von selbst, und ein geladener Spielstand kann
 * nicht in einen Zustand geraten, den es im Spiel nicht gibt.
 */

/** Städte werden über ihren Namen benannt, nicht über die GeoNames-Kennung. */
export type Goal =
  | { readonly kind: 'daily_passengers'; readonly count: number }
  | { readonly kind: 'daily_profit'; readonly amount: Money }
  | { readonly kind: 'cash'; readonly amount: Money }
  | { readonly kind: 'lines'; readonly count: number; readonly mode?: 'rail' | 'bus' }
  | { readonly kind: 'stations'; readonly count: number }
  | {
      readonly kind: 'connect'
      readonly from: string
      readonly to: string
      /** Wie oft man dabei höchstens umsteigen darf. */
      readonly maxTransfers?: number
    }
  | { readonly kind: 'satisfaction'; readonly value: number }
  | { readonly kind: 'punctuality'; readonly value: number }

export interface Scenario {
  readonly id: string
  readonly title: string
  /** Ein Satz für die Auswahlkarte. */
  readonly summary: string
  /** Was den Spieler erwartet, in zwei bis vier Sätzen. */
  readonly briefing: string
  readonly startingCash: Money
  /**
   * Frist in Tagen. 0 heißt: ohne Frist — dann gibt es nichts zu verlieren und
   * die Ziele sind Wegmarken statt Bedingungen.
   */
  readonly deadlineDays: number
  readonly goals: readonly Goal[]
  /** Hinweise für den Einstieg, in der Reihenfolge, in der sie nützlich sind. */
  readonly hints?: readonly string[]
}

const YEAR = 365

/**
 * Die Aufträge.
 *
 * Bewusst reine Daten und nach Anspruch sortiert. Der erste ist ein Tutorial,
 * das sich nicht so nennt: er stellt genau die vier Handgriffe als Ziele, die
 * man einmal gemacht haben muss — Haltestelle, Fahrzeug, Linie, Fahrgäste.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'first-line',
    title: 'Die erste Linie',
    summary: 'Zwei Haltestellen, ein Bus, hundert Fahrgäste. Der Einstieg.',
    briefing:
      'Sie übernehmen einen Betrieb mit zwei Millionen Euro und keinem einzigen Fahrzeug. ' +
      'Suchen Sie sich zwei Städte, die nah beieinanderliegen und zusammen genug Einwohner ' +
      'haben, bauen Sie dort Haltestellen und lassen Sie einen Bus fahren. Mehr ist es ' +
      'nicht — und mehr braucht es auch nicht, um zu sehen, wie das Spiel rechnet.',
    startingCash: 2_000_000_00,
    deadlineDays: 2 * YEAR,
    goals: [
      { kind: 'stations', count: 2 },
      { kind: 'lines', count: 1 },
      { kind: 'daily_passengers', count: 100 },
    ],
    hints: [
      'Stadt auf der Karte anklicken, dann im Stadtpanel „Haltestelle bauen".',
      'Im Reiter „Fuhrpark" einen Bus kaufen — ein Kleinbus reicht für den Anfang.',
      'Reiter „Linien", dann „Neue Linie": zwei Haltestellen anklicken und anlegen.',
      'Der Linie im Panel ein Fahrzeug zuteilen, sonst fährt sie nicht.',
      'Oben rechts auf ▶ — ohne laufende Uhr passiert nichts.',
    ],
  },

  {
    id: 'ruhr',
    title: 'Pendlerland Ruhr',
    summary: 'Zehn Großstädte auf achtzig Kilometern. Dichte statt Entfernung.',
    briefing:
      'Das Ruhrgebiet ist der dichteste Ballungsraum Deutschlands: Dortmund, Essen, Duisburg ' +
      'und Bochum liegen so nah beieinander, dass jede Fahrt kurz ist — und genau deshalb ' +
      'ist das Auto hier ein harter Gegner. Kurze Wege verzeihen keine Umwege und keine ' +
      'langen Takte. Bauen Sie ein Netz, das trotzdem trägt.',
    startingCash: 8_000_000_00,
    deadlineDays: 4 * YEAR,
    goals: [
      { kind: 'connect', from: 'Duisburg', to: 'Dortmund', maxTransfers: 1 },
      { kind: 'daily_passengers', count: 4_000 },
      { kind: 'daily_profit', amount: 5_000_00 },
      { kind: 'satisfaction', value: 0.85 },
    ],
    hints: [
      'Bei kurzen Entfernungen entscheidet der Takt, nicht die Geschwindigkeit.',
      'Die Zufriedenheit fällt in Tagen und erholt sich in Monaten — lieber gleich genug Kapazität.',
    ],
  },

  {
    id: 'north-south',
    title: 'Die Nord-Süd-Achse',
    summary: 'Hamburg nach München mit der Bahn. Sechs Jahre, viel Geld, große Entfernung.',
    briefing:
      'Achthundert Kilometer, zwei Millionenstädte an den Enden und ein halbes Dutzend ' +
      'Großstädte dazwischen. Auf dieser Länge gewinnt die Bahn gegen das Auto — wenn sie ' +
      'schnell genug ist und der Fahrplan hält. Bauen Sie die Achse, halten Sie sie ' +
      'pünktlich, und lassen Sie sich nicht von den Streckenbaukosten überraschen: ' +
      'sie fallen an, bevor der erste Fahrgast zahlt.',
    startingCash: 400_000_000_00,
    deadlineDays: 6 * YEAR,
    goals: [
      { kind: 'connect', from: 'Hamburg', to: 'München', maxTransfers: 1 },
      { kind: 'lines', count: 2, mode: 'rail' },
      { kind: 'daily_passengers', count: 12_000 },
      { kind: 'punctuality', value: 0.9 },
      { kind: 'daily_profit', amount: 20_000_00 },
    ],
    hints: [
      'Eine eingleisige Fernstrecke trägt keinen dichten Takt — jede Begegnung kostet Wartezeit.',
      'Der Streckenunterhalt läuft, ob ein Zug fährt oder nicht.',
      'Zubringerbusse bringen Relationen, die die Achse allein nicht erreicht.',
    ],
  },

  {
    id: 'free',
    title: 'Freies Spiel',
    summary: 'Ganz Deutschland, keine Frist, keine Vorgabe.',
    briefing:
      'Kein Auftrag, keine Uhr, die gegen Sie läuft. Die Ziele unten sind Wegmarken und ' +
      'keine Bedingungen — Sie können sie ignorieren und trotzdem weiterspielen.',
    startingCash: 20_000_000_00,
    deadlineDays: 0,
    goals: [
      { kind: 'daily_passengers', count: 50_000 },
      { kind: 'cash', amount: 100_000_000_00 },
      { kind: 'lines', count: 20 },
    ],
  },
]

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id)

/** Was gespielt wird, wenn niemand etwas ausgewählt hat. */
export const DEFAULT_SCENARIO_ID = 'first-line'
