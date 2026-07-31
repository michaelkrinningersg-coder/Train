import type { LineId, Money, PatternId, Sec, StationId, TrackId, VehicleId } from './ids.js'

export interface LineStop {
  readonly stationId: StationId
  readonly dwellSeconds: number
  /** false = Durchfahrt, fuer beschleunigte Zuglagen. */
  readonly serves: boolean
}

export interface FarePolicy {
  /** Grundpreis pro km in Cent, je Klasse. */
  readonly perKm: { readonly first: Money; readonly second: Money }
  readonly baseFare: Money
  /** Globale Preisschraube des Spielers, 0,5 bis 2,0. */
  readonly priceIndex: number
}

/** Schiene folgt einer Kantenfolge im eigenen Netz, Bus dem realen Strassennetz. */
export type LinePath = { readonly kind: 'rail'; readonly tracks: readonly TrackId[] } | { readonly kind: 'road' }

export interface Line {
  readonly id: LineId
  readonly name: string
  readonly mode: 'rail' | 'bus'
  readonly stops: readonly LineStop[]
  readonly path: LinePath
  readonly fare: FarePolicy
  /** Fahrzeitreserve als Faktor, 1,07 = 7 Prozent. Siehe docs/04 Abschnitt 1. */
  readonly runtimeReserve: number
  /**
   * Anschlusssicherung: wie lange diese Linie an einem Umsteigepunkt hoechstens
   * auf einen verspaeteten Zubringer wartet.
   *
   * 0 heisst „faehrt immer nach Plan" — dann verpassen die Umsteiger ihren
   * Anschluss, wenn der Zubringer zu spaet kommt. Wartet die Linie, kommen sie
   * mit, aber alle anderen an Bord fahren die Wartezeit als Verspaetung mit.
   * Genau das ist die Abwaegung, und sie gehoert dem Spieler.
   */
  readonly connectionHoldSec: number
}

/** Eine neue Linie faehrt nach Plan und wartet auf niemanden. */
export const DEFAULT_CONNECTION_HOLD_SEC = 0

/** Zur Auswahl stehende Wartezeiten in Sekunden. */
export const CONNECTION_HOLD_CHOICES = [0, 180, 300, 600] as const

/** Bitmaske Mo=1, Di=2, Mi=4, Do=8, Fr=16, Sa=32, So=64. */
export type DayMask = number

export const DAYS_WEEKDAY: DayMask = 1 | 2 | 4 | 8 | 16
export const DAYS_WEEKEND: DayMask = 32 | 64
export const DAYS_ALL: DayMask = DAYS_WEEKDAY | DAYS_WEEKEND

export interface ServicePattern {
  readonly id: PatternId
  readonly lineId: LineId
  readonly direction: 'forward' | 'backward'
  readonly vehicleIds: readonly VehicleId[]
  readonly days: DayMask
  /** Entweder fester Takt ... */
  readonly headway?: {
    readonly everyMinutes: number
    readonly firstDeparture: Sec
    readonly lastDeparture: Sec
  }
  /** ... oder explizite Abfahrtszeiten. */
  readonly departures?: readonly Sec[]
  /** Nur an diesen Halten halten, sonst alle mit serves=true. */
  readonly stopOverride?: readonly StationId[]
}

export function fareFor(fare: FarePolicy, distanceKm: number, klass: 'first' | 'second'): Money {
  return Math.round(fare.baseFare + fare.perKm[klass] * distanceKm * fare.priceIndex)
}

/** Abfahrtszeiten eines Musters fuer einen Betriebstag. */
export function expandDepartures(pattern: ServicePattern): readonly Sec[] {
  if (pattern.departures) return pattern.departures
  const h = pattern.headway
  if (!h) return []
  const step = h.everyMinutes * 60
  if (step <= 0) return []
  const out: Sec[] = []
  for (let t = h.firstDeparture; t <= h.lastDeparture; t += step) out.push(t)
  return out
}

/**
 * Standardtarif einer neuen Buslinie. Der Grundpreis ist bewusst spuerbar:
 * ohne ihn waeren kurze Relationen unter jeder Kostendeckung, weil die Kosten
 * einer Fahrt nicht linear mit der Entfernung fallen.
 */
export const DEFAULT_BUS_FARE: FarePolicy = {
  perKm: { first: 25, second: 15 },
  baseFare: 250,
  priceIndex: 1,
}

export const DEFAULT_RUNTIME_RESERVE = 1.07

/** Betriebszeit einer neuen Linie: 5 bis 21 Uhr. */
export const DEFAULT_SERVICE_WINDOW = { firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 } as const

/**
 * Standardtarif einer neuen Bahnlinie. Deutlich ueber dem Busniveau: die Bahn
 * ist schneller und bequemer, und die Fahrgaeste zahlen dafuer.
 */
export const DEFAULT_RAIL_FARE: FarePolicy = {
  perKm: { first: 32, second: 19 },
  baseFare: 300,
  priceIndex: 1,
}
