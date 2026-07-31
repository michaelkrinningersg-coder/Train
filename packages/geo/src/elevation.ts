import type { LngLat } from '@game/domain'
import { distanceKm } from './index.js'

/**
 * Höhenraster der Region, erzeugt von `pnpm data:terrain`.
 *
 * Ein flaches Int16-Array statt Kacheln: beim Ziehen einer Trasse fragt das
 * Spiel hunderte Höhen pro Sekunde ab, und das muss ohne Dekodierung gehen.
 */
export interface ElevationGrid {
  readonly bounds: { readonly west: number; readonly east: number; readonly south: number; readonly north: number }
  readonly cols: number
  readonly rows: number
  readonly stepDeg: number
  readonly noData: number
  readonly data: Int16Array
}

/** Höhe in Metern, bilinear interpoliert. `null` außerhalb des Rasters. */
export function sampleElevation(grid: ElevationGrid, point: LngLat): number | null {
  const [lng, lat] = point
  const x = (lng - grid.bounds.west) / grid.stepDeg
  const y = (grid.bounds.north - lat) / grid.stepDeg
  if (x < 0 || y < 0 || x > grid.cols - 1 || y > grid.rows - 1) return null

  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, grid.cols - 1)
  const y1 = Math.min(y0 + 1, grid.rows - 1)
  const fx = x - x0
  const fy = y - y0

  const at = (col: number, row: number): number | null => {
    const v = grid.data[row * grid.cols + col]
    return v === undefined || v === grid.noData ? null : v
  }

  const q11 = at(x0, y0)
  const q21 = at(x1, y0)
  const q12 = at(x0, y1)
  const q22 = at(x1, y1)
  // Am Rand des Rasters oder über Wasser liegen einzelne Stützstellen leer.
  // Dann lieber den nächstbesten Wert als gar keinen.
  if (q11 === null || q21 === null || q12 === null || q22 === null) {
    return q11 ?? q21 ?? q12 ?? q22
  }

  const top = q11 * (1 - fx) + q21 * fx
  const bottom = q12 * (1 - fx) + q22 * fx
  return top * (1 - fy) + bottom * fy
}

export interface ProfilePoint {
  readonly km: number
  readonly elevation: number
}

/** Höhenprofil entlang einer Polylinie, in festen Abständen abgetastet. */
export function elevationProfile(
  grid: ElevationGrid,
  path: readonly LngLat[],
  sampleKm = 1,
): readonly ProfilePoint[] {
  if (path.length < 2) return []

  const out: ProfilePoint[] = []
  let travelled = 0
  let nextSample = 0

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const legKm = distanceKm(a, b)
    if (legKm === 0) continue

    while (nextSample <= travelled + legKm) {
      const t = (nextSample - travelled) / legKm
      const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const elevation = sampleElevation(grid, point)
      if (elevation !== null) out.push({ km: nextSample, elevation })
      nextSample += sampleKm
    }
    travelled += legKm
  }

  // Der Endpunkt gehört immer dazu.
  const last = path[path.length - 1]!
  const endElevation = sampleElevation(grid, last)
  if (endElevation !== null && (out.length === 0 || out[out.length - 1]!.km < travelled - 0.01)) {
    out.push({ km: travelled, elevation: endElevation })
  }

  return out
}

/** Maximale Steigung, auf die eine Bahnstrecke ausgelegt wird. */
export const MAX_RAILWAY_GRADIENT_PERMILLE = 25
/** Ab dieser mittleren Geländesteigung ist der Geländefaktor am Anschlag. */
export const TERRAIN_SATURATION_PERMILLE = 35
export const MAX_TERRAIN_FACTOR = 3.5

export interface TerrainStats {
  readonly minElevation: number
  readonly maxElevation: number
  /** Mittlere absolute Geländesteigung in Promille. */
  readonly meanAbsGradientPermille: number
  readonly maxAbsGradientPermille: number
  /** 1,0 flach bis 3,5 Hochgebirge. Multipliziert die Baukosten. */
  readonly terrainFactor: number
  /** Steigung der ausgebauten Trasse - gekappt, denn Bahnen werden eingeschnitten. */
  readonly gradientPermille: number
  readonly profile: readonly ProfilePoint[]
}

/**
 * Geländebewertung einer Trasse.
 *
 * Der Geländefaktor kommt aus der *mittleren absoluten Steigung des Geländes*,
 * nicht aus der Steigung der fertigen Strecke: eine Bahn durch bergiges Gelände
 * ist nicht deshalb teuer, weil sie steil wird, sondern weil sie eingeschnitten,
 * aufgeschüttet, untertunnelt und überbrückt werden muss, um flach zu bleiben.
 */
export function terrainStats(grid: ElevationGrid, path: readonly LngLat[], sampleKm = 1): TerrainStats {
  const profile = elevationProfile(grid, path, sampleKm)

  if (profile.length < 2) {
    return {
      minElevation: 0,
      maxElevation: 0,
      meanAbsGradientPermille: 0,
      maxAbsGradientPermille: 0,
      terrainFactor: 1,
      gradientPermille: 0,
      profile,
    }
  }

  let min = Infinity
  let max = -Infinity
  let gradientSum = 0
  let maxGradient = 0
  let count = 0

  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]!
    if (p.elevation < min) min = p.elevation
    if (p.elevation > max) max = p.elevation

    if (i === 0) continue
    const prev = profile[i - 1]!
    const runKm = p.km - prev.km
    if (runKm <= 0) continue

    // Höhenunterschied in Metern je Kilometer ist bereits Promille.
    const gradient = Math.abs((p.elevation - prev.elevation) / runKm)
    gradientSum += gradient
    if (gradient > maxGradient) maxGradient = gradient
    count++
  }

  const meanAbs = count > 0 ? gradientSum / count : 0
  const terrainFactor =
    1 + (MAX_TERRAIN_FACTOR - 1) * Math.min(1, meanAbs / TERRAIN_SATURATION_PERMILLE)

  return {
    minElevation: Math.round(min),
    maxElevation: Math.round(max),
    meanAbsGradientPermille: Number(meanAbs.toFixed(2)),
    maxAbsGradientPermille: Number(maxGradient.toFixed(2)),
    terrainFactor: Number(terrainFactor.toFixed(3)),
    gradientPermille: Number(Math.min(meanAbs, MAX_RAILWAY_GRADIENT_PERMILLE).toFixed(2)),
    profile,
  }
}
