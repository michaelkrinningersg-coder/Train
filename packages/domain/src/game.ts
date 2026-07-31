import type { City } from './city.js'
import type { Vehicle } from './fleet.js'
import type {
  BlockId,
  CityId,
  LineId,
  LngLat,
  Money,
  NodeId,
  PatternId,
  RunId,
  Sec,
  StationId,
  TrackId,
  VehicleId,
} from './ids.js'
import type { Line, ServicePattern } from './lines.js'
import type { MaxSpeed, NetworkNode, Signalling, Station, TrackCount, TrackSegment, TrackUpgrade } from './network.js'
import type { SegmentId } from './segments.js'

export interface TrainRun {
  readonly id: RunId
  readonly patternId: PatternId
  readonly vehicleId: VehicleId
  /** Sollfahrplan aus der Fahrzeitrechnung. */
  readonly schedule: readonly { readonly nodeId: NodeId; readonly arrival: Sec; readonly departure: Sec }[]
  readonly actual: readonly { readonly nodeId: NodeId; readonly arrival: Sec; readonly departure: Sec }[]
  readonly delaySeconds: number
  readonly state: 'scheduled' | 'running' | 'held' | 'finished' | 'cancelled'
  readonly load: Readonly<Record<SegmentId, number>>
}

export interface BlockOccupancy {
  readonly blockId: BlockId
  readonly runId: RunId
  readonly enter: Sec
  readonly leave: Sec
}

export type SimEvent =
  | { readonly at: Sec; readonly kind: 'depart'; readonly runId: RunId; readonly nodeId: NodeId }
  | { readonly at: Sec; readonly kind: 'arrive'; readonly runId: RunId; readonly nodeId: NodeId }
  | { readonly at: Sec; readonly kind: 'enter_block'; readonly runId: RunId; readonly blockId: BlockId }
  | { readonly at: Sec; readonly kind: 'leave_block'; readonly runId: RunId; readonly blockId: BlockId }
  | { readonly at: Sec; readonly kind: 'disruption'; readonly trackId: TrackId; readonly durationSec: number }

export interface Loan {
  readonly id: string
  /** Restschuld in Cent. */
  readonly principal: Money
  /** Jahreszins, z. B. 0,065 fuer 6,5 Prozent. */
  readonly interestRate: number
  readonly takenOnDay: number
  readonly termYears: number
}

export interface LedgerEntry {
  readonly day: number
  readonly category:
    | 'ticket_revenue'
    | 'track_upkeep'
    | 'station_upkeep'
    | 'vehicle_upkeep'
    | 'energy'
    | 'crew'
    | 'construction'
    | 'vehicle_purchase'
    | 'loan'
    | 'repayment'
    | 'interest'
    | 'stop_construction'
  readonly amount: Money
  readonly lineId?: LineId
  readonly note?: string
}

/** Tagesergebnis einer Linie. */
export interface LineDayResult {
  readonly lineId: LineId
  readonly passengers: Readonly<Record<SegmentId, number>>
  readonly totalPassengers: number
  /** Fahrgaeste, die wegen Kapazitaetsmangel stehen geblieben sind. */
  readonly leftBehind: number
  readonly revenue: Money
  readonly operatingCost: Money
  /** Hoechste Streckenauslastung des Tages, 0..1+ (ueber 1 = ueberfuellt). */
  readonly peakLoadFactor: number
  readonly vehicleKm: number
  readonly departuresPerDirection: number
  /** Takt, der mit den zugeteilten Fahrzeugen tatsaechlich erreicht wird. */
  readonly effectiveHeadwayMin: number
  readonly warnings: readonly string[]

  // Nur bei Bahnlinien. Die vollstaendigen Zuglaeufe stehen bewusst nicht im
  // Spielzustand - sie sind gross und lassen sich jederzeit neu rechnen.
  readonly mode?: 'rail' | 'bus'
  readonly punctuality?: number
  readonly averageDelaySec?: number
  readonly conflictCount?: number
  /** Stoerungen des Tages auf dieser Linie. */
  readonly disruptionCount?: number
  readonly trainsNeeded?: number
  /** Spitzenauslastung je Abschnitt zwischen zwei Halten. */
  readonly linkLoadFactors?: readonly number[]

  /** Fahrgaeste dieser Linie, die auf einer Reisekette ueber mehrere Linien sitzen. */
  readonly transferPassengers?: number
  /** Mittlere Zufriedenheit der von dieser Linie bedienten Relationen, 0..1. */
  readonly satisfaction?: number
  /** Ein- und Aussteigende je Fahrt und Halt in der Spitzenstunde. */
  readonly stopFlowPerDeparture?: readonly number[]
  /** Zusaetzliche Haltezeit aus Andrang, ueber alle Halte summiert. */
  readonly crowdingDwellSec?: number

  /** Mittlere Verspaetung dieser Linie, die allein aus gehaltenen Anschluessen stammt. */
  readonly holdDelaySec?: number
  /**
   * Fahrgaeste, die den Anschluss an diese Linie verpassen und auf die naechste
   * Fahrt warten muessen. Verloren sind sie nicht - sie kommen nur spaeter an,
   * und die Relation merkt es sich in ihrer Zufriedenheit.
   */
  readonly missedConnections?: number
}

export interface DayResult {
  readonly day: number
  readonly lines: readonly LineDayResult[]
  readonly revenue: Money
  readonly costs: Money
  readonly profit: Money
  readonly passengers: number
}

export interface GameState {
  readonly seed: number
  /**
   * Welcher Auftrag gespielt wird.
   *
   * Er steht im Spielzustand und nicht daneben, weil der Fortschritt
   * ausschliesslich aus dem Zustand abgelesen wird - ein Spielstand traegt damit
   * seinen Auftrag von selbst mit, ohne ein einziges Feld fuer den Fortschritt.
   */
  readonly scenarioId: string
  /**
   * Spieltag, an dem der laufende Auftrag begonnen hat.
   *
   * Im Feldzug folgt ein Auftrag auf den anderen, ohne dass die Uhr
   * zurueckgesetzt wird - die Frist muss sich also auf den Beginn *dieses*
   * Auftrags beziehen und nicht auf den Spielbeginn.
   */
  readonly scenarioStartedOnDay: number
  /** Ganze Tage seit Spielbeginn, siehe calendar.ts. */
  readonly day: number
  readonly cash: Money
  readonly loans: readonly Loan[]

  readonly cities: ReadonlyMap<CityId, City>
  readonly network: {
    readonly nodes: ReadonlyMap<NodeId, NetworkNode>
    readonly tracks: ReadonlyMap<TrackId, TrackSegment>
    readonly stations: ReadonlyMap<StationId, Station>
  }
  readonly fleet: ReadonlyMap<VehicleId, Vehicle>
  readonly lines: ReadonlyMap<LineId, Line>
  readonly patterns: ReadonlyMap<PatternId, ServicePattern>

  /** Zuglaeufe der Betriebssimulation. Bleibt bis Phase 3 leer. */
  readonly runs: ReadonlyMap<RunId, TrainRun>

  /**
   * Zufriedenheit je Relation ("stadtA|stadtB"), 0..1, Standard 1.
   *
   * Sinkt, wenn Fahrgaeste stehen bleiben oder Zuege unpuenktlich sind, und
   * erholt sich deutlich langsamer, als sie faellt. Sie wirkt als Abschlag auf
   * den Nutzen des eigenen Angebots im Logit-Modell - wer eine Relation ein
   * halbes Jahr ueberfuellt bedient, bekommt die Fahrgaeste nicht mit einem
   * einzigen zusaetzlichen Zug zurueck.
   */
  readonly satisfaction: ReadonlyMap<string, number>

  /**
   * Ein- und Aussteigende je Fahrt und Halt aus dem Vortag, je Linie.
   *
   * Daraus wird die Haltezeit des naechsten Betriebstags bemessen. Der Umweg
   * ueber den Vortag ist Absicht: die Haltezeit haengt von den Fahrgastzahlen ab,
   * die Fahrgastzahlen ueber die Reisezeit von der Haltezeit. Statt diesen
   * Fixpunkt zu iterieren, plant das Spiel den Fahrplan mit den Zahlen von
   * gestern - genau wie ein echter Betrieb.
   */
  readonly crowding: ReadonlyMap<LineId, readonly number[]>

  readonly ledger: readonly LedgerEntry[]
  /** Ergebnis des zuletzt simulierten Betriebstags. */
  readonly lastDay: DayResult | null
  /** Gleitende Historie fuer die Finanzansicht. */
  readonly history: readonly DayResult[]
}

export interface TrackSpec {
  readonly maxSpeed: MaxSpeed
  readonly electrified: boolean
  readonly tracks: TrackCount
  readonly signalling: Signalling
}

export type Command =
  | { readonly kind: 'build_track'; readonly from: NodeId; readonly to: NodeId; readonly geometry: readonly LngLat[]; readonly spec: TrackSpec }
  | { readonly kind: 'upgrade_track'; readonly trackId: TrackId; readonly upgrade: TrackUpgrade }
  | { readonly kind: 'demolish_track'; readonly trackId: TrackId }
  | { readonly kind: 'place_station'; readonly cityId: CityId; readonly position: LngLat; readonly platforms: number }
  | { readonly kind: 'upgrade_station'; readonly stationId: StationId; readonly platforms: number }
  | { readonly kind: 'service_vehicle'; readonly vehicleId: VehicleId }
  | {
      readonly kind: 'replace_vehicle'
      readonly patternId: PatternId
      readonly outgoing: VehicleId
      readonly incoming: VehicleId
    }
  | { readonly kind: 'renew_track'; readonly trackId: TrackId }
  | { readonly kind: 'buy_vehicle'; readonly classId: string; readonly units: number }
  | { readonly kind: 'sell_vehicle'; readonly vehicleId: VehicleId }
  | { readonly kind: 'create_line'; readonly line: Omit<Line, 'id'> }
  | { readonly kind: 'set_pattern'; readonly pattern: Omit<ServicePattern, 'id'> }
  | { readonly kind: 'set_fare'; readonly lineId: LineId; readonly fare: Line['fare'] }
  | { readonly kind: 'set_connection_hold'; readonly lineId: LineId; readonly seconds: number }
  | {
      /** Naechster Auftrag im Feldzug - Netz, Fuhrpark und Kasse bleiben stehen. */
      readonly kind: 'begin_scenario'
      readonly scenarioId: string
      readonly grant: Money
    }
  | { readonly kind: 'take_loan'; readonly amount: Money; readonly termYears: number }
  | { readonly kind: 'repay_loan'; readonly loanId: string; readonly amount: Money }
  | { readonly kind: 'place_bus_stop'; readonly cityId: CityId }
  | { readonly kind: 'remove_bus_stop'; readonly stationId: StationId }
  | { readonly kind: 'delete_line'; readonly lineId: LineId }
  | { readonly kind: 'assign_vehicles'; readonly patternId: PatternId; readonly vehicleIds: readonly VehicleId[] }
  | { readonly kind: 'place_passing_loop'; readonly trackId: TrackId; readonly position: LngLat; readonly capacity: number }

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly cost: Money }
  | { readonly ok: false; readonly reason: string; readonly detail?: unknown }
