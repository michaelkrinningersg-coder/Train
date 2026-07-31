import {
  DAYS_ALL,
  DEFAULT_BUS_FARE,
  DEFAULT_CONNECTION_HOLD_SEC,
  DEFAULT_RAIL_FARE,
  DEFAULT_RUNTIME_RESERVE,
  DEFAULT_RUNTIME_RESERVE_RAIL,
  type City,
  type CityId,
  type GameState,
  type Scenario,
  type ScenarioSetup,
  type StationId,
} from '@game/domain'
import { applyCommand } from './commands.js'

/**
 * Startaufstellung eines Auftrags.
 *
 * Nicht jeder Handgriff ist eine Entscheidung. Acht Bahnhöfe zwischen Hamburg
 * und München zu setzen ist Arbeit, aber keine Wahl — wo die Trasse langgeht,
 * mit welcher Höchstgeschwindigkeit und ob ein- oder zweigleisig, das ist der
 * Auftrag. Im Ruhrgebiet ist es noch deutlicher: dort vier Städte in einem
 * Klumpen aus zweihundert Punkten zu treffen, ist Fummelarbeit.
 *
 * Deshalb kann ein Auftrag mitbringen, was ohnehin dastehen müsste. Gebaut wird
 * über dieselben Befehle wie im Spiel — ein Auftrag kann also nichts aufstellen,
 * was ein Spieler nicht auch bauen könnte.
 *
 * **Kostenlos**, und das mit Absicht: die Aufstellung wird angewandt und danach
 * der Kontostand auf das Startkapital gesetzt. Sonst hinge das Startvermögen am
 * Gelände unter den Bahnhöfen, und ein Auftrag wäre nach einer Änderung an den
 * Baukosten still unspielbar.
 *
 * Was fehlt, wird **übersprungen**. Eine Stadt, die im Datensatz nicht
 * vorkommt, darf einen Auftrag nicht am Start hindern — bei einem Regionswechsel
 * wäre das sonst der erste Fehler.
 */
export function applyScenarioSetup(state: GameState, scenario: Scenario | undefined): GameState {
  const setup = scenario?.setup
  if (!scenario || !setup) return state

  let current = state
  const run = (command: Parameters<typeof applyCommand>[1]): void => {
    const result = applyCommand(current, command)
    if (result.ok) current = result.state
  }

  const cityByName = (name: string): City | undefined => {
    for (const city of current.cities.values()) if (city.name === name) return city
    return undefined
  }

  for (const name of setup.busStops ?? []) {
    const city = cityByName(name)
    if (city) run({ kind: 'place_bus_stop', cityId: city.id })
  }

  for (const name of setup.railStations ?? []) {
    const city = cityByName(name)
    if (city) run({ kind: 'place_station', cityId: city.id, position: city.centre, platforms: 4 })
  }

  const nodeOf = (name: string): string | undefined => {
    for (const station of current.network.stations.values()) {
      if (station.name === name && station.mode !== 'bus') return station.nodeId
    }
    return undefined
  }
  for (const [from, to] of setup.railLinks ?? []) {
    const a = nodeOf(from)
    const b = nodeOf(to)
    if (!a || !b) continue
    run({
      kind: 'build_track',
      from: a as never,
      to: b as never,
      geometry: [],
      spec: { maxSpeed: 160, electrified: true, tracks: 2, signalling: 'classic' },
    })
  }

  for (const line of setup.lines ?? []) {
    const stationOf = (name: string): StationId | undefined => {
      const city = cityByName(name)
      if (!city) return undefined
      for (const station of current.network.stations.values()) {
        const matches = line.mode === 'rail' ? station.mode !== 'bus' : station.mode !== 'rail'
        if (station.cityId === city.id && matches) return station.id
      }
      return undefined
    }

    const stops = line.stops.map(stationOf).filter((id): id is StationId => id !== undefined)
    if (stops.length < 2) continue

    const before = new Set(current.fleet.keys())
    run({ kind: 'buy_vehicle', classId: line.vehicleClassId, units: line.vehicles })
    const fresh = [...current.fleet.values()].filter((v) => !before.has(v.id)).map((v) => v.id)
    if (fresh.length === 0) continue

    run({
      kind: 'create_line',
      line: {
        name: line.name,
        mode: line.mode,
        stops: stops.map((stationId) => ({ stationId, dwellSeconds: line.mode === 'rail' ? 60 : 120, serves: true })),
        path: line.mode === 'rail' ? { kind: 'rail', tracks: [] } : { kind: 'road' },
        fare: line.mode === 'rail' ? DEFAULT_RAIL_FARE : DEFAULT_BUS_FARE,
        runtimeReserve: line.mode === 'rail' ? DEFAULT_RUNTIME_RESERVE_RAIL : DEFAULT_RUNTIME_RESERVE,
        connectionHoldSec: DEFAULT_CONNECTION_HOLD_SEC,
      },
    })

    const created = [...current.lines.values()].at(-1)
    if (!created) continue
    run({
      kind: 'set_pattern',
      pattern: {
        lineId: created.id,
        direction: 'forward',
        vehicleIds: fresh,
        days: DAYS_ALL,
        headway: { everyMinutes: line.headwayMinutes, firstDeparture: 5 * 3600, lastDeparture: 21 * 3600 },
      },
    })
  }

  // Die Aufstellung war ein Geschenk, kein Kauf: Kasse und Journal zurück auf
  // den Anfang. Was in der Aufstellung noch im Bau ist, bleibt im Bau — auch
  // ein geschenkter Bahnhof steht nicht über Nacht.
  return { ...current, cash: scenario.startingCash, ledger: [] }
}

/** Städte einer Aufstellung, die es im Datensatz nicht gibt. */
export function missingSetupCities(cities: ReadonlyMap<CityId, City>, setup: ScenarioSetup | undefined): string[] {
  if (!setup) return []
  const known = new Set([...cities.values()].map((c) => c.name))
  const named = [
    ...(setup.busStops ?? []),
    ...(setup.railStations ?? []),
    ...(setup.railLinks ?? []).flat(),
    ...(setup.lines ?? []).flatMap((l) => l.stops),
  ]
  return [...new Set(named.filter((name) => !known.has(name)))]
}
