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

/**
 * Startaufstellung eines Auftrags.
 *
 * Städte stehen mit **Namen** darin und nicht mit Kennungen: ein Auftrag ist
 * ein Text, den ein Mensch schreibt, und `gn:2867714` schreibt niemand
 * absichtlich. Aufgelöst wird beim Start gegen den geladenen Datensatz; was
 * dort fehlt, wird übersprungen statt den Start zu verhindern.
 *
 * Die Aufstellung ist **kostenlos**: sie wird angewandt und danach der
 * Kontostand auf das Startkapital gesetzt. Sonst müsste jeder Auftrag mit
 * Baukosten rechnen, die sich mit dem Gelände ändern.
 */
export interface ScenarioSetup {
  readonly busStops?: readonly string[]
  readonly railStations?: readonly string[]
  /** Strecken zwischen je zwei Bahnhöfen, in dieser Reihenfolge. */
  readonly railLinks?: readonly (readonly [string, string])[]
  readonly lines?: readonly ScenarioLine[]
}

export interface ScenarioLine {
  readonly name: string
  readonly mode: 'bus' | 'rail'
  /** Städtenamen in Fahrtreihenfolge. */
  readonly stops: readonly string[]
  readonly headwayMinutes: number
  readonly vehicleClassId: string
  readonly vehicles: number
}

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
  /** Was schon steht, wenn der Auftrag einzeln begonnen wird. */
  readonly setup?: ScenarioSetup
  /**
   * Zuschuss beim Übergang aus einem vorigen Auftrag.
   *
   * Im Feldzug bleiben Netz und Kasse erhalten — `startingCash` wäre dort
   * falsch, weil es das Erwirtschaftete ersetzen statt ergänzen würde. Der
   * Zuschuss ist das, was der Auftraggeber für die neue Aufgabe dazugibt.
   */
  readonly grant?: Money
}

/**
 * Ein Feldzug: mehrere Aufträge nacheinander, auf demselben Netz.
 *
 * Der Unterschied zu vier einzelnen Aufträgen ist nicht die Reihenfolge,
 * sondern dass **nichts weggeräumt wird**. Was im ersten Auftrag entstanden
 * ist, steht im zweiten noch da — mitsamt den Fahrzeugen, die inzwischen
 * gealtert sind, und den Schulden, die man aufgenommen hat. Erst dadurch wird
 * aus einer Aufgabe eine Vorgeschichte.
 */
export interface Campaign {
  readonly id: string
  readonly title: string
  readonly summary: string
  /** Auftragskennungen in der Reihenfolge, in der sie zu spielen sind. */
  readonly steps: readonly string[]
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
    deadlineDays: 3 * YEAR,
    // Nachgerechnet mit `pnpm missions`: eine Achse im Halbstundentakt bringt
    // 2 713 Fahrgaeste und 8 794 € am Tag, dieselbe Achse im Viertelstundentakt
    // mit Suedast 6 996 und 23 000 €. Die Ziele liegen dazwischen - die knappe
    // Loesung scheitert, die ordentliche kommt durch.
    goals: [
      { kind: 'connect', from: 'Duisburg', to: 'Dortmund', maxTransfers: 1 },
      { kind: 'daily_passengers', count: 4_000 },
      { kind: 'daily_profit', amount: 15_000_00 },
      { kind: 'satisfaction', value: 0.9 },
    ],
    hints: [
      'Bei kurzen Entfernungen entscheidet der Takt, nicht die Geschwindigkeit.',
      'Die Zufriedenheit fällt in Tagen und erholt sich in Monaten — lieber gleich genug Kapazität.',
    ],
    // Die vier Kernstaedte stehen schon. Sie im Ruhrklumpen von Hand zu treffen
    // ist Fummelarbeit und keine Entscheidung.
    setup: { busStops: ['Duisburg', 'Essen', 'Bochum', 'Dortmund'] },
    grant: 6_000_000_00,
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
    // 753 km zweigleisig elektrisch kosten 4 539 Mio. €, dazu Zuege und
    // Reserve. Mit den urspruenglichen 400 Mio. reichte es fuer *einen*
    // Abschnitt - der Auftrag war unloesbar, und aufgefallen ist es erst, als
    // ihn jemand nachgerechnet hat.
    startingCash: 7_000_000_000_00,
    deadlineDays: 6 * YEAR,
    /**
     * Alle vier Ziele sind gemessen (`pnpm missions`), und jedes trennt:
     *
     * - **Puenktlichkeit** erzwingt zweigleisig. Eingleisig ueber 753 km ergibt
     *   0 % und 347 Fahrgaeste — jede Begegnung blockiert.
     * - **Fahrgaeste** erzwingen Zubringer. Die Achse allein bringt 4 113, mit
     *   sieben Zubringerbussen 5 370.
     * - **Kasse** verbietet das Uebertreiben. Halbstundentakt bringt 6 458
     *   Fahrgaeste, kostet aber 381 Tsd. € am Tag und endet bei 1 275 Mio.
     */
    goals: [
      { kind: 'connect', from: 'Hamburg', to: 'München', maxTransfers: 1 },
      { kind: 'daily_passengers', count: 5_000 },
      { kind: 'punctuality', value: 0.9 },
      { kind: 'cash', amount: 1_500_000_000_00 },
    ],
    hints: [
      'Eine eingleisige Fernstrecke trägt keinen dichten Takt — jede Begegnung kostet Wartezeit.',
      'Der Streckenunterhalt läuft, ob ein Zug fährt oder nicht.',
      'Zubringerbusse bringen Relationen, die die Achse allein nicht erreicht.',
    ],
    // Die Bahnhoefe stehen, die Strecke nicht. Acht Bahnhoefe von Hand zu
    // setzen ist Arbeit ohne Entscheidung; wo die Trasse langgeht, mit welcher
    // Hoechstgeschwindigkeit und ob ein- oder zweigleisig, ist der Auftrag.
    setup: {
      railStations: [
        'Hamburg', 'Hannover', 'Kassel', 'Frankfurt am Main', 'Mannheim', 'Stuttgart', 'Augsburg', 'München',
      ],
    },
    grant: 6_500_000_000_00,
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

/**
 * Die Feldzüge.
 *
 * Einer bisher, und er ist die Reihenfolge der drei Aufträge mit Frist. Das
 * klingt nach wenig und ist trotzdem etwas anderes: der Ruhrauftrag beginnt mit
 * dem Netz, den Fahrzeugen und den Schulden des ersten — und mit Fahrzeugen,
 * die inzwischen zwei Jahre älter sind.
 */
export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: 'aufbau',
    title: 'Vom ersten Bus zur Fernachse',
    summary: 'Drei Aufträge auf einem Netz. Was Sie bauen, bleibt stehen.',
    steps: ['first-line', 'ruhr', 'north-south'],
  },
]

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id)

export const campaignById = (id: string): Campaign | undefined => CAMPAIGNS.find((c) => c.id === id)

/** Der Feldzug, zu dem ein Auftrag gehört — und an welcher Stelle er dort steht. */
export function campaignStep(scenarioId: string): { campaign: Campaign; index: number } | undefined {
  for (const campaign of CAMPAIGNS) {
    const index = campaign.steps.indexOf(scenarioId)
    if (index >= 0) return { campaign, index }
  }
  return undefined
}

/** Was gespielt wird, wenn niemand etwas ausgewählt hat. */
export const DEFAULT_SCENARIO_ID = 'first-line'
