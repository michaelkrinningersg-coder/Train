import {
  MAX_PLATFORMS,
  cityRadiusKm,
  nodeId as brandNode,
  stationCatchment,
  trackUpkeepPerDay,
  type Command,
  type CommandResult,
  type GameState,
  type LedgerEntry,
  type LngLat,
  type NetworkNode,
  type Station,
  type TrackSegment,
} from '@game/domain'
import {
  capacityDuringWorks,
  railStationCost,
  railStationUpkeep,
  stationExpansionCost,
  stationExpansionDays,
  trackRenewalCost,
  trackRenewalDays,
  trackBuildCost,
  trackBuildDays,
  trackDemolitionValue,
  passingLoopCost,
  passingLoopDays,
  trackUpgradeCost,
  trackUpgradeDays,
} from '@game/economy'
import {
  distanceKm,
  nearestPointOnPath,
  polylineLengthKm,
  splitPath,
  terrainStats,
  type ElevationGrid,
} from '@game/geo'
import { newStationId, withMap } from './state.js'

/** Zusatzwissen, das die Befehle brauchen, aber nicht im Spielzustand steht. */
export interface CommandContext {
  readonly elevation?: ElevationGrid | undefined
}

const fail = (reason: string): CommandResult => ({ ok: false, reason })

function book(state: GameState, entry: Omit<LedgerEntry, 'day'>): GameState {
  const full: LedgerEntry = { day: state.day, ...entry }
  return { ...state, cash: state.cash + full.amount, ledger: [...state.ledger, full] }
}

/** Geländebewertung einer Trasse. Ohne Höhenraster wird flaches Land angenommen. */
export function evaluateTerrain(
  geometry: readonly LngLat[],
  elevation: ElevationGrid | undefined,
): { terrainFactor: number; gradientPermille: number } {
  if (!elevation) return { terrainFactor: 1, gradientPermille: 0 }
  const stats = terrainStats(elevation, geometry)
  return { terrainFactor: stats.terrainFactor, gradientPermille: stats.gradientPermille }
}

/** Vorschau der Baukosten, ohne den Zustand zu verändern - für die Anzeige beim Ziehen. */
export function previewTrack(
  geometry: readonly LngLat[],
  spec: { maxSpeed: TrackSegment['maxSpeed']; electrified: boolean; tracks: TrackSegment['tracks']; signalling: TrackSegment['signalling'] },
  elevation: ElevationGrid | undefined,
): { lengthKm: number; terrainFactor: number; gradientPermille: number; cost: number; buildDays: number } {
  const lengthKm = polylineLengthKm(geometry)
  const { terrainFactor, gradientPermille } = evaluateTerrain(geometry, elevation)
  return {
    lengthKm,
    terrainFactor,
    gradientPermille,
    cost: trackBuildCost(lengthKm, spec, terrainFactor),
    buildDays: trackBuildDays(lengthKm, terrainFactor),
  }
}

/** Nächster freier Streckenbezeichner. */
function newTrackId(state: GameState): string {
  let n = state.network.tracks.size + 1
  while (state.network.tracks.has(`tr${n}` as never)) n++
  return `tr${n}`
}

/**
 * Befehle rund um das Schienennetz. Bewusst von den Busbefehlen getrennt: sie
 * brauchen als einzige das Höhenraster und sind deutlich umfangreicher.
 */
export function applyRailCommand(state: GameState, command: Command, ctx: CommandContext = {}): CommandResult {
  switch (command.kind) {
    case 'place_station': {
      const city = state.cities.get(command.cityId)
      if (!city) return fail('Unbekannte Stadt.')

      const platforms = Math.max(1, Math.min(MAX_PLATFORMS, Math.round(command.platforms)))
      const distance = distanceKm(city.centre, command.position)
      const radius = cityRadiusKm(city.population)

      // Weiter als der doppelte Stadtradius ist es kein Bahnhof dieser Stadt mehr.
      if (distance > radius * 2) {
        return fail(`Der Standort liegt zu weit von ${city.name} entfernt (${distance.toFixed(1)} km).`)
      }

      const existing = [...state.network.stations.values()].find(
        (s) => s.cityId === command.cityId && s.mode !== 'bus',
      )
      if (existing) return fail(`${city.name} hat bereits einen Bahnhof.`)

      const cost = railStationCost(city.population, distance, platforms)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const id = newStationId(state)
      const node: NetworkNode = {
        id: brandNode(`n-${id}`),
        position: command.position,
        kind: 'station',
        stationId: id,
      }
      const station: Station = {
        id,
        cityId: city.id,
        nodeId: node.id,
        name: city.name,
        position: command.position,
        mode: 'rail',
        platforms,
        catchment: stationCatchment(distance, radius),
        distanceToCentreKm: Number(distance.toFixed(2)),
        buildCost: cost,
        upkeepPerDay: railStationUpkeep(platforms),
      }

      const next: GameState = {
        ...state,
        network: {
          ...state.network,
          nodes: withMap(state.network.nodes, node.id, node),
          stations: withMap(state.network.stations, id, station),
        },
      }
      return {
        ok: true,
        cost,
        state: book(next, { category: 'construction', amount: -cost, note: `Bahnhof ${city.name}` }),
      }
    }

    case 'build_track': {
      const from = state.network.nodes.get(command.from)
      const to = state.network.nodes.get(command.to)
      if (!from || !to) return fail('Start- oder Zielknoten fehlt.')
      if (from.id === to.id) return fail('Start und Ziel sind derselbe Knoten.')

      const duplicate = [...state.network.tracks.values()].some(
        (t) =>
          (t.from === from.id && t.to === to.id) || (t.from === to.id && t.to === from.id),
      )
      if (duplicate) return fail('Zwischen diesen Knoten gibt es bereits eine Strecke.')

      // Die Geometrie beginnt und endet immer exakt an den Knoten.
      const geometry: LngLat[] = [from.position, ...command.geometry.slice(1, -1), to.position]
      const lengthKm = polylineLengthKm(geometry)
      if (lengthKm < 0.5) return fail('Die Strecke ist zu kurz.')

      const { terrainFactor, gradientPermille } = evaluateTerrain(geometry, ctx.elevation)
      const cost = trackBuildCost(lengthKm, command.spec, terrainFactor)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const id = newTrackId(state) as TrackSegment['id']
      const buildDays = trackBuildDays(lengthKm, terrainFactor)
      const track: TrackSegment = {
        id,
        from: from.id,
        to: to.id,
        geometry,
        lengthKm: Number(lengthKm.toFixed(3)),
        maxSpeed: command.spec.maxSpeed,
        electrified: command.spec.electrified,
        tracks: command.spec.tracks,
        signalling: command.spec.signalling,
        terrainFactor,
        gradientPermille,
        builtOnDay: state.day,
        readyOnDay: state.day + buildDays,
      }

      const next: GameState = {
        ...state,
        network: { ...state.network, tracks: withMap(state.network.tracks, id, track) },
      }
      return {
        ok: true,
        cost,
        state: book(next, {
          category: 'construction',
          amount: -cost,
          note: `Strecke ${lengthKm.toFixed(0)} km`,
        }),
      }
    }

    case 'renew_track': {
      const track = state.network.tracks.get(command.trackId)
      if (!track) return fail('Unbekannte Strecke.')
      if (state.day < track.readyOnDay) return fail('Die Strecke ist noch im Bau.')
      if (track.construction) return fail('Auf dieser Strecke laufen bereits Arbeiten.')

      const cost = trackRenewalCost(track)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const days = trackRenewalDays(track)
      const renewed: TrackSegment = {
        ...track,
        // Der Oberbau ist neu, also faengt das Alter von vorn an. Trasse und
        // Bauwerke bleiben - deshalb kostet es nur einen Bruchteil des Neubaus.
        builtOnDay: state.day + days,
        construction: {
          upgrade: { kind: 'speed', to: track.maxSpeed },
          finishesOnDay: state.day + days,
          capacityFactorDuringWorks: 0.5,
        },
      }

      const next: GameState = {
        ...state,
        network: { ...state.network, tracks: withMap(state.network.tracks, track.id, renewed) },
      }
      return {
        ok: true,
        cost,
        state: book(next, { category: 'construction', amount: -cost, note: 'Streckenerneuerung' }),
      }
    }

    case 'upgrade_station': {
      const station = state.network.stations.get(command.stationId)
      if (!station) return fail('Unbekannter Bahnhof.')
      if (station.mode === 'bus') return fail('Eine Bushaltestelle hat keine Bahnsteiggleise.')
      if (station.construction) return fail('An diesem Bahnhof läuft bereits ein Umbau.')

      const target = Math.max(1, Math.min(MAX_PLATFORMS, Math.round(command.platforms)))
      if (target <= station.platforms) {
        return fail(`${station.name} hat bereits ${station.platforms} Bahnsteiggleise.`)
      }

      const city = state.cities.get(station.cityId)
      if (!city) return fail('Unbekannte Stadt.')

      const cost = stationExpansionCost(city.population, station.distanceToCentreKm, station.platforms, target)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const days = stationExpansionDays(station.platforms, target)
      const expanded: Station = {
        ...station,
        platforms: target,
        upkeepPerDay: railStationUpkeep(target),
        buildCost: station.buildCost + cost,
        construction: {
          finishesOnDay: state.day + days,
          // Waehrend des Umbaus ist ein bestehendes Gleis gesperrt. Wer erst
          // ausbaut, wenn es eng ist, macht es zunaechst enger.
          platformsDuringWorks: Math.max(1, station.platforms - 1),
        },
      }

      const next: GameState = {
        ...state,
        network: { ...state.network, stations: withMap(state.network.stations, station.id, expanded) },
      }
      return {
        ok: true,
        cost,
        state: book(next, {
          category: 'construction',
          amount: -cost,
          note: `${station.name}: Ausbau auf ${target} Bahnsteiggleise`,
        }),
      }
    }

    case 'upgrade_track': {
      const track = state.network.tracks.get(command.trackId)
      if (!track) return fail('Unbekannte Strecke.')
      if (state.day < track.readyOnDay) return fail('Die Strecke ist noch im Bau.')
      if (track.construction) return fail('Auf dieser Strecke läuft bereits ein Ausbau.')

      const cost = trackUpgradeCost(track, command.upgrade)
      if (cost <= 0) return fail('Dieser Ausbau bringt nichts — die Strecke hat den Stand bereits.')
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const days = trackUpgradeDays(track, command.upgrade)
      const upgraded: TrackSegment = {
        ...track,
        // Die neue Eigenschaft gilt sofort im Datenmodell; befahrbar ist die
        // Strecke aber erst nach Ende der Bauzeit, dafuer sorgt `construction`.
        ...(command.upgrade.kind === 'speed' ? { maxSpeed: command.upgrade.to } : {}),
        ...(command.upgrade.kind === 'tracks' ? { tracks: command.upgrade.to } : {}),
        ...(command.upgrade.kind === 'signalling' ? { signalling: command.upgrade.to } : {}),
        ...(command.upgrade.kind === 'electrify' ? { electrified: true } : {}),
        construction: {
          upgrade: command.upgrade,
          finishesOnDay: state.day + days,
          capacityFactorDuringWorks: capacityDuringWorks(command.upgrade),
        },
      }

      const next: GameState = {
        ...state,
        network: { ...state.network, tracks: withMap(state.network.tracks, track.id, upgraded) },
      }
      return {
        ok: true,
        cost,
        state: book(next, { category: 'construction', amount: -cost, note: `Ausbau ${command.upgrade.kind}` }),
      }
    }

    case 'demolish_track': {
      const track = state.network.tracks.get(command.trackId)
      if (!track) return fail('Unbekannte Strecke.')

      const value = trackDemolitionValue(track)
      const next: GameState = {
        ...state,
        network: { ...state.network, tracks: withMap(state.network.tracks, track.id, undefined) },
      }
      return {
        ok: true,
        cost: -value,
        state: book(next, { category: 'construction', amount: value, note: 'Rückbau' }),
      }
    }

    case 'place_passing_loop': {
      const track = state.network.tracks.get(command.trackId)
      if (!track) return fail('Unbekannte Strecke.')
      if (state.day < track.readyOnDay) return fail('Die Strecke ist noch im Bau.')
      if (track.tracks > 1) return fail('Auf einer mehrgleisigen Strecke bringt eine Überholstelle nichts.')

      const at = nearestPointOnPath(track.geometry, command.position)
      if (!at) return fail('Kein Punkt auf der Strecke gefunden.')

      // Zu dicht an einem Ende waere die Ueberholstelle wirkungslos - der
      // Abschnitt dahinter bliebe genauso lang wie vorher.
      const margin = Math.max(1, track.lengthKm * 0.1)
      if (at.alongKm < margin || at.alongKm > track.lengthKm - margin) {
        return fail('Zu nah an einem Streckenende — die Überholstelle brächte nichts.')
      }

      const capacity = Math.max(1, Math.min(4, Math.round(command.capacity)))
      const cost = passingLoopCost(capacity)
      if (state.cash < cost) return fail('Nicht genug Kapital.')

      const [headGeometry, tailGeometry] = splitPath(track.geometry, at)
      const loopId = brandNode(`n-loop${state.network.nodes.size + 1}`)
      const loop: NetworkNode = {
        id: loopId,
        position: at.point,
        kind: 'passing_loop',
        sidingCapacity: capacity,
      }

      const ready = state.day + passingLoopDays(capacity)
      const head: TrackSegment = {
        ...track,
        id: `${track.id}a` as TrackSegment['id'],
        to: loopId,
        geometry: headGeometry,
        lengthKm: Number(polylineLengthKm(headGeometry).toFixed(3)),
        readyOnDay: Math.max(track.readyOnDay, ready),
      }
      const tail: TrackSegment = {
        ...track,
        id: `${track.id}b` as TrackSegment['id'],
        from: loopId,
        geometry: tailGeometry,
        lengthKm: Number(polylineLengthKm(tailGeometry).toFixed(3)),
        readyOnDay: Math.max(track.readyOnDay, ready),
      }

      let tracks = withMap(state.network.tracks, track.id, undefined)
      tracks = withMap(tracks, head.id, head)
      tracks = withMap(tracks, tail.id, tail)

      const next: GameState = {
        ...state,
        network: {
          ...state.network,
          nodes: withMap(state.network.nodes, loopId, loop),
          tracks,
        },
      }
      return {
        ok: true,
        cost,
        state: book(next, { category: 'construction', amount: -cost, note: 'Überholstelle' }),
      }
    }

    default:
      return fail(`'${command.kind}' ist kein Schienenbefehl.`)
  }
}

/** Täglicher Unterhalt des gesamten Schienennetzes. */
export function networkUpkeepPerDay(state: GameState): number {
  let sum = 0
  for (const track of state.network.tracks.values()) sum += trackUpkeepPerDay(track)
  return sum
}
