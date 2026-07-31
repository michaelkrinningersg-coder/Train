import type { LngLat } from '@game/domain'

const EARTH_RADIUS_KM = 6371.0088
const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Grosskreisdistanz in km (Haversine). */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Gesamtlaenge einer Polylinie in km. */
export function polylineLengthKm(points: readonly LngLat[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    if (prev && cur) sum += distanceKm(prev, cur)
  }
  return sum
}

export interface BBox {
  readonly minLng: number
  readonly minLat: number
  readonly maxLng: number
  readonly maxLat: number
}

export function bboxOf(points: readonly LngLat[]): BBox | null {
  if (points.length === 0) return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const p of points) {
    if (p[0] < minLng) minLng = p[0]
    if (p[0] > maxLng) maxLng = p[0]
    if (p[1] < minLat) minLat = p[1]
    if (p[1] > maxLat) maxLat = p[1]
  }
  return { minLng, minLat, maxLng, maxLat }
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b.minLng && p[0] <= b.maxLng && p[1] >= b.minLat && p[1] <= b.maxLat
}

/**
 * Naeherung fuer Strassenreisezeiten, solange die OSRM-Matrix noch nicht existiert.
 * Siehe docs/05-DATENPIPELINE.md Abschnitt 4 - bewusst als Platzhalter, damit das
 * Nachfragemodell gebaut werden kann, bevor das Routing fertig ist.
 */
export function approximateRoadTimeSec(a: LngLat, b: LngLat): number {
  const detourFactor = 1.25
  const averageSpeedKmh = 85
  return (distanceKm(a, b) * detourFactor) / averageSpeedKmh * 3600
}
