import type { City } from './city.js'
import type { Vehicle } from './fleet.js'
import type {
  BlockId,
  CityId,
  GameTime,
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
  readonly principal: Money
  readonly interestRate: number
  readonly takenAt: GameTime
  readonly termYears: number
}

export interface LedgerEntry {
  readonly at: GameTime
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
    | 'interest'
  readonly amount: Money
  readonly lineId?: LineId
  readonly note?: string
}

export interface GameState {
  readonly seed: number
  readonly time: GameTime
  readonly year: number
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

  readonly runs: ReadonlyMap<RunId, TrainRun>
  readonly ledger: readonly LedgerEntry[]
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
  | { readonly kind: 'buy_vehicle'; readonly classId: string; readonly units: number }
  | { readonly kind: 'sell_vehicle'; readonly vehicleId: VehicleId }
  | { readonly kind: 'create_line'; readonly line: Omit<Line, 'id'> }
  | { readonly kind: 'set_pattern'; readonly pattern: Omit<ServicePattern, 'id'> }
  | { readonly kind: 'set_fare'; readonly lineId: LineId; readonly fare: Line['fare'] }
  | { readonly kind: 'take_loan'; readonly amount: Money; readonly termYears: number }

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly cost: Money }
  | { readonly ok: false; readonly reason: string; readonly detail?: unknown }
