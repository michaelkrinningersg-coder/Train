import { SEGMENTS, SEGMENT_IDS, cityId, cityRadiusKm, type City } from '@game/domain'
import { describe, expect, it } from 'vitest'
import { buildDemandMatrix, decay, odKey } from './gravity.js'
import { carAlternative, generalisedCost, incumbentTransit, modeShares, noTravelAlternative, waitFromHeadway, type Alternative } from './modeChoice.js'
import { cityPotentials, facilityBoost } from './potentials.js'
import { assertProfilesConsistent, dayFactor, hourShare } from './profiles.js'

const city = (name: string, population: number, lng: number, lat: number, facilities: City['facilities'] = []): City => ({
  id: cityId(name),
  name,
  country: 'DE',
  centre: [lng, lat],
  population,
  radiusKm: cityRadiusKm(population),
  facilities,
})

describe('Verkehrserzeugung', () => {
  it('skaliert das Quellpotenzial linear mit der Einwohnerzahl', () => {
    const small = cityPotentials(city('A', 100_000, 11, 48))
    const large = cityPotentials(city('B', 400_000, 11, 48))
    expect(large.commuter.origin / small.commuter.origin).toBeCloseTo(4, 6)
  })

  it('laesst Einrichtungen nur auf die Zielattraktivitaet wirken', () => {
    const plain = cityPotentials(city('A', 100_000, 11, 48))
    const uni = cityPotentials(city('B', 100_000, 11, 48, [{ type: 'university', size: 3 }]))

    expect(uni.student.origin).toBeCloseTo(plain.student.origin, 6)
    expect(uni.student.destination).toBeCloseTo(plain.student.destination * 4.0, 6)
    // Andere Segmente bleiben unberuehrt.
    expect(uni.commuter.destination).toBeCloseTo(plain.commuter.destination, 6)
  })

  it('multipliziert mehrere Einrichtungen desselben Segments', () => {
    const c = city('B', 100_000, 11, 48, [
      { type: 'landmark', size: 2 },
      { type: 'nature', size: 1 },
    ])
    expect(facilityBoost(c, 'tourist', 5)).toBeCloseTo(2.5 * 1.4, 6)
  })
})

describe('Abklingfunktion', () => {
  it('faellt monoton oberhalb der segmenteigenen Mindestdistanz', () => {
    for (const seg of SEGMENT_IDS) {
      // Unterhalb minDistanceKm ist die Funktion bewusst konstant, deshalb wird
      // ab dieser Grenze gemessen.
      const d0 = SEGMENTS[seg].minDistanceKm
      expect(decay(d0 * 4, seg)).toBeLessThan(decay(d0 * 2, seg))
      expect(decay(d0 * 2, seg)).toBeLessThan(decay(d0, seg))
    }
  })

  it('reicht bei Geschaeftsreisenden weiter als bei Schuelern', () => {
    const ratio = (seg: 'business' | 'pupil'): number => decay(300, seg) / decay(30, seg)
    expect(ratio('business')).toBeGreaterThan(ratio('pupil'))
  })

  it('ist unterhalb der Mindestdistanz konstant', () => {
    expect(decay(1, 'commuter')).toBeCloseTo(decay(SEGMENTS.commuter.minDistanceKm, 'commuter'), 9)
  })
})

describe('Gravitationsmodell', () => {
  const cities = [
    city('Gross', 1_000_000, 11.5, 48.1),
    city('Mittel', 300_000, 10.9, 48.4),
    city('Klein', 50_000, 12.1, 49.0),
  ]

  it('verteilt genau das Quellpotenzial einer Stadt', () => {
    const matrix = buildDemandMatrix(cities, { minTripsPerDay: 0 })
    const potentials = cityPotentials(cities[0]!)

    const outgoing = matrix.pairs
      .filter((p) => p.from === cities[0]!.id)
      .reduce((s, p) => s + p.trips.commuter, 0)

    expect(outgoing).toBeCloseTo(potentials.commuter.origin, 4)
  })

  it('ist gerichtet: die grosse Stadt zieht mehr an als sie in die kleine schickt', () => {
    const matrix = buildDemandMatrix(cities, { minTripsPerDay: 0 })
    const toBig = matrix.byKey.get(odKey(cities[2]!.id, cities[0]!.id))!
    const toSmall = matrix.byKey.get(odKey(cities[0]!.id, cities[2]!.id))!
    expect(toBig.totalTrips / cities[2]!.population).toBeGreaterThan(toSmall.totalTrips / cities[0]!.population)
  })

  it('verwirft Relationen unterhalb der Schwelle', () => {
    const all = buildDemandMatrix(cities, { minTripsPerDay: 0 })
    expect(all.pairs).toHaveLength(6)

    const threshold = Math.max(...all.pairs.map((p) => p.totalTrips)) / 2
    const filtered = buildDemandMatrix(cities, { minTripsPerDay: threshold })
    expect(filtered.pairs.length).toBeLessThan(all.pairs.length)
    expect(filtered.pairs.every((p) => p.totalTrips >= threshold)).toBe(true)
  })
})

describe('Verkehrsmittelwahl', () => {
  const bus = (priceCents: number, headwayMin = 60): Alternative => ({
    mode: 'bus',
    priceCents,
    travelTimeSec: 3600,
    waitTimeSec: waitFromHeadway(headwayMin),
    transfers: 0,
    comfort: 0.6,
  })
  const context = (b: Alternative): Alternative[] => [b, carAlternative(60), noTravelAlternative]

  it('liefert Anteile, die sich zu eins summieren', () => {
    for (const seg of SEGMENT_IDS) {
      const shares = modeShares(seg, context(bus(1000)))
      expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    }
  })

  it('verliert Fahrgaeste, wenn der Preis steigt', () => {
    const cheap = modeShares('commuter', context(bus(500))).bus
    const dear = modeShares('commuter', context(bus(2500))).bus
    expect(dear).toBeLessThan(cheap)
  })

  it('gewinnt Fahrgaeste, wenn der Takt dichter wird', () => {
    const sparse = modeShares('commuter', context(bus(1000, 120))).bus
    const dense = modeShares('commuter', context(bus(1000, 20))).bus
    expect(dense).toBeGreaterThan(sparse)
  })

  it('reagiert bei Geschaeftsreisenden schwaecher auf den Preis als bei Schuelern', () => {
    const elasticity = (seg: 'business' | 'pupil'): number => {
      const cheap = modeShares(seg, context(bus(500))).bus
      const dear = modeShares(seg, context(bus(2500))).bus
      return cheap > 0 ? (cheap - dear) / cheap : 0
    }
    expect(elasticity('business')).toBeLessThan(elasticity('pupil'))
  })

  it('bewertet Schuelerzeit niedriger als Geschaeftsreisendenzeit', () => {
    const slow: Alternative = { ...bus(1000), travelTimeSec: 7200 }
    const fast: Alternative = { ...bus(1000), travelTimeSec: 1800 }
    const gain = (seg: 'business' | 'pupil'): number =>
      generalisedCost(seg, slow) - generalisedCost(seg, fast)
    expect(gain('business')).toBeGreaterThan(gain('pupil'))
  })

  it('stellt zwischen kleinen Staedten ein schwaecheres Bestandsangebot bereit', () => {
    const big = incumbentTransit(60, 500_000)
    const small = incumbentTransit(60, 20_000)
    expect(small.travelTimeSec).toBeGreaterThan(big.travelTimeSec)
    expect(small.waitTimeSec).toBeGreaterThanOrEqual(big.waitTimeSec)
    expect(small.transfers).toBeGreaterThan(big.transfers)
  })

  it('nimmt dem Bus Anteile weg, sobald der Bestandsverkehr mitspielt', () => {
    const withoutRail = modeShares('commuter', context(bus(1000))).bus
    const withRail = modeShares('commuter', [...context(bus(1000)), incumbentTransit(60, 500_000)]).bus
    expect(withRail).toBeLessThan(withoutRail)
  })
})

describe('Ganglinien', () => {
  it('sind vollstaendig', () => {
    expect(() => assertProfilesConsistent()).not.toThrow()
  })

  it('summieren sich ueber den Tag zu eins', () => {
    for (const seg of SEGMENT_IDS) {
      const sum = Array.from({ length: 24 }, (_, h) => hourShare(seg, h)).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 9)
    }
  })

  it('setzt die Pendlerspitze in den Berufsverkehr', () => {
    expect(hourShare('commuter', 7)).toBeGreaterThan(hourShare('commuter', 11))
    expect(hourShare('commuter', 17)).toBeGreaterThan(hourShare('commuter', 11))
    expect(hourShare('commuter', 3)).toBe(0)
  })

  it('laesst Schuelerverkehr am Wochenende und in den Sommerferien einbrechen', () => {
    expect(dayFactor('pupil', 6, 2)).toBeLessThan(0.1)
    expect(dayFactor('pupil', 0, 7)).toBeLessThan(dayFactor('pupil', 0, 2))
  })

  it('hebt Tourismus im Sommer an', () => {
    expect(dayFactor('tourist', 5, 7)).toBeGreaterThan(dayFactor('tourist', 5, 10))
  })
})

/**
 * Die Fernverkehrskalibrierung, festgenagelt.
 *
 * Sie ist gegen veröffentlichte Zahlen gefittet (siehe `tools/fernverkehr.ts`),
 * und genau deshalb muss sie einen Regressionstest haben: die Segmenttabelle
 * lädt zum Drehen ein, und wer dort eine Zahl ändert, verschiebt die
 * Größenordnung des ganzen Spiels, ohne dass irgendetwas fehlschlägt.
 *
 * Geprüft wird an einem **kleinen, eigenen Städtesatz** und nicht am
 * Deutschland-Datensatz: der Test soll die Parameter festhalten, nicht die
 * Datenpipeline mitprüfen, und er soll in Millisekunden laufen.
 */
describe('Fernverkehrskalibrierung', () => {
  // Zwei große Städte weit auseinander, zwei kleine dazwischen.
  const REFERENCE = [
    city('Nordstadt', 1_800_000, 10.0, 53.55),
    city('Südstadt', 1_500_000, 11.58, 48.14),
    city('Mittelstadt', 200_000, 9.5, 51.3),
    city('Nachbarort', 60_000, 10.2, 53.3),
  ]

  const matrix = (): ReturnType<typeof buildDemandMatrix> =>
    buildDemandMatrix(REFERENCE, { minTripsPerDay: 0 })

  it('schickt den größeren Teil der Verkehrsleistung über 100 km', () => {
    const m = matrix()
    const pkm = (min: number): number =>
      m.pairs.filter((p) => p.distanceKm >= min).reduce((s, p) => s + p.totalTrips * p.distanceKm, 0)
    // Fernreisen sind wenige Fahrten, aber der Löwenanteil der Leistung. Vor
    // der Kalibrierung lag dieser Anteil bei rund einem Drittel.
    expect(pkm(100) / pkm(0)).toBeGreaterThan(0.85)
  })

  it('lässt die Fernsegmente den Fernverkehr tragen', () => {
    const m = matrix()
    const far = m.pairs.filter((p) => p.distanceKm >= 100)
    const share = (id: (typeof SEGMENT_IDS)[number]): number =>
      far.reduce((s, p) => s + p.trips[id], 0) / far.reduce((s, p) => s + p.totalTrips, 0)
    // Über 100 km fahren Besuchs-, Urlaubs- und Geschäftsreisende, keine
    // Pendler. Auf dem Deutschland-Datensatz sind es 90 % gegen 10 %; dieser
    // Satz aus vier Städten ist gröber, die Aussage bleibt dieselbe.
    expect(share('vfr') + share('tourist') + share('business')).toBeGreaterThan(0.65)
    expect(share('commuter')).toBeLessThan(0.3)
  })

  it('hält die Erzeugungsraten dort, wo sie gemessen wurden', () => {
    // In Reisen je Einwohner und Jahr — die Größe, in der sich die Werte gegen
    // die Wirklichkeit prüfen lassen. Ändert sich einer, war das hoffentlich
    // Absicht: siehe docs/03-NACHFRAGEMODELL.md Abschnitt 8.
    const perYear = (id: (typeof SEGMENT_IDS)[number]): number =>
      SEGMENTS[id].populationShare * SEGMENTS[id].tripsPerPersonDay * 365
    expect(perYear('business')).toBeCloseTo(2.19, 1)
    expect(perYear('tourist')).toBeCloseTo(8.76, 1)
    expect(perYear('vfr')).toBeCloseTo(17.52, 1)
  })

  it('lässt sich für die Kalibrierung von außen andere Parameter geben', () => {
    // Ohne diesen Weg müsste `pnpm fernverkehr` die Segmenttabelle im
    // Quelltext ändern und den Prozess neu starten, um einen zweiten Wert zu
    // probieren.
    const doubled = { ...SEGMENTS, vfr: { ...SEGMENTS.vfr, tripsPerPersonDay: SEGMENTS.vfr.tripsPerPersonDay * 2 } }
    const before = matrix().totalTripsPerDay
    const after = buildDemandMatrix(REFERENCE, { minTripsPerDay: 0, params: doubled }).totalTripsPerDay
    expect(after).toBeGreaterThan(before * 1.2)
  })
})
