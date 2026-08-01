import type {
  City,
  FacilityChange,
  DayResult,
  GameState,
  LedgerEntry,
  Line,
  LineId,
  Loan,
  NetworkNode,
  ServicePattern,
  Station,
  TrackSegment,
  Vehicle,
} from '@game/domain'
import { withPotentials } from '@game/demand'

/**
 * Spielstände.
 *
 * `JSON.stringify` auf den Spielzustand loszulassen wäre ein stiller Datenverlust:
 * eine `Map` wird zu `{}`, ohne dass irgendetwas fehlschlägt. Der Spielstand sähe
 * beim Speichern gut aus und wäre beim Laden leer. Deshalb eine ausgeschriebene
 * Umwandlung — sie ist länger, aber sie kann nicht unbemerkt danebengehen.
 *
 * Zwei Dinge werden **nicht** gespeichert:
 *
 * - Die **Potenziale** der Städte. Sie hängen ausschließlich an Einwohnerzahl und
 *   Einrichtungen und werden beim Laden neu gerechnet. Gespeichert wären sie
 *   nicht nur Ballast, sondern eine Fehlerquelle: nach einer Modelländerung
 *   trüge ein alter Spielstand stille alte Zahlen weiter.
 * - Die **Nachfragematrix**. Aus demselben Grund, nur deutlicher — sie ist groß.
 *
 * Und eines wird **gekürzt**: die Tagesergebnisse der Historie behalten nur ihre
 * Summen. Ein Jahr Spielzeit mit acht Linien wächst sonst auf 2,6 MB, wovon 2,4
 * auf Zahlen entfallen, die nirgends gelesen werden — die Finanzansicht nimmt
 * aus der Historie den Tagesgewinn und sonst nichts. Das Ergebnis des letzten
 * Tages bleibt vollständig, denn das zeigen die Linienpanels.
 *
 * Die Versionsnummer steht im Spielstand, nicht daneben. Wer eine Datei
 * weitergibt, gibt damit auch weiter, wie sie zu lesen ist.
 */

/**
 * Format 2 kennt die Anschlusssicherung je Linie, Format 3 den Auftrag,
 * Format 5 den Strukturwandel. Ältere Stände haben die Felder nicht; sie werden
 * beim Laden so gelesen, wie sie sich verhalten haben — niemand wartet auf
 * niemanden, gespielt wurde ohne Auftrag, und die Städte standen still.
 */
export const SAVE_VERSION = 5

/** Was ein `Map`-Wert selbst mitbringt, muss nicht als Schlüssel danebenstehen. */
type ById<T> = readonly T[]

export interface SerialisedState {
  readonly seed: number
  readonly scenarioId: string
  readonly scenarioStartedOnDay: number
  readonly day: number
  readonly cash: number
  readonly loans: readonly Loan[]
  /** Ohne `potential` — das wird beim Laden neu gerechnet. */
  readonly cities: readonly City[]
  readonly nodes: ById<NetworkNode>
  readonly tracks: ById<TrackSegment>
  readonly stations: ById<Station>
  readonly fleet: ById<Vehicle>
  readonly lines: ById<Line>
  readonly patterns: ById<ServicePattern>
  readonly satisfaction: readonly (readonly [string, number])[]
  readonly crowding: readonly (readonly [string, readonly number[]])[]
  readonly ledger: readonly LedgerEntry[]
  readonly lastDay: DayResult | null
  /** Nur die Summen — siehe Dateikopf. Der letzte Tag steht in `lastDay`. */
  readonly history: readonly DayResult[]
  /** Strukturwandel. Fehlt in Formaten vor 5. */
  readonly facilityChanges?: readonly FacilityChange[]
}

export interface SaveGame {
  readonly version: number
  /** ISO-Zeitstempel der Wirklichkeit, nicht der Spielzeit. */
  readonly savedAt: string
  readonly label: string
  readonly state: SerialisedState
}

export function serialiseState(state: GameState): SerialisedState {
  return {
    seed: state.seed,
    scenarioId: state.scenarioId,
    scenarioStartedOnDay: state.scenarioStartedOnDay,
    day: state.day,
    cash: state.cash,
    loans: state.loans,
    cities: [...state.cities.values()].map(stripDerived),
    nodes: [...state.network.nodes.values()],
    tracks: [...state.network.tracks.values()],
    stations: [...state.network.stations.values()],
    fleet: [...state.fleet.values()],
    lines: [...state.lines.values()],
    patterns: [...state.patterns.values()],
    satisfaction: [...state.satisfaction.entries()],
    crowding: [...state.crowding.entries()],
    ledger: state.ledger,
    lastDay: state.lastDay,
    history: state.history.map(summarise),
    facilityChanges: state.facilityChanges,
  }
}

/**
 * Ein Tagesergebnis ohne die Zahlen je Linie.
 *
 * Gelesen wird aus der Historie nur der Tagesgewinn; alles andere ist
 * Speicherplatz für nichts. Der jüngste Tag bleibt vollständig, weil ihn die
 * Linienpanels unter „Gestern" zeigen.
 */
function summarise(day: DayResult, index: number, all: readonly DayResult[]): DayResult {
  if (index === all.length - 1) return day
  return { ...day, lines: [] }
}

/** Die Potenziale hängen nur an der Stadt und werden beim Laden neu gerechnet. */
function stripDerived(city: City): City {
  if (!city.potential) return city
  const { potential: _derived, ...rest } = city
  return rest
}

export function deserialiseState(data: SerialisedState): GameState {
  const cities = withPotentials(data.cities)
  return {
    seed: data.seed,
    scenarioId: data.scenarioId,
    scenarioStartedOnDay: data.scenarioStartedOnDay,
    day: data.day,
    cash: data.cash,
    loans: data.loans,
    cities: new Map(cities.map((c) => [c.id, c])),
    network: {
      nodes: new Map(data.nodes.map((n) => [n.id, n])),
      tracks: new Map(data.tracks.map((t) => [t.id, t])),
      stations: new Map(data.stations.map((s) => [s.id, s])),
    },
    fleet: new Map(data.fleet.map((v) => [v.id, v])),
    lines: new Map(data.lines.map((l) => [l.id, l])),
    patterns: new Map(data.patterns.map((p) => [p.id, p])),
    runs: new Map(),
    satisfaction: new Map(data.satisfaction),
    crowding: new Map(data.crowding.map(([id, flows]) => [id as LineId, flows])),
    ledger: data.ledger,
    lastDay: data.lastDay,
    history: data.history,
    facilityChanges: data.facilityChanges ?? [],
  }
}

export class SaveError extends Error {}

/**
 * Liest einen Spielstand und hebt ihn nötigenfalls auf die aktuelle Version.
 *
 * Der Grundsatz jeder Migration: sie stellt das Verhalten wieder her, das der
 * alte Stand hatte, nicht das, was heute die schönere Voreinstellung wäre. Wer
 * ein Netz mit knappen Anschlüssen gebaut hat, bekommt es beim Laden nicht
 * stillschweigend mit Anschlusssicherung zurück — sein Fahrplan wäre ein
 * anderer, ohne dass er etwas getan hätte.
 */
export function readSave(raw: unknown): GameState {
  if (typeof raw !== 'object' || raw === null) throw new SaveError('Das ist kein Spielstand.')
  const save = raw as Partial<SaveGame>

  if (typeof save.version !== 'number' || !save.state) {
    throw new SaveError('Der Spielstand hat kein erkennbares Format.')
  }
  if (save.version > SAVE_VERSION) {
    throw new SaveError(
      `Der Spielstand stammt aus einer neueren Fassung des Spiels (Format ${save.version}, gelesen wird bis ${SAVE_VERSION}).`,
    )
  }

  const migrated = migrate(save.state, save.version)
  try {
    return deserialiseState(migrated)
  } catch (error) {
    throw new SaveError(`Der Spielstand ließ sich nicht lesen: ${(error as Error).message}`)
  }
}

function migrate(state: SerialisedState, from: number): SerialisedState {
  let current = state
  let version = from
  while (version < SAVE_VERSION) {
    switch (version) {
      case 1:
        current = liftV1toV2(current)
        version = 2
        break
      case 2:
        current = liftV2toV3(current)
        version = 3
        break
      case 3:
        current = liftV3toV4(current)
        version = 4
        break
      case 4:
        current = liftV4toV5(current)
        version = 5
        break
      default:
        version = SAVE_VERSION
    }
  }
  return current
}

/**
 * Format 1 kannte keine Anschlusssicherung — dort wartete keine Linie.
 *
 * Der Typ sagt, dass `connectionHoldSec` da ist; die Daten von gestern wissen
 * davon nichts. Genau deshalb steht hier ein `Partial` und kein `!`.
 */
function liftV1toV2(state: SerialisedState): SerialisedState {
  return {
    ...state,
    lines: state.lines.map((line) => ({
      ...line,
      connectionHoldSec: (line as Partial<Line>).connectionHoldSec ?? 0,
    })),
  }
}

/**
 * Format 2 kannte keinen Auftrag — dort wurde ohne Frist und ohne Ziel gespielt.
 * Genau das ist „Freies Spiel", also wird ein alter Stand dorthin gehoben und
 * nicht in ein Szenario, dessen Frist er womöglich längst verpasst hätte.
 */
function liftV2toV3(state: SerialisedState): SerialisedState {
  return { ...state, scenarioId: (state as Partial<SerialisedState>).scenarioId ?? 'free' }
}

/**
 * Format 3 kannte keinen Feldzug — dort begann jeder Auftrag am Spielbeginn.
 */
function liftV3toV4(state: SerialisedState): SerialisedState {
  return { ...state, scenarioStartedOnDay: (state as Partial<SerialisedState>).scenarioStartedOnDay ?? 0 }
}

/**
 * Format 4 kannte keinen Strukturwandel — dort blieben die Städte, wie sie
 * waren. Eine leere Liste stellt genau das wieder her: die Städte des
 * Spielstands sind die Ausgangsstädte, und ab jetzt geht es weiter.
 */
function liftV4toV5(state: SerialisedState): SerialisedState {
  return { ...state, facilityChanges: (state as Partial<SerialisedState>).facilityChanges ?? [] }
}

export function makeSave(state: GameState, label: string, savedAt: string): SaveGame {
  return { version: SAVE_VERSION, savedAt, label, state: serialiseState(state) }
}
