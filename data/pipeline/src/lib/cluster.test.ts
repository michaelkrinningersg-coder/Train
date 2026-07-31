import { describe, expect, it } from 'vitest'
import { absorbShare, clusterAgglomerations, deduplicate, MERGE_RADIUS_KM } from './cluster.js'
import type { GeoNamesPlace } from './geonames.js'

const place = (name: string, population: number, lng: number, lat: number): GeoNamesPlace => ({
  geonameId: name,
  name,
  country: 'DE',
  admin1: '02',
  admin2: '',
  lng,
  lat,
  population,
  featureCode: 'PPL',
})

describe('absorbShare', () => {
  it('schlaegt direkte Nachbarn stark zu', () => {
    expect(absorbShare(0)).toBeCloseTo(0.6, 6)
  })

  it('faellt mit der Entfernung', () => {
    expect(absorbShare(5)).toBeLessThan(absorbShare(1))
    expect(absorbShare(15)).toBeLessThan(absorbShare(5))
  })

  it('kappt Rauschen am Rand des Suchradius', () => {
    expect(absorbShare(MERGE_RADIUS_KM - 1)).toBe(0)
    expect(absorbShare(MERGE_RADIUS_KM + 10)).toBe(0)
  })
})

describe('deduplicate', () => {
  it('entfernt denselben Ort und behaelt den groesseren Eintrag', () => {
    const result = deduplicate([place('Passau', 50_000, 13.43, 48.57), place('Passau', 20_000, 13.44, 48.58)])
    expect(result).toHaveLength(1)
    expect(result[0]?.population).toBe(50_000)
  })

  it('behaelt gleichnamige Orte in verschiedenen Gegenden', () => {
    expect(deduplicate([place('Neustadt', 30_000, 8.14, 49.35), place('Neustadt', 25_000, 11.12, 50.33)])).toHaveLength(2)
  })
})

describe('clusterAgglomerations', () => {
  it('schlaegt einen nahen Vorort dem Zentrum zu, behaelt ihn aber als Ort', () => {
    // Rund 8 km auseinander.
    const cities = clusterAgglomerations(
      [place('Grossstadt', 500_000, 11.575, 48.137), place('Vorort', 40_000, 11.575, 48.209)],
      20_000,
    )

    const centre = cities.find((c) => c.place.name === 'Grossstadt')
    const suburb = cities.find((c) => c.place.name === 'Vorort')

    expect(centre?.population).toBeGreaterThan(500_000)
    expect(suburb).toBeDefined()
    expect(suburb?.population).toBeLessThan(40_000)
    // Was das Zentrum gewinnt, verliert der Vorort - es entstehen keine Einwohner.
    expect((centre?.population ?? 0) + (suburb?.population ?? 0)).toBe(540_000)
  })

  it('laesst eine entfernte Stadt unangetastet', () => {
    // Rund 150 km auseinander.
    const cities = clusterAgglomerations(
      [place('Muenchen', 1_500_000, 11.575, 48.137), place('Nuernberg', 500_000, 11.078, 49.454)],
      20_000,
    )
    expect(cities.map((c) => c.population).sort((a, b) => b - a)).toEqual([1_500_000, 500_000])
  })

  it('verschmilzt keine zwei aehnlich grossen Nachbarstaedte', () => {
    const cities = clusterAgglomerations(
      [place('Stadt A', 100_000, 11.575, 48.137), place('Stadt B', 90_000, 11.575, 48.19)],
      20_000,
    )
    expect(cities.map((c) => c.population).sort((a, b) => b - a)).toEqual([100_000, 90_000])
  })
})
