import type { GameState, TrackId } from '@game/domain'
import { capacityPerHour } from './blocks.js'
import type { RailRun } from './railRuns.js'

/**
 * Gleisauslastung: wie viele Züge fahren über eine Strecke, gemessen an dem,
 * was sie tragen kann.
 *
 * Das ist eine **andere Frage** als die Auslastung der Züge. Ein Zug kann leer
 * sein und die Strecke trotzdem dicht — dann fehlt nicht Kapazität, sondern
 * Nachfrage, und ein weiterer Zug macht es schlimmer statt besser. Umgekehrt
 * kann eine Strecke bei 30 % liegen, während die Züge überquellen; dann ist
 * mehr Takt die Antwort und nicht ein zweites Gleis.
 *
 * Genau diese Unterscheidung entscheidet über die teuerste Investition im
 * Spiel. Deshalb steht sie neben der Zugauslastung und nicht statt ihr.
 *
 * Gemessen wird die **stärkste Stunde je Richtung**, nicht der Tagesschnitt:
 * ein zweites Gleis wird gebaut, weil die Hauptverkehrszeit nicht mehr passt,
 * nicht weil der Nachmittag im Schnitt eng ist.
 *
 * ## Was in die Kapazität eingeht
 *
 * `capacityPerHour` verlangt eine Geschwindigkeit und eine Zuglänge. Auf einer
 * Strecke, über die mehrere Linien fahren, gibt es die nicht — deshalb zählt
 * der **langsamste und längste** Zug. Das ist keine Bequemlichkeit: ein
 * langsamer Güterzug zwischen zwei schnellen kostet mehr Trasse als er selbst
 * braucht, weil er die Lücke dahinter mitverbraucht. Mischverkehr *senkt* die
 * Kapazität, und die pessimistische Annahme trifft das besser als ein Mittel.
 */

export interface TrackLoad {
  readonly trackId: TrackId
  /** Zugfahrten in der stärksten Stunde, je Richtung. */
  readonly peakTrainsPerHour: number
  /** Was die Strecke in dieser Stunde tragen könnte, je Richtung. */
  readonly capacityPerHour: number
  /** Verhältnis der beiden — ab 1 ist die Trasse ausgereizt. */
  readonly load: number
}

/** Ab hier ist die Trasse so voll, dass jede Störung sich fortpflanzt. */
export const TRACK_LOAD_TIGHT = 0.75

/**
 * Zugläufe eines Tages auf die Strecken umrechnen.
 *
 * `runs` sind alle Läufe *aller* Linien — eine Strecke gehört keiner Linie,
 * und genau darum geht es: zwei Linien auf demselben Korridor teilen sich die
 * Trasse, auch wenn keine von beiden für sich zu dicht fährt.
 */
export function trackLoads(
  state: GameState,
  runs: readonly RailRun[],
  /** Geschwindigkeit und Länge des Zugs je Linie. */
  trainOf: (run: RailRun) => { readonly topSpeedKmh: number; readonly lengthM: number } | undefined,
): Map<TrackId, TrackLoad> {
  // Je Strecke: die schlechtesten Zugeigenschaften und die Einfahrten je
  // Stunde und Richtung.
  const slowest = new Map<TrackId, { speed: number; length: number }>()
  const entries = new Map<TrackId, Map<string, number>>()
  const seen = new Set<string>()

  for (const run of runs) {
    const train = trainOf(run)
    for (const claim of run.claims) {
      const trackId = claim.trackId
      if (trackId === undefined || claim.kind === 'platform' || claim.kind === 'vehicle') continue

      if (train) {
        const worst = slowest.get(trackId)
        if (!worst) slowest.set(trackId, { speed: train.topSpeedKmh, length: train.lengthM })
        else {
          worst.speed = Math.min(worst.speed, train.topSpeedKmh)
          worst.length = Math.max(worst.length, train.lengthM)
        }
      }

      // Eine Fahrt zaehlt einmal je Strecke, nicht einmal je Block.
      const key = `${run.id} ${trackId} ${claim.direction ?? 1}`
      if (seen.has(key)) continue
      seen.add(key)

      const hour = Math.floor(claim.from / 3600)
      const bucket = `${hour} ${claim.direction ?? 1}`
      const perTrack = entries.get(trackId)
      if (perTrack) perTrack.set(bucket, (perTrack.get(bucket) ?? 0) + 1)
      else entries.set(trackId, new Map([[bucket, 1]]))
    }
  }

  const loads = new Map<TrackId, TrackLoad>()
  for (const [trackId, buckets] of entries) {
    const track = state.network.tracks.get(trackId)
    if (!track) continue

    const worst = slowest.get(trackId)
    const capacity = capacityPerHour(track, worst?.speed ?? track.maxSpeed, worst?.length ?? 100)
    const peak = Math.max(...buckets.values())

    loads.set(trackId, {
      trackId,
      peakTrainsPerHour: peak,
      capacityPerHour: capacity,
      load: capacity > 0 ? peak / capacity : 0,
    })
  }

  return loads
}
