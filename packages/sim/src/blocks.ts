import { BLOCK_LENGTH_KM, SIGNAL_REACTION_SEC } from '@game/domain'
import type { GameState, RunId, Sec, TrackSegment } from '@game/domain'

/**
 * Belegung von Betriebsmitteln und Konflikterkennung.
 * Siehe docs/04-BETRIEBSSIMULATION.md Abschnitt 2 und 3.
 *
 * Es gibt vier Arten von Betriebsmitteln, und sie folgen unterschiedlichen
 * Regeln — das ist der Kern der ganzen Betriebssimulation:
 *
 * - **Block**: ein Streckenabschnitt zwischen zwei Signalen. Nur ein Zug. Regelt
 *   die Zugfolge in *derselben* Richtung.
 * - **Abschnitt**: bei eingleisigen Strecken die ganze Strecke zwischen zwei
 *   Betriebsstellen. Sie ist nur für die *Gegenrichtung* gesperrt — zwei Züge
 *   derselben Richtung dürfen im Blockabstand folgen. Genau deshalb entscheidet
 *   die Lage der Überholstellen darüber, wie dicht eine eingleisige Strecke
 *   befahren werden kann.
 * - **Bahnsteig**: so viele gleichzeitige Züge wie Bahnsteiggleise.
 * - **Fahrzeug**: ein Zug kann nur einen Umlauf gleichzeitig fahren.
 */

export type ResourceKind = 'block' | 'section' | 'platform' | 'vehicle'

export interface Claim {
  readonly resource: string
  readonly kind: ResourceKind
  readonly capacity: number
  readonly from: Sec
  readonly to: Sec
  readonly runId: RunId
  /** Nur bei Abschnitten: +1 in Streckenrichtung, -1 dagegen. */
  readonly direction?: 1 | -1
  /** Klartext für die Konfliktmeldung. */
  readonly label: string
}

export const CONFLICT_KINDS = [
  'block',
  'opposing_single',
  'platform',
  'vehicle',
] as const
export type ConflictKind = (typeof CONFLICT_KINDS)[number]

export interface Conflict {
  readonly kind: ConflictKind
  readonly resource: string
  readonly label: string
  readonly at: Sec
  readonly runs: readonly RunId[]
  /** Dauer der Ueberschneidung. Entscheidet, ob es ein Problem oder Toleranz ist. */
  readonly overlapSec: number
}

/**
 * Unterhalb dieser Ueberschneidung ist ein Konflikt betrieblich belanglos:
 * zwei Zuege, die sich an einer Ueberholstelle kreuzen, brauchen zwangslaeufig
 * ein paar Sekunden Toleranz. Erst darueber wird daraus Wartezeit, die im
 * Fahrplan weh tut.
 */
export const MINOR_CONFLICT_SEC = 90

export const isMinor = (conflict: Conflict): boolean => conflict.overlapSec < MINOR_CONFLICT_SEC

/** Blocklänge und Mindestzugfolgezeit einer Strecke. */
export function blockLengthKm(track: TrackSegment): number {
  return BLOCK_LENGTH_KM[track.signalling]
}

export function blockCount(track: TrackSegment): number {
  return Math.max(1, Math.ceil(track.lengthKm / blockLengthKm(track)))
}

/**
 * Mindestzugfolgezeit in Sekunden: Blockfahrzeit plus Räumzeit plus
 * Reaktionszuschlag. Kürzere Blöcke heben die Kapazität ohne einen Meter
 * neues Gleis — das ist der Sinn eines Signaltechnik-Ausbaus.
 */
export function headwaySeconds(track: TrackSegment, speedKmh: number, trainLengthM: number): number {
  const v = Math.max(20, Math.min(speedKmh, track.maxSpeed))
  const blockTime = (blockLengthKm(track) / v) * 3600
  const clearing = (trainLengthM / 1000 / v) * 3600
  return blockTime + clearing + SIGNAL_REACTION_SEC[track.signalling]
}

/** Theoretische Kapazität einer Strecke in Zügen je Stunde und Richtung. */
export function capacityPerHour(track: TrackSegment, speedKmh: number, trainLengthM: number): number {
  const headway = headwaySeconds(track, speedKmh, trainLengthM)
  const directions = track.tracks >= 2 ? track.tracks / 2 : 1
  return (3600 / headway) * directions
}

/**
 * Blöcke sind immer richtungsbezogen - auch auf eingleisigen Strecken. Dort
 * regeln sie nur die Zugfolge *derselben* Richtung; dass sich Gegenzüge nicht
 * begegnen dürfen, ist Sache des Abschnitts. Ohne diese Trennung meldete
 * dieselbe Kreuzung zweimal, einmal als Blockkonflikt und einmal als Gegenzug.
 */
export const blockResource = (trackId: string, direction: 1 | -1, index: number): string =>
  `block:${trackId}:${direction}:${index}`

export const sectionResource = (trackId: string): string => `section:${trackId}`

/**
 * Findet Überschneidungen. Blöcke, Bahnsteige und Fahrzeuge über die Kapazität,
 * Abschnitte über die Richtung.
 */
export function findConflicts(claims: readonly Claim[]): Conflict[] {
  const byResource = new Map<string, Claim[]>()
  for (const claim of claims) {
    const list = byResource.get(claim.resource)
    if (list) list.push(claim)
    else byResource.set(claim.resource, [claim])
  }

  const conflicts: Conflict[] = []

  for (const [resource, list] of byResource) {
    list.sort((a, b) => a.from - b.from)
    const first = list[0]!

    if (first.kind === 'section') {
      // Eingleisig: nur Gegenzüge stören sich.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!
          const b = list[j]!
          if (b.from >= a.to) break
          if (a.direction === b.direction) continue
          conflicts.push({
            kind: 'opposing_single',
            resource,
            label: a.label,
            at: Math.max(a.from, b.from),
            runs: [a.runId, b.runId],
            overlapSec: Math.min(a.to, b.to) - Math.max(a.from, b.from),
          })
        }
      }
      continue
    }

    // Kapazitätsprüfung per Sweep: wie viele Belegungen überlappen sich?
    const active: Claim[] = []
    for (const claim of list) {
      while (active.length > 0 && active[0]!.to <= claim.from) active.shift()
      // `active` bleibt nach `to` sortiert, damit das Abräumen oben stimmt.
      const insertAt = active.findIndex((a) => a.to > claim.to)
      active.splice(insertAt === -1 ? active.length : insertAt, 0, claim)

      if (active.length > claim.capacity) {
        const earliestEnd = Math.min(...active.map((a) => a.to))
        conflicts.push({
          kind: claim.kind === 'platform' ? 'platform' : claim.kind === 'vehicle' ? 'vehicle' : 'block',
          resource,
          label: claim.label,
          at: claim.from,
          runs: active.map((a) => a.runId),
          overlapSec: Math.max(0, earliestEnd - claim.from),
        })
      }
    }
  }

  // Gleiche Stelle, gleiche Zeit, gleiche Züge nur einmal melden.
  const seen = new Set<string>()
  return conflicts.filter((c) => {
    const key = `${c.resource}|${Math.round(c.at / 60)}|${[...c.runs].sort().join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Wann ist ein Betriebsmittel frühestens frei, wenn es ab `from` gebraucht wird? */
export function freeFrom(
  occupied: readonly Claim[],
  from: Sec,
  to: Sec,
  capacity: number,
  direction: 1 | -1 | undefined,
  isSection: boolean,
): Sec {
  let earliest = from
  let changed = true
  let guard = 0

  // Das Verschieben kann eine neue Überschneidung auslösen, deshalb bis zur
  // Ruhe iterieren. Der Zähler ist eine Notbremse gegen Endlosschleifen.
  while (changed && guard++ < 64) {
    changed = false
    const span = to - from
    for (const claim of occupied) {
      if (isSection && claim.direction === direction) continue
      if (claim.to <= earliest) continue
      if (claim.from >= earliest + span) continue

      if (!isSection && capacity > 1) {
        const overlapping = occupied.filter((c) => c.from < earliest + span && c.to > earliest)
        if (overlapping.length < capacity) continue
      }

      earliest = claim.to
      changed = true
    }
  }

  return earliest
}

/** Blockgrenzen einer Strecke als Kilometerwerte, inklusive Endpunkt. */
export function blockBoundaries(track: TrackSegment): number[] {
  const count = blockCount(track)
  const step = track.lengthKm / count
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

/** Alle Strecken zusammen: wie viele Blöcke hat das Netz? */
export function totalBlocks(state: GameState): number {
  let sum = 0
  for (const track of state.network.tracks.values()) sum += blockCount(track) * Math.max(1, track.tracks / 1)
  return sum
}
