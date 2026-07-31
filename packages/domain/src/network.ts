import type { BlockId, CityId, LngLat, Money, NodeId, StationId, TrackId } from './ids.js'

export type NodeKind =
  | 'station' // Bahnhof, Halt moeglich
  | 'junction' // Abzweig, kein Halt
  | 'passing_loop' // Ueberholstelle / Kreuzungsbahnhof

export interface NetworkNode {
  readonly id: NodeId
  readonly position: LngLat
  readonly kind: NodeKind
  readonly stationId?: StationId
  /** Wie viele Zuege hier gleichzeitig stehen koennen. Entscheidend bei Eingleisigkeit. */
  readonly sidingCapacity?: number
}

export const MAX_SPEEDS = [80, 120, 160, 200, 250, 300] as const
export type MaxSpeed = (typeof MAX_SPEEDS)[number]

export const TRACK_COUNTS = [1, 2, 4] as const
export type TrackCount = (typeof TRACK_COUNTS)[number]

export const SIGNALLING_KINDS = ['classic', 'etcs_l1', 'etcs_l2'] as const
export type Signalling = (typeof SIGNALLING_KINDS)[number]

/** Blocklaenge in km je Signaltechnik. Kuerzere Bloecke = hoehere Kapazitaet. */
export const BLOCK_LENGTH_KM: Readonly<Record<Signalling, number>> = {
  classic: 6,
  etcs_l1: 4,
  etcs_l2: 2,
}

/** Reaktions-/Sicherheitszuschlag in Sekunden je Signaltechnik. */
export const SIGNAL_REACTION_SEC: Readonly<Record<Signalling, number>> = {
  classic: 15,
  etcs_l1: 8,
  etcs_l2: 4,
}

/** Unterhaltsfaktor nach Hoechstgeschwindigkeit, siehe docs/00-KONZEPT.md Abschnitt 6. */
export const SPEED_UPKEEP_FACTOR: Readonly<Record<MaxSpeed, number>> = {
  80: 0.85,
  120: 1.0,
  160: 1.25,
  200: 1.6,
  250: 2.1,
  300: 2.8,
}

export const TRACK_UPKEEP_FACTOR: Readonly<Record<TrackCount, number>> = {
  1: 1.0,
  2: 1.8,
  4: 3.4,
}

/** Basis-Streckenunterhalt in Cent pro km und Tag. */
export const BASE_TRACK_UPKEEP_PER_KM_DAY: Money = 4000

export type TrackUpgrade =
  | { readonly kind: 'speed'; readonly to: MaxSpeed }
  | { readonly kind: 'electrify' }
  | { readonly kind: 'tracks'; readonly to: TrackCount }
  | { readonly kind: 'signalling'; readonly to: Signalling }

export interface TrackSegment {
  readonly id: TrackId
  readonly from: NodeId
  readonly to: NodeId
  /** Polylinie inklusive Endpunkte. */
  readonly geometry: readonly LngLat[]
  readonly lengthKm: number

  readonly maxSpeed: MaxSpeed
  readonly electrified: boolean
  readonly tracks: TrackCount
  readonly signalling: Signalling

  /** 1,0 flach bis 3,5 Hochgebirge. Wirkt nur auf Baukosten. */
  readonly terrainFactor: number
  /** Mittlere Steigung in Promille. Reduziert die effektive Geschwindigkeit. */
  readonly gradientPermille: number

  readonly builtOnDay: number
  /** Tag, ab dem die Strecke befahrbar ist. Davor ist sie im Bau. */
  readonly readyOnDay: number
  readonly construction?: {
    readonly upgrade: TrackUpgrade
    readonly finishesOnDay: number
    readonly capacityFactorDuringWorks: number
  }
}

/** Wird gerade gebaut oder ausgebaut? */
export function isUnderConstruction(track: TrackSegment, day: number): boolean {
  return day < track.readyOnDay || (track.construction !== undefined && day < track.construction.finishesOnDay)
}

/** Nutzbare Kapazität heute, 0 solange die Strecke im Neubau ist. */
export function capacityFactor(track: TrackSegment, day: number): number {
  if (day < track.readyOnDay) return 0
  if (track.construction && day < track.construction.finishesOnDay) {
    return track.construction.capacityFactorDuringWorks
  }
  return 1
}

export interface Block {
  readonly id: BlockId
  readonly trackId: TrackId
  readonly trackNumber: number
  readonly index: number
  readonly fromKm: number
  readonly toKm: number
}

/** Groesster baubarer Bahnhof. Darueber hinaus hilft ein zweiter Bahnhof mehr. */
export const MAX_PLATFORMS = 12

export interface StationConstruction {
  readonly finishesOnDay: number
  /**
   * Bahnsteiggleise, die waehrend des Umbaus nutzbar bleiben.
   *
   * In der Regel eines weniger als vorher: wer einen Bahnsteig anbaut, sperrt
   * dafuer einen bestehenden. Das ist der Grund, eine Erweiterung zu planen,
   * *bevor* der Fahrplan eng wird - mitten im Engpass auszubauen macht ihn erst
   * einmal schlimmer.
   */
  readonly platformsDuringWorks: number
}

export interface Station {
  readonly id: StationId
  readonly cityId: CityId
  readonly nodeId: NodeId
  readonly name: string
  readonly position: LngLat
  readonly mode: 'rail' | 'bus' | 'combined'
  /** Bahnsteiggleise im Endausbau. Waehrend eines Umbaus siehe `construction`. */
  readonly platforms: number
  /** 0..1 - Anteil der Stadtnachfrage, den dieser Bahnhof erschliesst. */
  readonly catchment: number
  /** Entfernung zum Stadtzentrum in km - Grundlage von Einzugsgrad und Grundstueckspreis. */
  readonly distanceToCentreKm: number
  readonly buildCost: Money
  readonly upkeepPerDay: Money
  readonly construction?: StationConstruction
}

/** Wie viele Bahnsteiggleise an diesem Tag tatsaechlich befahrbar sind. */
export function platformsInService(station: Station, day: number): number {
  if (station.construction && day < station.construction.finishesOnDay) {
    return Math.max(1, station.construction.platformsDuringWorks)
  }
  return station.platforms
}

/**
 * Einzugsgrad eines Bahnhofs. Faellt mit der Entfernung zum Stadtzentrum,
 * skaliert mit dem Stadtradius. Siehe docs/02-DATENMODELL.md Abschnitt 3.
 */
export function stationCatchment(distanceToCentreKm: number, cityRadiusKm: number): number {
  const raw = 1 - 0.55 * (distanceToCentreKm / Math.max(cityRadiusKm, 0.5)) ** 1.3
  return Math.min(1, Math.max(0.15, raw))
}

/** Taeglicher Unterhalt einer Strecke, siehe docs/00-KONZEPT.md Abschnitt 6. */
export function trackUpkeepPerDay(track: TrackSegment): Money {
  return Math.round(
    track.lengthKm *
      BASE_TRACK_UPKEEP_PER_KM_DAY *
      SPEED_UPKEEP_FACTOR[track.maxSpeed] *
      TRACK_UPKEEP_FACTOR[track.tracks] *
      (track.electrified ? 1.25 : 1.0),
  )
}
