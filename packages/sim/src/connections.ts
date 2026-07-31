import type { GameState, LineId } from '@game/domain'
import { waitFromHeadway } from '@game/demand'
import { distanceKm } from '@game/geo'
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
 * Nicht modelliert: dass ein Anschluss auf einen verspäteten Zug wartet. Real
 * ist das eine Abwägung (Anschluss halten oder pünktlich weiterfahren); hier
 * fährt die Anschlusslinie immer nach Plan.
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

export type ConnectionQuality = 'good' | 'fair' | 'poor'

/**
 * Bewertung eines Anschlusses nach der gesamten Umsteigezeit.
 *
 * Bewusst keine Kategorie „zu knapp": das Modell lässt die Anschlusslinie immer
 * nach Plan fahren, also gibt es kein Verpassen. Einen Nullpuffer als riskant zu
 * markieren, würde eine Gefahr behaupten, die hier nicht existiert.
 */
export function connectionQuality(waitSec: number): ConnectionQuality {
  if (waitSec <= GOOD_CONNECTION_SEC) return 'good'
  if (waitSec <= POOR_CONNECTION_SEC) return 'fair'
  return 'poor'
}

export interface ConnectionInfo {
  readonly stopIndex: number
  readonly stationName: string
  readonly otherLineId: LineId
  readonly otherLineName: string
  /** Wer mit dieser Linie ankommt und auf die andere umsteigt. */
  readonly toOtherSec: number | null
  /** Und die Gegenrichtung der Reise: aus der anderen Linie in diese. */
  readonly fromOtherSec: number | null
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
function bestWait(
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
      const toOtherSec = bestWait(own, stopIndex, other, otherIndex, walk)
      const fromOtherSec = bestWait(other, otherIndex, own, stopIndex, walk)
      if (toOtherSec === null && fromOtherSec === null) continue

      result.push({
        stopIndex,
        stationName: state.network.stations.get(stop.stationId)?.name ?? '?',
        otherLineId: other.lineId,
        otherLineName: state.lines.get(other.lineId)?.name ?? '?',
        toOtherSec,
        fromOtherSec,
      })
    }
  })

  return result
}
