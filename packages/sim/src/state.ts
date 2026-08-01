import { cityId as brandCity, DEFAULT_SCENARIO_ID } from '@game/domain'
import type { City, GameState, LineId, Money, PatternId, StationId, VehicleId } from '@game/domain'

/**
 * Startkapital eines kleinen Regionalbetriebs: zwei Millionen Euro. Das reicht
 * fuer eine Handvoll Haltestellen und vier bis fuenf Ueberlandbusse - also
 * genau fuer eine erste Linie, nicht fuer ein Netz. Alles Weitere muss
 * erwirtschaftet oder finanziert werden.
 */
export const STARTING_CASH: Money = 2_000_000_00

export interface NewGameOptions {
  readonly cities: readonly City[]
  readonly seed?: number
  readonly startingCash?: Money
  readonly scenarioId?: string
}

export function createGame(options: NewGameOptions): GameState {
  const cities = new Map(options.cities.map((c) => [c.id, c]))
  return {
    seed: options.seed ?? 1,
    scenarioId: options.scenarioId ?? DEFAULT_SCENARIO_ID,
    scenarioStartedOnDay: 0,
    day: 0,
    cash: options.startingCash ?? STARTING_CASH,
    loans: [],
    cities,
    network: { nodes: new Map(), tracks: new Map(), stations: new Map() },
    fleet: new Map(),
    lines: new Map(),
    patterns: new Map(),
    runs: new Map(),
    satisfaction: new Map(),
    crowding: new Map(),
    ledger: [],
    lastDay: null,
    history: [],
    facilityChanges: [],
  }
}

/**
 * IDs werden aus Zaehlern in den Sammlungen selbst abgeleitet und nicht aus
 * einem Zufallsgenerator - damit bleibt der Zustand deterministisch und ein
 * Spielstand laesst sich exakt wiederherstellen.
 */
export function nextId(prefix: string, existing: ReadonlyMap<string, unknown>): string {
  let n = existing.size + 1
  while (existing.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export const newStationId = (s: GameState): StationId => nextId('st', s.network.stations) as StationId
export const newVehicleId = (s: GameState): VehicleId => nextId('v', s.fleet) as VehicleId
export const newLineId = (s: GameState): LineId => nextId('l', s.lines) as LineId
export const newPatternId = (s: GameState): PatternId => nextId('p', s.patterns) as PatternId

export const cityId = brandCity

/** Flache Kopie mit ersetzter Sammlung - haelt die Befehlsimplementierungen kurz. */
export function withMap<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): Map<K, V> {
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}
