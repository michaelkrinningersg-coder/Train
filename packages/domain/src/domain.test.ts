import { describe, expect, it } from 'vitest'
import { cityRadiusKm } from './city.js'
import { canTraverse } from './fleet.js'
import { expandDepartures, fareFor, type FarePolicy, type ServicePattern } from './lines.js'
import { stationCatchment, trackUpkeepPerDay, type TrackSegment } from './network.js'
import { lineId, patternId, trackId, nodeId } from './ids.js'

describe('cityRadiusKm', () => {
  it('waechst mit der Wurzel der Einwohnerzahl', () => {
    expect(cityRadiusKm(100_000)).toBeCloseTo(6.93, 1)
    expect(cityRadiusKm(1_000_000)).toBeCloseTo(21.9, 1)
    // Vervierfachte Einwohnerzahl verdoppelt den Radius.
    expect(cityRadiusKm(400_000) / cityRadiusKm(100_000)).toBeCloseTo(2, 6)
  })
})

describe('stationCatchment', () => {
  it('erschliesst im Zentrum die ganze Stadt', () => {
    expect(stationCatchment(0, 10)).toBe(1)
  })

  it('faellt mit der Entfernung zum Zentrum', () => {
    const central = stationCatchment(1, 10)
    const edge = stationCatchment(8, 10)
    expect(central).toBeGreaterThan(edge)
  })

  it('faellt nie unter den Sockel von 0,15', () => {
    expect(stationCatchment(500, 10)).toBe(0.15)
  })
})

describe('canTraverse', () => {
  it('sperrt Elektrozuege auf nicht elektrifizierten Strecken', () => {
    expect(canTraverse('electric', false)).toBe(false)
    expect(canTraverse('electric', true)).toBe(true)
  })

  it('laesst Diesel und Zweikraft ueberall zu', () => {
    expect(canTraverse('diesel', false)).toBe(true)
    expect(canTraverse('bimodal', false)).toBe(true)
  })
})

describe('trackUpkeepPerDay', () => {
  const base: TrackSegment = {
    id: trackId('t1'),
    from: nodeId('a'),
    to: nodeId('b'),
    geometry: [
      [11, 48],
      [11, 49],
    ],
    lengthKm: 100,
    maxSpeed: 120,
    electrified: false,
    tracks: 1,
    signalling: 'classic',
    terrainFactor: 1,
    gradientPermille: 0,
    builtAt: 0,
  }

  it('rechnet die Basis linear nach Laenge', () => {
    expect(trackUpkeepPerDay(base)).toBe(100 * 4000)
  })

  it('macht schnelle, zweigleisige und elektrifizierte Strecken teurer', () => {
    const fast = trackUpkeepPerDay({ ...base, maxSpeed: 300, tracks: 2, electrified: true })
    // 2,8 (Tempo) x 1,8 (Gleise) x 1,25 (Fahrdraht) = 6,3-fach.
    expect(fast / trackUpkeepPerDay(base)).toBeCloseTo(6.3, 6)
  })
})

describe('fareFor', () => {
  const fare: FarePolicy = { perKm: { first: 30, second: 18 }, baseFare: 200, priceIndex: 1 }

  it('setzt sich aus Grundpreis und Entfernung zusammen', () => {
    expect(fareFor(fare, 100, 'second')).toBe(200 + 18 * 100)
  })

  it('skaliert nur den Entfernungsanteil mit dem Preisindex', () => {
    expect(fareFor({ ...fare, priceIndex: 2 }, 100, 'second')).toBe(200 + 18 * 100 * 2)
  })
})

describe('expandDepartures', () => {
  const pattern = (extra: Partial<ServicePattern>): ServicePattern => ({
    id: patternId('p1'),
    lineId: lineId('l1'),
    direction: 'forward',
    vehicleIds: [],
    days: 127,
    ...extra,
  })

  it('entfaltet einen festen Takt', () => {
    const departures = expandDepartures(
      pattern({ headway: { everyMinutes: 60, firstDeparture: 6 * 3600, lastDeparture: 9 * 3600 } }),
    )
    expect(departures).toEqual([6 * 3600, 7 * 3600, 8 * 3600, 9 * 3600])
  })

  it('bevorzugt explizite Abfahrtszeiten', () => {
    const explicit = [100, 200]
    expect(expandDepartures(pattern({ departures: explicit, headway: { everyMinutes: 60, firstDeparture: 0, lastDeparture: 3600 } }))).toBe(
      explicit,
    )
  })

  it('liefert nichts ohne Takt und ohne Zeiten', () => {
    expect(expandDepartures(pattern({}))).toEqual([])
  })
})
