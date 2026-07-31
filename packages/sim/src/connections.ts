import type { GameState, LineId } from '@game/domain'
import { waitFromHeadway } from '@game/demand'
import { distanceKm } from '@game/geo'
import { expectedHoldSec, holdProbability, missProbability } from './holding.js'
import { arrivalAt, departureAt, type Direction, type LineOffer } from './offers.js'

/**
 * Anschlüsse: wie lange ein Umstieg wirklich dauert.
 *
 * Bis hierher kostete jeder Umstieg den halben Takt der Anschlusslinie — eine
 * Stundentaktlinie also im Mittel dreißig Minuten, ganz gleich wie die beiden
 * Fahrpläne zueinander liegen. Damit war ein abgestimmter Anschluss im Modell
 * genauso gut wie ein zufälliger, und der Spieler hatte keinen Grund, über die
 * Lage seiner Abfahrten nachzudenken.
 *
 * Jetzt entsteht die Umsteigezeit aus der **Phasenlage**: der Fahrgast kommt zu
 * einer bestimmten Minute an, braucht seine Mindestumsteigezeit, und wartet dann
 * bis zur nächsten Abfahrt der Anschlusslinie. Liegen die Fahrpläne günstig
 * zueinander, sind das fünf Minuten; liegen sie ungünstig, fünfundfünfzig.
 *
 * Der Mittelwert über alle möglichen Phasenlagen ist derselbe wie vorher (halber
 * Takt) — das Balancing verschiebt sich also nicht. Was sich ändert, ist, dass
 * der Spieler entscheiden kann, wo auf dieser Verteilung er landet. Genau das
 * macht aus einer Rechengröße eine Spielmechanik.
 *
 * Ob ein Anschluss auf einen verspäteten Zubringer wartet, entscheidet der
 * Spieler je Linie — siehe `holding.ts`. Von dort kommt auch das Risiko, einen
 * Anschluss ganz zu verpassen.
 */

/** Mindestzeit für einen Umstieg, auch am selben Bahnsteig. */
export const MIN_INTERCHANGE_SEC = 120
/** Fußweg zwischen zwei Halten derselben Stadt. */
export const INTERCHANGE_WALK_KMH = 4.5

/**
 * Zeit vom Aussteigen bis zum Bereitstehen am anderen Bahnsteig.
 *
 * Sind es zwei verschiedene Halte derselben Stadt — der Bus hält am
 * Busbahnhof, der Zug am Bahnhof —, kommt der Fußweg dazu. Das ist der Preis
 * dafür, dass umgestiegen wird, wo die Stadt ist, und nicht nur, wo zufällig
 * dieselbe Haltestelle steht.
 */
export function interchangeSeconds(state: GameState, fromStation: string, toStation: string): number {
  if (fromStation === toStation) return MIN_INTERCHANGE_SEC
  const a = state.network.stations.get(fromStation as never)
  const b = state.network.stations.get(toStation as never)
  if (!a || !b) return MIN_INTERCHANGE_SEC
  const km = distanceKm(a.position, b.position)
  return MIN_INTERCHANGE_SEC + (km / INTERCHANGE_WALK_KMH) * 3600
}

/** Bis hierher ist ein Anschluss gut — man steigt um und fährt weiter. */
export const GOOD_CONNECTION_SEC = 10 * 60
/** Darüber lohnt es sich, die Abfahrtszeiten zu verschieben. */
export const POOR_CONNECTION_SEC = 20 * 60

/** Wie viele aufeinanderfolgende Ankünfte gemittelt werden. */
const MAX_SAMPLES = 60

export interface ConnectionPoint {
  readonly offer: LineOffer
  readonly stopIndex: number
  readonly direction: Direction
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * Zeit vom Aussteigen bis zur Abfahrt der Anschlusslinie, gemittelt über die
 * Fahrten des Tages.
 *
 * Bei gleichem Takt ist die Wartezeit für jede Fahrt dieselbe — das ist der
 * Normalfall eines Taktfahrplans und der Grund, warum sich ein Anschluss
 * überhaupt planen lässt. Bei ungleichen Takten verschiebt sich die Lage von
 * Fahrt zu Fahrt; dann wird über eine volle Periode gemittelt.
 */
export function connectionWaitSec(
  from: ConnectionPoint,
  to: ConnectionPoint,
  interchangeSec: number,
): number {
  const headwayA = Math.round(from.offer.headwayMin) * 60
  const headwayB = Math.round(to.offer.headwayMin) * 60

  // Ohne fahrbaren Takt bleibt nur die alte Näherung.
  if (!Number.isFinite(headwayA) || !Number.isFinite(headwayB) || headwayA <= 0 || headwayB <= 0) {
    return interchangeSec + waitFromHeadway(to.offer.headwayMin)
  }

  const arrival = arrivalAt(from.offer, from.stopIndex, from.direction)
  const departure = departureAt(to.offer, to.stopIndex, to.direction)

  const period = (headwayA / gcd(headwayA, headwayB)) * headwayB
  const samples = Math.max(1, Math.min(MAX_SAMPLES, Math.round(period / headwayA)))

  let total = 0
  for (let k = 0; k < samples; k++) {
    const ready = arrival + k * headwayA + interchangeSec
    const wait = (((departure - ready) % headwayB) + headwayB) % headwayB
    total += interchangeSec + wait
  }
  return total / samples
}

export type ConnectionQuality = 'good' | 'fair' | 'poor' | 'risky'

/**
 * Ab diesem Anteil verpasster Anschlüsse ist ein kurzer Umstieg keine gute
 * Verbindung mehr, sondern eine knappe.
 */
export const RISKY_MISS_SHARE = 0.15

/**
 * Bewertung eines Anschlusses nach Umsteigezeit **und** Risiko.
 *
 * Ein Nullpuffer hinter einem verspäteten Zubringer ist keine gute Verbindung,
 * auch wenn er auf dem Papier zwei Minuten dauert — man erreicht ihn nur nicht.
 * Deshalb sticht das Risiko die Zeit.
 */
export function connectionQuality(waitSec: number, missShare = 0): ConnectionQuality {
  if (missShare >= RISKY_MISS_SHARE) return 'risky'
  if (waitSec <= GOOD_CONNECTION_SEC) return 'good'
  if (waitSec <= POOR_CONNECTION_SEC) return 'fair'
  return 'poor'
}

/** Ein Umstieg in eine Richtung, mit Zeit und Risiko. */
export interface ConnectionLeg {
  readonly waitSec: number
  /** Geplante Wartezeit am Bahnsteig — der Puffer für den Zubringer. */
  readonly slackSec: number
  /** Anteil der Umsteiger, die den Anschluss verpassen, 0..1. */
  readonly missShare: number
  /** Erwartete Haltezeit, wenn die Anschlusslinie wartet. */
  readonly holdSec: number
}

export interface ConnectionInfo {
  readonly stopIndex: number
  readonly stationName: string
  readonly otherLineId: LineId
  readonly otherLineName: string
  /** Wer mit dieser Linie ankommt und auf die andere umsteigt. */
  readonly toOther: ConnectionLeg | null
  /** Und die Gegenrichtung der Reise: aus der anderen Linie in diese. */
  readonly fromOther: ConnectionLeg | null
}

/** In welche Richtungen kann man an diesem Halt einsteigen und weiterfahren? */
function boardable(offer: LineOffer, index: number): Direction[] {
  const directions: Direction[] = []
  if (index < offer.stops.length - 1) directions.push('forward')
  if (index > 0) directions.push('backward')
  return directions
}

/** Und aus welchen Richtungen kann man dort ankommen? */
function arrivable(offer: LineOffer, index: number): Direction[] {
  const directions: Direction[] = []
  if (index > 0) directions.push('forward')
  if (index < offer.stops.length - 1) directions.push('backward')
  return directions
}

/** Bester Umstieg von einer Linie in die andere, über alle sinnvollen Richtungen. */
export function bestWaitSec(
  from: LineOffer,
  fromIndex: number,
  to: LineOffer,
  toIndex: number,
  walkSec: number,
): number | null {
  const arriving = arrivable(from, fromIndex)
  const leaving = boardable(to, toIndex)
  if (arriving.length === 0 || leaving.length === 0) return null

  const waits = arriving.flatMap((a) =>
    leaving.map((b) =>
      connectionWaitSec({ offer: from, stopIndex: fromIndex, direction: a }, { offer: to, stopIndex: toIndex, direction: b }, walkSec),
    ),
  )
  return Math.min(...waits)
}

/** Derselbe Umstieg, um Puffer und Risiko ergänzt. */
function bestLeg(
  from: LineOffer,
  fromIndex: number,
  to: LineOffer,
  toIndex: number,
  walkSec: number,
): ConnectionLeg | null {
  const waitSec = bestWaitSec(from, fromIndex, to, toIndex, walkSec)
  if (waitSec === null) return null
  const slackSec = Math.max(0, waitSec - walkSec)
  return {
    waitSec,
    slackSec,
    missShare: missProbability(from.averageDelaySec, slackSec, to.holdSec),
    holdSec: expectedHoldSec(from.averageDelaySec, slackSec, to.holdSec),
  }
}

/**
 * Alle Anschlüsse einer Linie, für die Anzeige im Linienpanel.
 *
 * Je Halt und je dort ebenfalls haltender Linie stehen **beide Umsteigerichtungen**
 * — wer hier ankommt und weiterfährt, und wer aus der anderen Linie kommt und
 * hier einsteigt. Beide zu zeigen ist nicht Vollständigkeitswahn: bei gleichem
 * Takt beider Linien lassen sie sich meist nicht zugleich gut treffen, und wer
 * nur eine Richtung sieht, optimiert an der anderen vorbei.
 *
 * Richtungen, in denen es gar nicht weitergeht, bleiben außen vor. Ein Zug, der
 * an seinem Endbahnhof „in Hinrichtung abfährt", existiert nur im Datenmodell —
 * ihn als Anschluss zu melden ergäbe eine Zahl, die mit den Fahrgastzahlen
 * nichts zu tun hat.
 */
export function lineConnections(
  state: GameState,
  offers: readonly LineOffer[],
  lineId: LineId,
): ConnectionInfo[] {
  const own = offers.find((o) => o.lineId === lineId)
  if (!own) return []

  const result: ConnectionInfo[] = []

  own.stops.forEach((stop, stopIndex) => {
    for (const other of offers) {
      if (other.lineId === lineId) continue
      const otherIndex = other.stops.findIndex((s) => s.cityId === stop.cityId)
      if (otherIndex < 0) continue

      const walk = interchangeSeconds(state, stop.stationId, other.stops[otherIndex]!.stationId)
      const toOther = bestLeg(own, stopIndex, other, otherIndex, walk)
      const fromOther = bestLeg(other, otherIndex, own, stopIndex, walk)
      if (toOther === null && fromOther === null) continue

      result.push({
        stopIndex,
        stationName: state.network.stations.get(stop.stationId)?.name ?? '?',
        otherLineId: other.lineId,
        otherLineName: state.lines.get(other.lineId)?.name ?? '?',
        toOther,
        fromOther,
      })
    }
  })

  return result
}

/** Ein gehaltener Anschluss, wie ihn das Linienpanel zeigt. */
export interface HoldEvent {
  readonly stopIndex: number
  readonly fromLineId: LineId
  /** Erwartete Haltezeit an diesem Halt. */
  readonly seconds: number
  /** Wie oft überhaupt gewartet wird. */
  readonly chance: number
}

export interface LineHold {
  /** Summe der erwarteten Haltezeiten über alle Halte der Linie. */
  readonly seconds: number
  /** Wahrscheinlichkeit, dass die Fahrt ohne jeden Halt durchkommt. */
  readonly onTimeChance: number
  readonly events: readonly HoldEvent[]
}

const NO_HOLD: LineHold = { seconds: 0, onTimeChance: 1, events: [] }

/**
 * Rechnet für jede Linie aus, wie viel Verspätung sie sich durch Warten einhandelt.
 *
 * Eingabe sind die Angebote **vor** der Anschlusssicherung — die Verspätung, die
 * aus Betrieb und Störungen stammt. Ausgabe sind dieselben Angebote mit
 * angehobener Verspätung und abgesenkter Pünktlichkeit. Die Rechnung dahinter
 * steht in `holding.ts`.
 */
export function applyConnectionHolding(
  state: GameState,
  offers: readonly LineOffer[],
): { readonly offers: LineOffer[]; readonly holds: ReadonlyMap<LineId, LineHold> } {
  const holds = new Map<LineId, LineHold>()

  for (const own of offers) {
    if (own.holdSec <= 0) {
      holds.set(own.lineId, NO_HOLD)
      continue
    }

    const events: HoldEvent[] = []
    let seconds = 0
    let onTimeChance = 1

    own.stops.forEach((stop, stopIndex) => {
      // Je Halt zaehlt der schlimmste Zubringer. Zwei zugleich verspaetete Linien
      // sind kein doppelter Halt - der Zug wartet einmal, bis der letzte da ist.
      let worst: HoldEvent | null = null

      for (const feeder of offers) {
        if (feeder.lineId === own.lineId || feeder.averageDelaySec <= 0) continue
        const feederIndex = feeder.stops.findIndex((s) => s.cityId === stop.cityId)
        if (feederIndex < 0) continue

        const walk = interchangeSeconds(state, feeder.stops[feederIndex]!.stationId, stop.stationId)
        const wait = bestWaitSec(feeder, feederIndex, own, stopIndex, walk)
        if (wait === null) continue

        // Der Puffer ist die reine Wartezeit am Bahnsteig, ohne den Fussweg -
        // der ist schon verbraucht, wenn der Fahrgast dort ankommt.
        const slack = Math.max(0, wait - walk)
        const seconds = expectedHoldSec(feeder.averageDelaySec, slack, own.holdSec)
        if (seconds > 0 && (worst === null || seconds > worst.seconds)) {
          worst = {
            stopIndex,
            fromLineId: feeder.lineId,
            seconds,
            chance: holdProbability(feeder.averageDelaySec, slack),
          }
        }
      }

      if (worst !== null) {
        events.push(worst)
        seconds += worst.seconds
        onTimeChance *= 1 - worst.chance
      }
    })

    holds.set(own.lineId, { seconds, onTimeChance, events })
  }

  const adjusted = offers.map((offer) => {
    const hold = holds.get(offer.lineId)
    if (!hold || hold.seconds <= 0) return offer
    return {
      ...offer,
      averageDelaySec: offer.averageDelaySec + hold.seconds,
      punctuality: offer.punctuality * hold.onTimeChance,
      heldSec: hold.seconds,
    }
  })

  return { offers: adjusted, holds }
}
