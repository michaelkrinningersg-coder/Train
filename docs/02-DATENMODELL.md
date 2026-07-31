# 02 — Domänenmodell

Vorschlag für `packages/domain`. Reine Typen, keine Logik. Alle IDs sind gebrandete Strings,
damit man eine `StationId` nicht versehentlich als `CityId` übergibt.

```ts
// ─── Basis ────────────────────────────────────────────────────────────────
type Brand<K, T> = K & { readonly __brand: T }

export type CityId     = Brand<string, 'City'>
export type StationId  = Brand<string, 'Station'>
export type NodeId     = Brand<string, 'Node'>
export type TrackId    = Brand<string, 'Track'>
export type BlockId    = Brand<string, 'Block'>
export type LineId     = Brand<string, 'Line'>
export type PatternId  = Brand<string, 'Pattern'>
export type VehicleId  = Brand<string, 'Vehicle'>
export type RunId      = Brand<string, 'Run'>

export type LngLat = readonly [lng: number, lat: number]
export type Money  = number        // Euro-Cent, ganzzahlig — keine Float-Rundungsfehler
export type Sec    = number        // Sekunden seit Betriebsbeginn (00:00)
export type GameTime = number      // Sekunden seit Spielstart
```

## 1. Welt: Städte und Einrichtungen

```ts
export type SegmentId =
  | 'commuter'      // Berufspendler
  | 'pupil'         // Schüler
  | 'student'       // Studenten
  | 'business'      // Geschäftsreisende
  | 'tourist'       // Touristen
  | 'vfr'           // Besuchsreisende (visiting friends & relatives)

export type FacilityType =
  | 'university' | 'school_centre'
  | 'landmark' | 'nature' | 'theme_park'
  | 'major_employer' | 'industrial_cluster'
  | 'finance_hub' | 'trade_fair' | 'capital' | 'airport_hub'

export interface Facility {
  type: FacilityType
  size: 1 | 2 | 3
  name?: string
  /** Monatsindex 0–11 → Multiplikator, für saisonale Ziele (Skigebiet, Messe) */
  seasonality?: readonly number[]
}

export interface City {
  id: CityId
  name: string
  country: string           // ISO 3166-1 alpha-2
  centre: LngLat
  population: number
  /** Abgeleitet aus population — bestimmt das Einzugsgebiet des Bahnhofs. */
  radiusKm: number
  facilities: readonly Facility[]

  /** Vorberechnet in der Datenpipeline (siehe 03-NACHFRAGEMODELL). */
  potential: Readonly<Record<SegmentId, { origin: number; destination: number }>>
}
```

## 2. Netz: Knoten, Strecken, Blöcke

```ts
export interface NetworkNode {
  id: NodeId
  position: LngLat
  kind:
    | 'station'       // Bahnhof — Halt möglich
    | 'junction'      // Abzweig — kein Halt
    | 'passing_loop'  // Überholstelle/Kreuzungsbahnhof — entscheidend bei Eingleisigkeit
  stationId?: StationId
  /** Nur bei passing_loop/station: wie viele Züge hier gleichzeitig stehen können. */
  sidingCapacity?: number
}

export type MaxSpeed = 80 | 120 | 160 | 200 | 250 | 300
export type TrackCount = 1 | 2 | 4
export type Signalling = 'classic' | 'etcs_l1' | 'etcs_l2'

export interface TrackSegment {
  id: TrackId
  from: NodeId
  to: NodeId
  /** Polylinie zwischen from und to, inkl. Endpunkte. */
  geometry: readonly LngLat[]
  lengthKm: number

  maxSpeed: MaxSpeed
  electrified: boolean
  tracks: TrackCount
  signalling: Signalling

  /** 1,0 flach … 3,5 Hochgebirge. Nur Baukosten, nicht Fahrzeit. */
  terrainFactor: number
  /** Mittlere Steigung in ‰ — reduziert die effektive Geschwindigkeit schwerer Züge. */
  gradientPermille: number

  builtAt: GameTime
  /** Läuft ein Ausbau? Dann ist die Kapazität reduziert. */
  construction?: {
    upgrade: TrackUpgrade
    finishesAt: GameTime
    capacityFactorDuringWorks: number   // z. B. 0,5
  }
}

export type TrackUpgrade =
  | { kind: 'speed';        to: MaxSpeed }
  | { kind: 'electrify' }
  | { kind: 'tracks';       to: TrackCount }
  | { kind: 'signalling';   to: Signalling }

/** Abgeleitet, nicht persistiert: Blockabschnitte einer Strecke. */
export interface Block {
  id: BlockId
  trackId: TrackId
  trackNumber: number    // bei mehrgleisigen Strecken
  index: number
  fromKm: number
  toKm: number
}
```

**Blocklänge** ergibt sich aus der Signaltechnik:
`classic → 6 km`, `etcs_l1 → 4 km`, `etcs_l2 → 2 km`.
Eine Strecke wird in `ceil(lengthKm / blockLength)` Blöcke geteilt. Bei `tracks >= 2`
existiert jeder Block je Gleis; Richtungsbetrieb ist dann möglich, bei `tracks === 1`
teilen sich beide Richtungen dieselben Blöcke — daraus entsteht der ganze Kreuzungszwang.

## 3. Bahnhöfe

```ts
export interface Station {
  id: StationId
  cityId: CityId
  nodeId: NodeId
  name: string
  position: LngLat
  mode: 'rail' | 'bus' | 'combined'
  platforms: number
  /** 0..1 — Anteil der Stadtnachfrage, den dieser Bahnhof erschließt. */
  catchment: number
  buildCost: Money
  upkeepPerDay: Money
}
```

`catchment` wird beim Platzieren berechnet:

```ts
const d = distanceKm(station.position, city.centre)
const catchment = clamp(1 - 0.55 * (d / city.radiusKm) ** 1.3, 0.15, 1)
```

Mehrere Bahnhöfe in derselben Stadt teilen sich die Nachfrage — sie addieren sich nicht
über 1,0 hinaus, sondern werden auf `min(1, Σ)` gedeckelt und anteilig verteilt.

## 4. Fahrzeuge

```ts
export type Traction = 'electric' | 'diesel' | 'bimodal'

export interface TrainClass {
  id: string
  displayName: string
  traction: Traction
  topSpeedKmh: number
  accelMs2: number
  brakeMs2: number
  seats: { first: number; second: number }
  /** 0..1 — geht als Komfortnutzen ins Logit-Modell. */
  comfort: number
  lengthM: number
  purchasePrice: Money
  upkeepPerDay: Money
  energyCostPerKm: Money
  crewPerHour: Money
  availableFrom: number      // Spieljahr
  availableUntil?: number
}

export interface BusClass {
  id: string
  displayName: string
  seats: number
  comfort: number
  topSpeedKmh: number
  purchasePrice: Money
  upkeepPerDay: Money
  fuelCostPerKm: Money
  availableFrom: number
}

export interface Vehicle {
  id: VehicleId
  classId: string
  mode: 'rail' | 'bus'
  /** Mehrfachtraktion: 2 Einheiten = doppelte Sitzplätze, doppelte Kosten. */
  units: number
  boughtAt: GameTime
  /** 1,0 neu … 0,0 schrottreif. Beeinflusst Unterhaltskosten und Störanfälligkeit. */
  condition: number
  assignedPatternId?: PatternId
}
```

## 5. Linien und Fahrpläne

```ts
export interface LineStop {
  stationId: StationId
  dwellSeconds: number
  /** false = Durchfahrt (bei beschleunigten Zuglagen) */
  serves: boolean
}

export interface Line {
  id: LineId
  name: string
  mode: 'rail' | 'bus'
  stops: readonly LineStop[]
  /** Schiene: Kantenfolge im eigenen Netz. Bus: Referenz auf die Straßenmatrix. */
  path: readonly TrackId[] | { kind: 'road' }
  fare: FarePolicy
}

export interface FarePolicy {
  /** Grundpreis pro km in Cent, je Klasse. */
  perKm: { first: Money; second: Money }
  baseFare: Money
  /** Multiplikator, mit dem der Spieler global an der Preisschraube dreht. */
  priceIndex: number   // 0,5 … 2,0
}

export type DayMask = number    // Bitmaske Mo=1 … So=64

export interface ServicePattern {
  id: PatternId
  lineId: LineId
  direction: 'forward' | 'backward'
  vehicleIds: readonly VehicleId[]
  days: DayMask
  /** Entweder fester Takt … */
  headway?: { everyMinutes: number; firstDeparture: Sec; lastDeparture: Sec }
  /** … oder explizite Abfahrtszeiten. */
  departures?: readonly Sec[]
  /** Nur an diesen Halten halten (sonst alle aus Line.stops mit serves=true). */
  stopOverride?: readonly StationId[]
}
```

## 6. Laufzeitzustand der Simulation

```ts
export interface TrainRun {
  id: RunId
  patternId: PatternId
  vehicleId: VehicleId
  /** Sollfahrplan, aus der Fahrzeitrechnung erzeugt. */
  schedule: readonly { nodeId: NodeId; arrival: Sec; departure: Sec }[]
  /** Istzeiten, während der Simulation gefüllt. */
  actual: { nodeId: NodeId; arrival: Sec; departure: Sec }[]
  delaySeconds: number
  state: 'scheduled' | 'running' | 'held' | 'finished' | 'cancelled'
  load: Readonly<Record<SegmentId, number>>
}

export interface BlockOccupancy {
  blockId: BlockId
  runId: RunId
  enter: Sec
  leave: Sec
}

export interface SimState {
  time: GameTime
  rngState: readonly [number, number, number, number]
  runs: ReadonlyMap<RunId, TrainRun>
  occupancy: ReadonlyMap<BlockId, readonly BlockOccupancy[]>
  eventQueue: PriorityQueue<SimEvent>
}

export type SimEvent =
  | { at: Sec; kind: 'depart';       runId: RunId; nodeId: NodeId }
  | { at: Sec; kind: 'arrive';       runId: RunId; nodeId: NodeId }
  | { at: Sec; kind: 'enter_block';  runId: RunId; blockId: BlockId }
  | { at: Sec; kind: 'leave_block';  runId: RunId; blockId: BlockId }
  | { at: Sec; kind: 'disruption';   trackId: TrackId; durationSec: number }
```

## 7. Gesamtspielzustand

```ts
export interface GameState {
  seed: number
  time: GameTime
  year: number
  cash: Money
  loans: readonly Loan[]

  network: {
    nodes: ReadonlyMap<NodeId, NetworkNode>
    tracks: ReadonlyMap<TrackId, TrackSegment>
    stations: ReadonlyMap<StationId, Station>
  }
  fleet: ReadonlyMap<VehicleId, Vehicle>
  lines: ReadonlyMap<LineId, Line>
  patterns: ReadonlyMap<PatternId, ServicePattern>

  sim: SimState
  ledger: readonly LedgerEntry[]
}
```

Der Zustand ist bewusst ein einfacher, serialisierbarer Baum: Speichern ist
`JSON.stringify` mit Map-Ersetzer, Laden ist die Umkehrung. Kein ORM-Mapping des
Spielzustands, keine Objektidentität über Referenzen — nur IDs.

## 8. Befehle

Alle Spieleraktionen sind Befehle, die die Simulation validiert und anwendet. Das ist die
Grundlage für Undo, Replay und einen späteren Server-autoritativen Modus.

```ts
export type Command =
  | { kind: 'build_track';    from: NodeId; to: NodeId; geometry: LngLat[]; spec: TrackSpec }
  | { kind: 'upgrade_track';  trackId: TrackId; upgrade: TrackUpgrade }
  | { kind: 'demolish_track'; trackId: TrackId }
  | { kind: 'place_station';  cityId: CityId; position: LngLat; platforms: number }
  | { kind: 'buy_vehicle';    classId: string; units: number }
  | { kind: 'sell_vehicle';   vehicleId: VehicleId }
  | { kind: 'create_line';    line: Omit<Line, 'id'> }
  | { kind: 'set_pattern';    pattern: Omit<ServicePattern, 'id'> }
  | { kind: 'set_fare';       lineId: LineId; fare: FarePolicy }
  | { kind: 'take_loan';      amount: Money; termYears: number }

export type CommandResult =
  | { ok: true; state: GameState; cost: Money }
  | { ok: false; reason: string; detail?: unknown }
```
