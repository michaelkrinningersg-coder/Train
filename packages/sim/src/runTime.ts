import { gradientFactor } from '@game/domain'
import type { GameState, TrackId, TrainClass } from '@game/domain'

/**
 * Fahrzeitrechnung über ein Geschwindigkeitsprofil.
 * Siehe docs/04-BETRIEBSSIMULATION.md Abschnitt 1.
 *
 * Statt einer Pauschale je Abschnitt wird ein echtes Profil gerechnet: erst die
 * zulässige Geschwindigkeit an jeder Stelle, dann ein Vorwärtslauf für die
 * Beschleunigung und ein Rückwärtslauf für die Bremsung. Das Ergebnis ist eine
 * Weg-Zeit-Funktion — und genau die braucht die Blockbelegung, denn sie muss
 * wissen, *wann* der Zug an Kilometer 34 ist, nicht nur wie lange er insgesamt
 * fährt.
 */

/** Abtastweite des Profils. 250 m ist fein genug für Blockgrenzen. */
export const PROFILE_STEP_KM = 0.25

export interface ProfileSample {
  /** Weg vom Beginn des Abschnitts in km. */
  readonly km: number
  /** Zeit seit Abfahrt in Sekunden. */
  readonly seconds: number
  /** Geschwindigkeit an dieser Stelle in km/h. */
  readonly speedKmh: number
}

export interface LegRun {
  readonly tracks: readonly TrackId[]
  readonly lengthKm: number
  /** Reine Fahrzeit ohne Reserve und ohne Aufenthalt. */
  readonly runSeconds: number
  readonly samples: readonly ProfileSample[]
}

interface Limit {
  readonly km: number
  readonly limitKmh: number
}

/** Zulässige Geschwindigkeit entlang des Abschnitts, Zug und Strecke kombiniert. */
function speedLimits(state: GameState, tracks: readonly TrackId[], train: TrainClass): Limit[] {
  const limits: Limit[] = []
  let km = 0

  for (const trackId of tracks) {
    const track = state.network.tracks.get(trackId)
    if (!track) continue
    const limit =
      Math.min(train.topSpeedKmh, track.maxSpeed) * gradientFactor(track.gradientPermille, train.massFactor)

    for (let s = 0; s < track.lengthKm; s += PROFILE_STEP_KM) {
      limits.push({ km: km + s, limitKmh: limit })
    }
    km += track.lengthKm
  }

  limits.push({ km, limitKmh: 0 })
  return limits
}

/**
 * Fahrzeit und Weg-Zeit-Profil eines Abschnitts zwischen zwei Halten.
 * Der Zug startet und endet im Stillstand.
 */
export function legRunTime(state: GameState, tracks: readonly TrackId[], train: TrainClass): LegRun {
  const limits = speedLimits(state, tracks, train)
  if (limits.length < 2) {
    return { tracks, lengthKm: 0, runSeconds: 0, samples: [] }
  }

  const n = limits.length
  const lengthKm = limits[n - 1]!.km
  const speeds = new Float64Array(n)

  // Vorwaertslauf: was die Beschleunigung hergibt, beginnend im Stillstand.
  speeds[0] = 0
  for (let i = 1; i < n; i++) {
    const ds = (limits[i]!.km - limits[i - 1]!.km) * 1000
    const reachable = Math.sqrt((speeds[i - 1]! / 3.6) ** 2 + 2 * train.accelMs2 * ds) * 3.6
    speeds[i] = Math.min(limits[i]!.limitKmh, reachable)
  }

  // Rueckwaertslauf: was die Bremsung erlaubt, endend im Stillstand.
  speeds[n - 1] = 0
  for (let i = n - 2; i >= 0; i--) {
    const ds = (limits[i + 1]!.km - limits[i]!.km) * 1000
    const allowed = Math.sqrt((speeds[i + 1]! / 3.6) ** 2 + 2 * train.brakeMs2 * ds) * 3.6
    speeds[i] = Math.min(speeds[i]!, allowed)
  }

  const samples: ProfileSample[] = []
  let seconds = 0
  samples.push({ km: 0, seconds: 0, speedKmh: 0 })

  for (let i = 1; i < n; i++) {
    const ds = limits[i]!.km - limits[i - 1]!.km
    const average = (speeds[i - 1]! + speeds[i]!) / 2
    // Bei Stillstand an beiden Enden eines Schrittes waere die Zeit unendlich;
    // in der Praxis tritt das nur bei Nulllaengen auf.
    seconds += average > 0.1 ? (ds / average) * 3600 : 0
    samples.push({ km: limits[i]!.km, seconds, speedKmh: speeds[i]! })
  }

  return { tracks, lengthKm, runSeconds: seconds, samples }
}

/** Zeit, zu der der Zug einen bestimmten Kilometer erreicht (lineare Interpolation). */
export function timeAtKm(run: LegRun, km: number): number {
  const samples = run.samples
  if (samples.length === 0) return 0
  if (km <= 0) return 0
  if (km >= run.lengthKm) return run.runSeconds

  // Binaere Suche - das Profil kann einige tausend Stuetzstellen haben.
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid]!.km <= km) lo = mid
    else hi = mid
  }

  const a = samples[lo]!
  const b = samples[hi]!
  const span = b.km - a.km
  if (span <= 0) return a.seconds
  return a.seconds + ((km - a.km) / span) * (b.seconds - a.seconds)
}

/** Reisegeschwindigkeit eines Abschnitts in km/h. */
export function averageSpeed(run: LegRun): number {
  return run.runSeconds > 0 ? (run.lengthKm / run.runSeconds) * 3600 : 0
}
