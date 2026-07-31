import { capacityFactor, cityId, cityRadiusKm, isUnderConstruction, type City, type GameState } from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { trackBuildCost, trackUpgradeCost } from '@game/economy'
import type { ElevationGrid } from '@game/geo'
import { beforeEach, describe, expect, it } from 'vitest'
import { advanceDays } from './advance.js'
import { applyCommand } from './commands.js'
import { previewTrack } from './railCommands.js'
import { createGame } from './state.js'

const city = (name: string, population: number, lng: number, lat: number): City => ({
  id: cityId(name),
  name,
  country: 'DE',
  centre: [lng, lat],
  population,
  radiusKm: cityRadiusKm(population),
  facilities: [],
})

const CITIES = withPotentials([
  city('Muenchen', 1_500_000, 11.575, 48.137),
  city('Augsburg', 340_000, 10.898, 48.371),
])

/**
 * Kleines Kunstgelände: flach im Westen, ansteigend nach Osten. Damit lässt
 * sich prüfen, dass der Geländefaktor überhaupt greift, ohne echte Höhendaten
 * in den Test zu ziehen.
 */
function slopeGrid(metresPerCell: number): ElevationGrid {
  const cols = 40
  const rows = 40
  const data = new Int16Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) data[r * cols + c] = c * metresPerCell
  }
  return {
    bounds: { west: 10.5, east: 12.1, south: 47.9, north: 48.6 },
    cols,
    rows,
    stepDeg: 0.04,
    noData: -32768,
    data,
  }
}

const SPEC = { maxSpeed: 120, electrified: false, tracks: 1, signalling: 'classic' } as const

let demand: DemandMatrix
let base: GameState

/** Zwei Bahnhöfe, jeweils im Stadtzentrum. */
function withStations(cash = 500_000_000_00): GameState {
  let state = createGame({ cities: CITIES, startingCash: cash })
  for (const c of CITIES) {
    const r = applyCommand(state, { kind: 'place_station', cityId: c.id, position: c.centre, platforms: 2 })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
  }
  return state
}

function nodeOf(state: GameState, name: string) {
  const station = [...state.network.stations.values()].find((s) => s.name === name)
  if (!station) throw new Error(`Bahnhof ${name} fehlt`)
  return station.nodeId
}

beforeEach(() => {
  demand = buildDemandMatrix(CITIES, { minTripsPerDay: 0 })
  base = withStations()
})

describe('Bahnhofsbau', () => {
  it('erschliesst im Zentrum die ganze Stadt und kostet dort am meisten', () => {
    const centre = applyCommand(createGame({ cities: CITIES, startingCash: 500_000_000_00 }), {
      kind: 'place_station',
      cityId: CITIES[0]!.id,
      position: CITIES[0]!.centre,
      platforms: 2,
    })
    const edge = applyCommand(createGame({ cities: CITIES, startingCash: 500_000_000_00 }), {
      kind: 'place_station',
      cityId: CITIES[0]!.id,
      // Rund 20 km oestlich - am Rand des Stadtgebiets.
      position: [CITIES[0]!.centre[0] + 0.27, CITIES[0]!.centre[1]],
      platforms: 2,
    })

    expect(centre.ok && edge.ok).toBe(true)
    if (!centre.ok || !edge.ok) return

    const centreStation = [...centre.state.network.stations.values()][0]!
    const edgeStation = [...edge.state.network.stations.values()][0]!

    expect(centreStation.catchment).toBeGreaterThan(edgeStation.catchment)
    expect(centre.cost).toBeGreaterThan(edge.cost)
  })

  it('lehnt Standorte weit ausserhalb der Stadt ab', () => {
    const r = applyCommand(base, {
      kind: 'place_station',
      cityId: CITIES[1]!.id,
      position: [CITIES[1]!.centre[0] + 2, CITIES[1]!.centre[1]],
      platforms: 2,
    })
    expect(r.ok).toBe(false)
  })

  it('legt zu jedem Bahnhof einen Netzknoten an', () => {
    expect(base.network.stations.size).toBe(2)
    expect(base.network.nodes.size).toBe(2)
    for (const station of base.network.stations.values()) {
      expect(base.network.nodes.get(station.nodeId)?.kind).toBe('station')
    }
  })

  it('erlaubt nur einen Bahnhof je Stadt', () => {
    const r = applyCommand(base, {
      kind: 'place_station',
      cityId: CITIES[0]!.id,
      position: CITIES[0]!.centre,
      platforms: 2,
    })
    expect(r.ok).toBe(false)
  })
})

describe('Streckenbau', () => {
  it('baut eine Strecke zwischen zwei Bahnhoefen und bucht die Kosten', () => {
    const from = nodeOf(base, 'Muenchen')
    const to = nodeOf(base, 'Augsburg')
    const r = applyCommand(base, { kind: 'build_track', from, to, geometry: [], spec: SPEC })

    expect(r.ok).toBe(true)
    if (!r.ok) return

    const track = [...r.state.network.tracks.values()][0]!
    expect(track.lengthKm).toBeGreaterThan(50)
    expect(track.lengthKm).toBeLessThan(65)
    expect(r.state.cash).toBe(base.cash - r.cost)
    // Frisch gebaut ist noch nicht befahrbar.
    expect(capacityFactor(track, r.state.day)).toBe(0)
    expect(track.readyOnDay).toBeGreaterThan(r.state.day)
  })

  it('nimmt Stuetzpunkte in die Trasse auf und wird dadurch laenger', () => {
    const from = nodeOf(base, 'Muenchen')
    const to = nodeOf(base, 'Augsburg')
    const direct = applyCommand(base, { kind: 'build_track', from, to, geometry: [], spec: SPEC })
    const detour = applyCommand(base, {
      kind: 'build_track',
      from,
      to,
      geometry: [CITIES[0]!.centre, [11.2, 48.6], CITIES[1]!.centre],
      spec: SPEC,
    })

    expect(direct.ok && detour.ok).toBe(true)
    if (!direct.ok || !detour.ok) return

    const a = [...direct.state.network.tracks.values()][0]!
    const b = [...detour.state.network.tracks.values()][0]!
    expect(b.lengthKm).toBeGreaterThan(a.lengthKm)
    expect(detour.cost).toBeGreaterThan(direct.cost)
  })

  it('verhindert eine zweite Strecke zwischen denselben Knoten', () => {
    const from = nodeOf(base, 'Muenchen')
    const to = nodeOf(base, 'Augsburg')
    const first = applyCommand(base, { kind: 'build_track', from, to, geometry: [], spec: SPEC })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = applyCommand(first.state, { kind: 'build_track', from: to, to: from, geometry: [], spec: SPEC })
    expect(second.ok).toBe(false)
  })

  it('lehnt den Bau ohne Deckung ab', () => {
    // Bahnhoefe zuerst bauen, dann die Kasse leeren - sonst scheitert schon
    // der Bahnhofsbau und der Test pruefte etwas anderes als gemeint.
    const poor: GameState = { ...base, cash: 20_000_000_00 }
    const r = applyCommand(poor, {
      kind: 'build_track',
      from: nodeOf(poor, 'Muenchen'),
      to: nodeOf(poor, 'Augsburg'),
      geometry: [],
      spec: SPEC,
    })
    expect(r.ok).toBe(false)
  })
})

describe('Gelaende', () => {
  const path = [CITIES[0]!.centre, CITIES[1]!.centre]

  it('macht bergiges Gelaende teurer als flaches', () => {
    const flat = previewTrack(path, SPEC, slopeGrid(0))
    const hilly = previewTrack(path, SPEC, slopeGrid(30))

    expect(flat.terrainFactor).toBeCloseTo(1, 3)
    expect(hilly.terrainFactor).toBeGreaterThan(1.5)
    expect(hilly.cost).toBeGreaterThan(flat.cost)
    expect(hilly.buildDays).toBeGreaterThan(flat.buildDays)
  })

  it('kappt die Streckensteigung, auch wenn das Gelaende steiler ist', () => {
    const steep = previewTrack(path, SPEC, slopeGrid(200))
    expect(steep.gradientPermille).toBeLessThanOrEqual(25)
    expect(steep.terrainFactor).toBeCloseTo(3.5, 1)
  })

  it('nimmt ohne Hoehenraster flaches Land an', () => {
    const none = previewTrack(path, SPEC, undefined)
    expect(none.terrainFactor).toBe(1)
    expect(none.gradientPermille).toBe(0)
  })
})

describe('Baukosten', () => {
  it('steigen mit Geschwindigkeit, Gleiszahl und Fahrdraht', () => {
    const simple = trackBuildCost(100, SPEC, 1)
    expect(trackBuildCost(100, { ...SPEC, maxSpeed: 300 }, 1)).toBeGreaterThan(simple)
    expect(trackBuildCost(100, { ...SPEC, tracks: 2 }, 1)).toBeGreaterThan(simple)
    expect(trackBuildCost(100, { ...SPEC, electrified: true }, 1)).toBeGreaterThan(simple)
    expect(trackBuildCost(100, { ...SPEC, signalling: 'etcs_l2' }, 1)).toBeGreaterThan(simple)
  })

  it('sind linear in der Laenge', () => {
    expect(trackBuildCost(200, SPEC, 1) / trackBuildCost(100, SPEC, 1)).toBeCloseTo(2, 6)
  })
})

describe('Ausbau', () => {
  function built(): GameState {
    const r = applyCommand(base, {
      kind: 'build_track',
      from: nodeOf(base, 'Muenchen'),
      to: nodeOf(base, 'Augsburg'),
      geometry: [],
      spec: SPEC,
    })
    if (!r.ok) throw new Error(r.reason)
    // Bis zur Fertigstellung vorspulen.
    const track = [...r.state.network.tracks.values()][0]!
    return advanceDays(r.state, demand, track.readyOnDay - r.state.day)
  }

  it('ist erst nach der Fertigstellung moeglich', () => {
    const r = applyCommand(base, {
      kind: 'build_track',
      from: nodeOf(base, 'Muenchen'),
      to: nodeOf(base, 'Augsburg'),
      geometry: [],
      spec: SPEC,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const trackId = [...r.state.network.tracks.keys()][0]!
    const tooEarly = applyCommand(r.state, {
      kind: 'upgrade_track',
      trackId,
      upgrade: { kind: 'electrify' },
    })
    expect(tooEarly.ok).toBe(false)
  })

  it('elektrifiziert und erhoeht damit den Unterhalt', () => {
    const state = built()
    const trackId = [...state.network.tracks.keys()][0]!
    const before = state.network.tracks.get(trackId)!

    const r = applyCommand(state, { kind: 'upgrade_track', trackId, upgrade: { kind: 'electrify' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const after = r.state.network.tracks.get(trackId)!
    expect(after.electrified).toBe(true)
    expect(after.construction).toBeDefined()
    expect(isUnderConstruction(after, r.state.day)).toBe(true)
    expect(r.cost).toBe(trackUpgradeCost(before, { kind: 'electrify' }))
  })

  it('beendet den Ausbau nach Ablauf der Bauzeit', () => {
    const state = built()
    const trackId = [...state.network.tracks.keys()][0]!
    const r = applyCommand(state, { kind: 'upgrade_track', trackId, upgrade: { kind: 'speed', to: 200 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const works = r.state.network.tracks.get(trackId)!.construction!
    const done = advanceDays(r.state, demand, works.finishesOnDay - r.state.day)
    const track = done.network.tracks.get(trackId)!

    expect(track.construction).toBeUndefined()
    expect(track.maxSpeed).toBe(200)
    expect(capacityFactor(track, done.day)).toBe(1)
  })

  it('verweigert einen zweiten Ausbau, solange einer laeuft', () => {
    const state = built()
    const trackId = [...state.network.tracks.keys()][0]!
    const first = applyCommand(state, { kind: 'upgrade_track', trackId, upgrade: { kind: 'electrify' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = applyCommand(first.state, {
      kind: 'upgrade_track',
      trackId,
      upgrade: { kind: 'speed', to: 160 },
    })
    expect(second.ok).toBe(false)
  })

  it('lehnt einen Ausbau ab, der nichts aendert', () => {
    const state = built()
    const trackId = [...state.network.tracks.keys()][0]!
    const r = applyCommand(state, { kind: 'upgrade_track', trackId, upgrade: { kind: 'speed', to: 80 } })
    expect(r.ok).toBe(false)
  })
})

describe('Unterhalt', () => {
  it('belastet das Ergebnis, auch wenn kein Zug faehrt', () => {
    const r = applyCommand(base, {
      kind: 'build_track',
      from: nodeOf(base, 'Muenchen'),
      to: nodeOf(base, 'Augsburg'),
      geometry: [],
      spec: SPEC,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const after = advanceDays(r.state, demand, 1)
    const upkeep = after.ledger.filter((e) => e.category === 'track_upkeep')
    expect(upkeep).toHaveLength(1)
    expect(upkeep[0]!.amount).toBeLessThan(0)
    expect(after.lastDay!.profit).toBeLessThan(0)
  })

  it('faellt bei Rueckbau wieder weg', () => {
    const built = applyCommand(base, {
      kind: 'build_track',
      from: nodeOf(base, 'Muenchen'),
      to: nodeOf(base, 'Augsburg'),
      geometry: [],
      spec: SPEC,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const trackId = [...built.state.network.tracks.keys()][0]!
    const removed = applyCommand(built.state, { kind: 'demolish_track', trackId })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return

    expect(removed.state.network.tracks.size).toBe(0)
    // Rueckbau bringt Schrotterloes.
    expect(removed.state.cash).toBeGreaterThan(built.state.cash)
  })
})
