import { describe, expect, it } from 'vitest'
import type { LngLat } from '@game/domain'
import { bboxOf, distanceKm, polylineLengthKm } from './index.js'

const MUNICH: LngLat = [11.575, 48.137]
const NUREMBERG: LngLat = [11.078, 49.454]
const AUGSBURG: LngLat = [10.898, 48.371]

describe('distanceKm', () => {
  it('trifft die reale Luftlinie Muenchen-Nuernberg', () => {
    // Realwert rund 150 km.
    expect(distanceKm(MUNICH, NUREMBERG)).toBeGreaterThan(145)
    expect(distanceKm(MUNICH, NUREMBERG)).toBeLessThan(155)
  })

  it('ist symmetrisch und null fuer denselben Punkt', () => {
    expect(distanceKm(MUNICH, NUREMBERG)).toBeCloseTo(distanceKm(NUREMBERG, MUNICH), 9)
    expect(distanceKm(MUNICH, MUNICH)).toBe(0)
  })
})

describe('polylineLengthKm', () => {
  it('summiert die Teilstrecken', () => {
    const viaAugsburg = polylineLengthKm([MUNICH, AUGSBURG, NUREMBERG])
    const direct = distanceKm(MUNICH, NUREMBERG)
    expect(viaAugsburg).toBeCloseTo(distanceKm(MUNICH, AUGSBURG) + distanceKm(AUGSBURG, NUREMBERG), 6)
    // Der Umweg ueber Augsburg ist zwangslaeufig laenger als die Luftlinie.
    expect(viaAugsburg).toBeGreaterThan(direct)
  })

  it('liefert null fuer weniger als zwei Punkte', () => {
    expect(polylineLengthKm([])).toBe(0)
    expect(polylineLengthKm([MUNICH])).toBe(0)
  })
})

describe('bboxOf', () => {
  it('umschliesst alle Punkte', () => {
    const box = bboxOf([MUNICH, NUREMBERG, AUGSBURG])
    expect(box).toEqual({ minLng: 10.898, minLat: 48.137, maxLng: 11.575, maxLat: 49.454 })
  })

  it('liefert null ohne Punkte', () => {
    expect(bboxOf([])).toBeNull()
  })
})
