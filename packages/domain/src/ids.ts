/**
 * Gebrandete IDs. Der Compiler verhindert damit, dass eine StationId dort landet,
 * wo eine CityId erwartet wird - beides waeren sonst nur `string`.
 */
type Brand<K, T> = K & { readonly __brand: T }

export type CityId = Brand<string, 'City'>
export type StationId = Brand<string, 'Station'>
export type NodeId = Brand<string, 'Node'>
export type TrackId = Brand<string, 'Track'>
export type BlockId = Brand<string, 'Block'>
export type LineId = Brand<string, 'Line'>
export type PatternId = Brand<string, 'Pattern'>
export type VehicleId = Brand<string, 'Vehicle'>
export type RunId = Brand<string, 'Run'>

export const cityId = (v: string): CityId => v as CityId
export const stationId = (v: string): StationId => v as StationId
export const nodeId = (v: string): NodeId => v as NodeId
export const trackId = (v: string): TrackId => v as TrackId
export const blockId = (v: string): BlockId => v as BlockId
export const lineId = (v: string): LineId => v as LineId
export const patternId = (v: string): PatternId => v as PatternId
export const vehicleId = (v: string): VehicleId => v as VehicleId
export const runId = (v: string): RunId => v as RunId

/** [Laenge, Breite] - GeoJSON-Reihenfolge, nicht Lat/Lng. */
export type LngLat = readonly [lng: number, lat: number]

/** Euro-Cent, ganzzahlig. Kein Float, keine Rundungsfehler in der Bilanz. */
export type Money = number

/** Sekunden seit Betriebsbeginn (00:00) eines Betriebstags. */
export type Sec = number

/** Sekunden seit Spielstart. */
export type GameTime = number
