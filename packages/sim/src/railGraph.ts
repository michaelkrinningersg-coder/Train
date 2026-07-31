import { canTraverse, capacityFactor, gradientFactor } from '@game/domain'
import type { GameState, NodeId, TrackId, TrainClass } from '@game/domain'

/**
 * Wegsuche im Schienennetz.
 *
 * Der Graph ist klein - selbst ein dichtes Netz hat wenige hundert Kanten -,
 * deshalb genügt ein einfacher Dijkstra über die Fahrzeit. Bewertet wird mit der
 * Fahrzeit des konkreten Zuges: eine Neigetechnik nimmt eine andere Route als
 * ein Güterzug, wenn beide zur Wahl stehen.
 */

export interface RailPath {
  readonly tracks: readonly TrackId[]
  readonly nodes: readonly NodeId[]
  readonly lengthKm: number
  /** Grobe Fahrzeit ohne Beschleunigungsrechnung - nur für die Wegewahl. */
  readonly roughSeconds: number
}

interface Edge {
  readonly trackId: TrackId
  readonly to: NodeId
  readonly seconds: number
  readonly lengthKm: number
}

/**
 * Nachbarschaftsliste. Nur befahrbare Strecken: eine Strecke im Neubau oder
 * eine nicht elektrifizierte unter einem Elektrozug gehören nicht dazu.
 */
export function buildAdjacency(
  state: GameState,
  train: TrainClass | undefined,
  options: { readonly ignoreConstruction?: boolean } = {},
): Map<NodeId, Edge[]> {
  const adjacency = new Map<NodeId, Edge[]>()

  for (const track of state.network.tracks.values()) {
    if (!options.ignoreConstruction && capacityFactor(track, state.day) <= 0) continue
    if (train && !canTraverse(train.traction, track.electrified)) continue

    const speed = train ? Math.min(train.topSpeedKmh, track.maxSpeed) : track.maxSpeed
    const effective = speed * (train ? gradientFactor(track.gradientPermille, train.massFactor) : 1)
    const seconds = (track.lengthKm / Math.max(effective, 20)) * 3600

    const edge = (to: NodeId): Edge => ({ trackId: track.id, to, seconds, lengthKm: track.lengthKm })
    if (!adjacency.has(track.from)) adjacency.set(track.from, [])
    if (!adjacency.has(track.to)) adjacency.set(track.to, [])
    adjacency.get(track.from)!.push(edge(track.to))
    adjacency.get(track.to)!.push(edge(track.from))
  }

  return adjacency
}

/** Kürzester Weg nach Fahrzeit. `null`, wenn keine befahrbare Verbindung besteht. */
export function findPath(
  state: GameState,
  from: NodeId,
  to: NodeId,
  train: TrainClass | undefined,
  options: { readonly ignoreConstruction?: boolean } = {},
): RailPath | null {
  if (from === to) return { tracks: [], nodes: [from], lengthKm: 0, roughSeconds: 0 }

  const adjacency = buildAdjacency(state, train, options)
  const distance = new Map<NodeId, number>([[from, 0]])
  const previous = new Map<NodeId, { node: NodeId; trackId: TrackId; lengthKm: number }>()
  const visited = new Set<NodeId>()

  // Lineare Auswahl des Minimums statt Heap: bei dieser Knotenzahl ist der
  // Unterschied nicht messbar und der Code bleibt lesbar.
  while (visited.size < distance.size) {
    let current: NodeId | null = null
    let best = Infinity
    for (const [node, d] of distance) {
      if (!visited.has(node) && d < best) {
        best = d
        current = node
      }
    }
    if (current === null) break
    if (current === to) break
    visited.add(current)

    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue
      const candidate = best + edge.seconds
      if (candidate < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, candidate)
        previous.set(edge.to, { node: current, trackId: edge.trackId, lengthKm: edge.lengthKm })
      }
    }
  }

  if (!distance.has(to) || !previous.has(to)) return null

  const tracks: TrackId[] = []
  const nodes: NodeId[] = [to]
  let lengthKm = 0
  let cursor = to
  while (cursor !== from) {
    const step = previous.get(cursor)
    if (!step) return null
    tracks.unshift(step.trackId)
    nodes.unshift(step.node)
    lengthKm += step.lengthKm
    cursor = step.node
  }

  return { tracks, nodes, lengthKm, roughSeconds: distance.get(to) ?? 0 }
}

/**
 * Verbindet die Halte einer Linie zu einem durchgehenden Weg.
 * Liefert je Abschnitt zwischen zwei Halten den Teilweg.
 */
export function resolveLinePath(
  state: GameState,
  stopNodes: readonly NodeId[],
  train: TrainClass | undefined,
): { readonly legs: readonly RailPath[]; readonly complete: boolean; readonly blockedByConstruction: boolean } {
  const legs: RailPath[] = []
  for (let i = 1; i < stopNodes.length; i++) {
    const leg = findPath(state, stopNodes[i - 1]!, stopNodes[i]!, train)
    if (!leg || leg.tracks.length === 0) {
      // Gibt es den Weg, wenn man Baustellen ignoriert? Dann fehlt keine
      // Verbindung, sie ist nur noch nicht fertig - ein anderer Rat an den
      // Spieler als "bau eine Strecke".
      const later = findPath(state, stopNodes[i - 1]!, stopNodes[i]!, train, { ignoreConstruction: true })
      return { legs, complete: false, blockedByConstruction: Boolean(later && later.tracks.length > 0) }
    }
    legs.push(leg)
  }
  return { legs, complete: legs.length === stopNodes.length - 1, blockedByConstruction: false }
}
