import type { CityId, GameState, LineId } from '@game/domain'
import {
  TRANSFER_TIME_WEIGHT,
  WAIT_TIME_WEIGHT,
  generalisedCost,
  odKey,
  waitFromHeadway,
  type Alternative,
} from '@game/demand'
import { connectionWaitSec, interchangeSeconds } from './connections.js'
import { missProbability } from './holding.js'
import { legFare, rideSeconds, type Direction, type LineOffer } from './offers.js'

/**
 * Reiseketten über das eigene Netz.
 *
 * Bis Phase 3 wurde jede Relation nur direkt bedient: wer von A nach C wollte,
 * fand entweder eine Linie, die beide Städte anfährt, oder gar nichts. Damit war
 * jede Linie eine Insel, und es gab keinen Grund, ein *Netz* zu bauen statt
 * einzelner Korridore.
 *
 * Zwei Entscheidungen prägen die Umsetzung:
 *
 * **Umgestiegen wird in einer Stadt, nicht an einer Haltestelle.** Bushaltestelle
 * und Bahnhof derselben Stadt sind im Datenmodell getrennte Objekte an
 * verschiedenen Orten. Wer den Umstieg an die Haltestellen-Identität knüpft,
 * schließt genau den Fall aus, um den es geht — den Zubringerbus zum Bahnhof.
 * Liegen die beiden Halte auseinander, kostet der Weg dazwischen Zeit.
 *
 * **Rundenweise Suche statt Aufzählung.** Die erste Fassung zählte Ketten mit
 * genau einem Umstieg über alle Linienpaare auf. Das war für einen Umstieg
 * kurz und richtig, ließ sich aber nicht erweitern: jeder weitere Umstieg
 * hätte eine Schleifenebene mehr gekostet. Die Suche arbeitet jetzt in Runden
 * nach der Bauart von RAPTOR — Runde 0 sind die Direktverbindungen, Runde r
 * alles mit r Umstiegen. Ein weiterer Umstieg ist damit eine Runde mehr, keine
 * Umschreibung.
 *
 * Was die Suche *nicht* tut: einzelne Fahrten betrachten. Sie rechnet mit Takt
 * und Fahrzeit, nicht mit konkreten Abfahrtszeiten, und kennt deshalb keine
 * knappen oder verpassten Anschlüsse. Für ein Spiel, in dem der Spieler Takte
 * und keine Einzelfahrten plant, ist das die richtige Auflösung.
 */

/**
 * Wie oft ein Fahrgast höchstens umsteigt.
 *
 * Zwei sind das Maß, das ein Netz dieser Größe braucht: Zubringer → Fernlinie →
 * Zubringer. Der dritte Umstieg bringt kaum noch Relationen dazu, weil die
 * Umsteigestrafe (zweifach gewichtet, je Segment 8 bis 25 Minuten) den Gewinn
 * auffrisst — die Suche kann ihn aber, sie braucht nur eine Runde mehr.
 */
export const MAX_TRANSFERS = 2
/** Wie viele *verschiedene Wege* die Suche je Stadt weiterverfolgt. */
export const MAX_ROUTES_PER_CITY = 4
/**
 * Wie viele austauschbare Linienkombinationen je Weg behalten werden.
 *
 * Sie duerfen sich nicht verdraengen: zwei parallele Linien auf demselben Weg
 * sind kein Grund, eine davon zu vergessen, sondern der Grund fuer einen
 * dichteren gemeinsamen Takt.
 */
export const MAX_MEMBERS_PER_ROUTE = 4
/** Mittlere Umsteigestrafe für die Rangfolge während der Suche. */
export const TRANSFER_PENALTY_SEC = 900
/** Mehr Wahlmöglichkeiten je Relation bringen im Logit kaum noch Unterschied. */
export const MAX_ITINERARIES_PER_OD = 3

export interface ItineraryLeg {
  readonly lineId: LineId
  readonly fromIndex: number
  readonly toIndex: number
  readonly fareCents: number
  readonly timeSec: number
}

export interface Itinerary {
  readonly od: string
  readonly legs: readonly ItineraryLeg[]
  /**
   * Wartezeit vor jeder Teilstrecke. Die erste ist der halbe Takt — man weiß
   * nicht, wann man losfahren will. Jede weitere ist die **Anschlusszeit**: was
   * zwischen Aussteigen und Weiterfahrt tatsächlich vergeht.
   */
  readonly legWaits: readonly number[]
  /**
   * Anteil der Reisenden, die den Anschluss vor dieser Teilstrecke verpassen.
   * Vor der ersten Teilstrecke immer 0 — dort gibt es nichts zu verpassen.
   */
  readonly legMisses: readonly number[]
  /** Prägendes Verkehrsmittel: das der längsten Teilstrecke. */
  readonly mode: 'bus' | 'rail'
  readonly travelTimeSec: number
  readonly waitTimeSec: number
  readonly fareCents: number
  readonly comfort: number
  readonly transfers: number
  /** Einzugsgrad von Quell- und Zielhalt, multipliziert. */
  readonly reach: number
  /** Wahrscheinlichkeit, dass die ganze Kette pünktlich ist. */
  readonly punctuality: number
}

/** Die Reisekette als Alternative für das Logit-Modell. */
export function itineraryAlternative(itinerary: Itinerary, ascOffset: number): Alternative {
  return {
    mode: itinerary.mode,
    priceCents: itinerary.fareCents,
    travelTimeSec: itinerary.travelTimeSec,
    waitTimeSec: itinerary.waitTimeSec,
    transfers: itinerary.transfers,
    comfort: itinerary.comfort,
    ...(ascOffset === 0 ? {} : { ascOffset }),
  }
}

/** Fährt diese Teilstrecke in Linienrichtung oder dagegen? */
export const directionOf = (leg: ItineraryLeg): Direction =>
  leg.fromIndex < leg.toIndex ? 'forward' : 'backward'

function singleLeg(offer: LineOffer, a: number, b: number): ItineraryLeg {
  return {
    lineId: offer.lineId,
    fromIndex: a,
    toIndex: b,
    fareCents: legFare(offer, a, b),
    timeSec: rideSeconds(offer, a, b) + offer.averageDelaySec,
  }
}

function combine(
  offers: readonly LineOffer[],
  od: string,
  legs: readonly ItineraryLeg[],
  legWaits: readonly number[],
  legMisses: readonly number[],
): Itinerary {
  const byId = new Map(offers.map((o) => [o.lineId, o]))
  const parts = legs.map((leg) => ({ leg, offer: byId.get(leg.lineId)! }))

  // Die Umsteigezeit steckt in `legWaits` und nicht in der Fahrzeit: Warten am
  // Bahnsteig wiegt im Nutzenmodell schwerer als Sitzen im Zug, und genau das
  // soll ein schlechter Anschluss kosten.
  const travelTimeSec = legs.reduce((s, l) => s + l.timeSec, 0)
  const waitTimeSec = legWaits.reduce((s, w) => s + w, 0)
  const fareCents = legs.reduce((s, l) => s + l.fareCents, 0)

  // Komfort nach Fahrzeit gewichtet - eine kurze Busanfahrt verdirbt keine
  // dreistuendige Bahnfahrt.
  const totalRide = Math.max(1, legs.reduce((s, l) => s + l.timeSec, 0))
  const comfort = parts.reduce((s, p) => s + p.offer.comfort * (p.leg.timeSec / totalRide), 0)

  const longest = parts.reduce((best, p) => (p.leg.timeSec > best.leg.timeSec ? p : best), parts[0]!)
  const first = parts[0]!
  const last = parts[parts.length - 1]!

  // Ein verpasster Anschluss ist der haerteste Fall von Unpuenktlichkeit: man
  // kommt nicht nur spaeter an, man kommt mit dieser Fahrt gar nicht an.
  // Deshalb geht er in dieselbe Kennzahl ein wie die Verspaetung der Linien.
  const reliability = legMisses.reduce((s, m) => s * (1 - m), 1)

  return {
    od,
    legs,
    legWaits,
    legMisses,
    mode: longest.offer.mode,
    travelTimeSec,
    waitTimeSec,
    fareCents,
    comfort,
    transfers: legs.length - 1,
    reach: first.offer.stops[first.leg.fromIndex]!.catchment * last.offer.stops[last.leg.toIndex]!.catchment,
    punctuality: parts.reduce((s, p) => s * p.offer.punctuality, 1) * reliability,
  }
}

/**
 * Eine Verbindung, wie der Reisende sie wahrnimmt: „mit dem Bus über
 * Kreuzstadt", unabhängig davon, welche der drei Linien ihn dorthin bringt.
 *
 * Das ist keine Kosmetik, sondern die Antwort auf ein bekanntes Problem des
 * Logit-Modells (in der Literatur *red bus / blue bus*): stellt man zwei
 * praktisch gleiche Alternativen nebeneinander zur Wahl, bekommen sie zusammen
 * fast doppelt so viel Zuspruch wie eine allein. Wer eine zweite, identische
 * Buslinie auf denselben Korridor legt, verdoppelte damit seine Fahrgastzahlen —
 * nicht weil das Angebot besser wäre, sondern weil das Modell zweimal zählt.
 *
 * Deshalb werden Ketten mit **derselben Städtefolge und denselben
 * Verkehrsmitteln** zu einer Alternative zusammengefasst. Ihre Takte addieren
 * sich zu einem gemeinsamen: zwei Stundentakte sind ein Halbstundentakt, und
 * genau daraus — aus der kürzeren Wartezeit — kommt der Zugewinn. Die
 * gewählten Reisenden werden anschließend nach Fahrtenangebot auf die
 * beteiligten Linien verteilt; wer am Bahnsteig steht, nimmt das, was zuerst
 * kommt.
 */
export interface ItineraryOption {
  readonly od: string
  readonly mode: 'bus' | 'rail'
  readonly travelTimeSec: number
  readonly waitTimeSec: number
  readonly fareCents: number
  readonly comfort: number
  readonly transfers: number
  readonly reach: number
  readonly punctuality: number
  /** Die einzelnen Ketten und ihr Anteil am gemeinsamen Fahrtenangebot. */
  readonly members: readonly { readonly itinerary: Itinerary; readonly share: number }[]
}

/** Die Verbindung als Alternative für das Logit-Modell. */
export function optionAlternative(option: ItineraryOption, ascOffset: number): Alternative {
  return {
    mode: option.mode,
    priceCents: option.fareCents,
    travelTimeSec: option.travelTimeSec,
    waitTimeSec: option.waitTimeSec,
    transfers: option.transfers,
    comfort: option.comfort,
    ...(ascOffset === 0 ? {} : { ascOffset }),
  }
}

/** Städtefolge und Verkehrsmittel — was zwei Ketten austauschbar macht. */
function optionKey(offers: readonly LineOffer[], itinerary: Itinerary): string {
  const byId = new Map(offers.map((o) => [o.lineId, o]))
  return itinerary.legs
    .map((leg) => {
      const offer = byId.get(leg.lineId)!
      return `${offer.stops[leg.fromIndex]!.cityId}>${offer.stops[leg.toIndex]!.cityId}:${offer.mode}`
    })
    .join('+')
}

/**
 * Fasst austauschbare Ketten zu einer Verbindung zusammen.
 *
 * Gerechnet wird **je Teilstrecke**: an jedem Umsteigepunkt addieren sich die
 * Takte der dort verfügbaren Linien zu einem gemeinsamen, und die Wartezeit der
 * Verbindung ist die Summe dieser Teilwartezeiten. Ein einziger gemeinsamer
 * Takt für die ganze Kette wäre falsch — wer zweimal umsteigt, wartet auch
 * zweimal.
 *
 * Der Anteil einer einzelnen Linienkombination ist das Produkt ihrer Anteile an
 * jedem Umsteigepunkt: wer am Bahnsteig steht, nimmt was zuerst kommt, und das
 * an jedem Punkt der Reise neu.
 */
function mergeOptions(offers: readonly LineOffer[], chains: readonly Itinerary[]): ItineraryOption[] {
  const byId = new Map(offers.map((o) => [o.lineId, o]))
  const frequency = (lineId: LineId): number => 60 / Math.max(1, byId.get(lineId)!.headwayMin)

  const groups = new Map<string, Itinerary[]>()
  for (const chain of chains) {
    const key = optionKey(offers, chain)
    const list = groups.get(key)
    if (list) list.push(chain)
    else groups.set(key, [chain])
  }

  const options: ItineraryOption[] = []
  for (const list of groups.values()) {
    const legCount = list[0]!.legs.length

    // Je Teilstrecke: welche Linien stehen zur Wahl, und wie oft fahren sie?
    const perPosition = Array.from({ length: legCount }, (_, i) => {
      const lines = new Map<LineId, number>()
      for (const chain of list) {
        const lineId = chain.legs[i]!.lineId
        if (!lines.has(lineId)) lines.set(lineId, frequency(lineId))
      }
      const total = [...lines.values()].reduce((a, b) => a + b, 0)
      return { lines, total }
    })

    const rawShares = list.map((chain) =>
      chain.legs.reduce((product, leg, i) => {
        const position = perPosition[i]!
        return product * ((position.lines.get(leg.lineId) ?? 0) / position.total)
      }, 1),
    )
    const shareTotal = rawShares.reduce((a, b) => a + b, 0) || 1
    const shares = rawShares.map((s) => s / shareTotal)

    const weight = (pick: (c: Itinerary) => number): number =>
      list.reduce((sum, chain, i) => sum + pick(chain) * shares[i]!, 0)

    // Die Wartezeit vor der ersten Teilstrecke sinkt, wenn mehrere Linien sie
    // bedienen — ihre Takte addieren sich. Bei den Anschlüssen geht das nicht
    // auf: dort zählt, wie gut die konkreten Fahrpläne zueinander passen, und
    // das ist für jede Linienkombination eine eigene Zahl. Deshalb dort der
    // gewichtete Mittelwert. Er liegt etwas über der Wahrheit, weil ein
    // Fahrgast in Wirklichkeit den erstbesten Anschluss nimmt.
    const waitTimeSec =
      waitFromHeadway(60 / perPosition[0]!.total) +
      perPosition.slice(1).reduce((sum, _p, i) => sum + weight((c) => c.legWaits[i + 1] ?? 0), 0)

    const first = list[0]!
    options.push({
      od: first.od,
      mode: first.mode,
      travelTimeSec: weight((c) => c.travelTimeSec),
      waitTimeSec,
      fareCents: weight((c) => c.fareCents),
      comfort: weight((c) => c.comfort),
      transfers: first.transfers,
      reach: weight((c) => c.reach),
      punctuality: weight((c) => c.punctuality),
      members: list.map((itinerary, i) => ({ itinerary, share: shares[i]! })),
    })
  }
  return options
}

/**
 * Alle sinnvollen Verbindungen des eigenen Netzes, nach Relation gebündelt.
 *
 * Die Relationen sind gerichtet: A→B und B→A stehen getrennt, weil Nachfrage
 * und Fahrplan nicht symmetrisch sein müssen.
 */
export function buildOptions(
  state: GameState,
  offers: readonly LineOffer[],
  maxTransfers: number = MAX_TRANSFERS,
): Map<string, ItineraryOption[]> {
  const merged = new Map<string, ItineraryOption[]>()
  for (const [od, chains] of buildItineraries(state, offers, maxTransfers)) {
    const options = mergeOptions(offers, chains)
    if (options.length <= MAX_ITINERARIES_PER_OD) {
      merged.set(od, options)
      continue
    }
    options.sort((x, y) => neutralOptionCost(x) - neutralOptionCost(y))
    merged.set(od, options.slice(0, MAX_ITINERARIES_PER_OD))
  }
  return merged
}

const neutralOptionCost = (option: ItineraryOption): number =>
  generalisedCost('vfr', optionAlternative(option, 0))

/**
 * Die einzelnen Ketten, vor dem Zusammenfassen.
 *
 * Rundenweise Suche in der Bauart von RAPTOR: Runde 0 findet alle
 * Direktverbindungen, Runde r alles, was mit r Umstiegen erreichbar ist. In
 * jeder Runde wird von den in der Vorrunde neu erreichten Städten aus in jede
 * dort haltende Linie umgestiegen.
 *
 * Der Vorgänger zählte Ketten mit genau einem Umstieg auf, mit doppelt
 * geschachtelter Schleife über alle Linienpaare. Das ließ sich nicht auf zwei
 * Umstiege erweitern, ohne kubisch zu werden — die Rundenform kostet dagegen je
 * zusätzlichem Umstieg nur einen weiteren Durchgang.
 */
export function buildItineraries(
  state: GameState,
  offers: readonly LineOffer[],
  maxTransfers: number = MAX_TRANSFERS,
): Map<string, Itinerary[]> {
  const result = new Map<string, Itinerary[]>()
  const boardings = boardingIndex(offers)

  for (const origin of boardings.keys()) {
    for (const [destination, labels] of searchFrom(state, boardings, origin, maxTransfers)) {
      const od = odKey(origin, destination)
      result.set(
        od,
        labels.map((label) => combine(offers, od, label.legs, label.legWaits, label.legMisses)),
      )
    }
  }

  return result
}

/** Wo lässt sich in welche Linie einsteigen? Je Stadt und Linie der erste Halt. */
function boardingIndex(offers: readonly LineOffer[]): Map<CityId, Boarding[]> {
  const index = new Map<CityId, Boarding[]>()
  for (const offer of offers) {
    const seen = new Set<CityId>()
    offer.stops.forEach((stop, stopIndex) => {
      // Faehrt eine Linie dieselbe Stadt zweimal an, zaehlt der erste Halt.
      if (seen.has(stop.cityId)) return
      seen.add(stop.cityId)
      const list = index.get(stop.cityId)
      if (list) list.push({ offer, stopIndex })
      else index.set(stop.cityId, [{ offer, stopIndex }])
    })
  }
  return index
}

interface Boarding {
  readonly offer: LineOffer
  readonly stopIndex: number
}

interface Label {
  readonly legs: readonly ItineraryLeg[]
  /** Städtefolge und Verkehrsmittel — Ketten mit gleichem Weg sind austauschbar. */
  readonly routeKey: string
  /** Wartezeit vor jeder Teilstrecke, erste = halber Takt, danach Anschlusszeit. */
  readonly legWaits: readonly number[]
  /** Anteil verpasster Anschlüsse vor jeder Teilstrecke. */
  readonly legMisses: readonly number[]
  /** Zwischensummen, damit die Bewertung ohne Neuaufbau der Kette auskommt. */
  readonly travelSec: number
  readonly waitSec: number
  readonly fareCents: number
  readonly score: number
  readonly lastLineId: LineId
  readonly lastStationId: string
}

/**
 * Rangfolge während der Suche, in Sekunden.
 *
 * Bewusst nicht `generalisedCost`: das bräuchte je Zwischenschritt eine
 * vollständige Kette. Die Formel ist dieselbe Gewichtung mit dem Zeitwert der
 * Besuchsreisenden, nur inkrementell fortschreibbar. Sie entscheidet
 * ausschließlich, *welche* Wege weiterverfolgt werden — die eigentliche Wahl
 * trifft später das Logit je Segment mit den echten Parametern.
 */
function scoreOf(travelSec: number, waitSec: number, fareCents: number, transfers: number): number {
  return travelSec + WAIT_TIME_WEIGHT * waitSec + TRANSFER_TIME_WEIGHT * TRANSFER_PENALTY_SEC * transfers + fareCents * 4
}

/** Erreichte Wege einer Stadt: je Weg die austauschbaren Linienkombinationen. */
type Routes = Map<string, Label[]>

/** Alle von einer Stadt aus erreichbaren Ziele, mit den besten Wegen dorthin. */
function searchFrom(
  state: GameState,
  boardings: ReadonlyMap<CityId, readonly Boarding[]>,
  origin: CityId,
  maxTransfers: number,
): Map<CityId, Label[]> {
  const reached = new Map<CityId, Routes>()
  let frontier: CityId[] = [origin]
  const byLineId = new Map<LineId, LineOffer>()
  for (const list of boardings.values()) for (const b of list) byLineId.set(b.offer.lineId, b.offer)

  for (let round = 0; round <= maxTransfers; round++) {
    const marked = new Set<CityId>()

    for (const city of frontier) {
      // In Runde 0 startet die Reise; danach zaehlt, womit man angekommen ist.
      const arrivals: readonly (Label | null)[] =
        round === 0 ? [null] : [...(reached.get(city)?.values() ?? [])].flat()

      for (const arrival of arrivals) {
        if (arrival && arrival.legs.length !== round) continue

        for (const { offer, stopIndex } of boardings.get(city) ?? []) {
          // In dieselbe Linie umzusteigen ist kein Umstieg, sondern ein Umweg.
          if (arrival && arrival.lastLineId === offer.lineId) continue

          const interchange = arrival
            ? interchangeSeconds(state, arrival.lastStationId, offer.stops[stopIndex]!.stationId)
            : 0
          const lastLeg = arrival?.legs[arrival.legs.length - 1]
          const lastOffer = lastLeg ? byLineId.get(lastLeg.lineId) : undefined

          for (let target = 0; target < offer.stops.length; target++) {
            if (target === stopIndex) continue
            const destination = offer.stops[target]!
            if (destination.cityId === city || destination.cityId === origin) continue

            const leg = singleLeg(offer, stopIndex, target)
            const legs = arrival ? [...arrival.legs, leg] : [leg]
            const step = `${city}>${destination.cityId}:${offer.mode}`
            const routeKey = arrival ? `${arrival.routeKey}+${step}` : step

            // Die erste Teilstrecke: halber Takt, weil niemand weiss, wann er
            // losfahren will. Jede weitere: die echte Anschlusszeit aus der
            // Phasenlage der beiden Fahrplaene.
            const planned = arrival
              ? connectionWaitSec(
                  { offer: lastOffer!, stopIndex: lastLeg!.toIndex, direction: directionOf(lastLeg!) },
                  { offer, stopIndex, direction: directionOf(leg) },
                  interchange,
                )
              : waitFromHeadway(offer.headwayMin)

            // Wer den Anschluss verpasst, wartet einen ganzen Takt laenger.
            // Genau darin unterscheidet sich ein knapper Anschluss von einem
            // mit Puffer - vorher waren beide gleich gut.
            const miss = arrival
              ? missProbability(lastOffer!.averageDelaySec, Math.max(0, planned - interchange), offer.holdSec)
              : 0
            const headwaySec = Number.isFinite(offer.headwayMin) ? offer.headwayMin * 60 : 0
            const wait = planned + miss * headwaySec

            const legWaits = arrival ? [...arrival.legWaits, wait] : [wait]
            const legMisses = arrival ? [...arrival.legMisses, miss] : [0]
            const travelSec = (arrival?.travelSec ?? 0) + leg.timeSec
            const waitSec = (arrival?.waitSec ?? 0) + wait
            const fareCents = (arrival?.fareCents ?? 0) + leg.fareCents

            const label: Label = {
              legs,
              routeKey,
              legWaits,
              legMisses,
              travelSec,
              waitSec,
              fareCents,
              score: scoreOf(travelSec, waitSec, fareCents, legs.length - 1),
              lastLineId: offer.lineId,
              lastStationId: destination.stationId,
            }

            if (insert(reached, destination.cityId, label)) marked.add(destination.cityId)
          }
        }
      }
    }

    frontier = [...marked]
    if (frontier.length === 0) break
  }

  reached.delete(origin)
  const out = new Map<CityId, Label[]>()
  for (const [city, routes] of reached) out.set(city, [...routes.values()].flat())
  return out
}

/**
 * Nimmt ein Label auf, wenn es zu den besten Wegen dieser Stadt gehört.
 *
 * Verdrängt wird **nur zwischen verschiedenen Wegen**. Zwei Linien auf demselben
 * Weg stehen nebeneinander, statt sich auszustechen — sonst verschwände die
 * zweite Linie eines Korridors aus der Rechnung, obwohl sie den Takt verdichtet.
 */
function insert(reached: Map<CityId, Routes>, city: CityId, label: Label): boolean {
  let routes = reached.get(city)
  if (!routes) {
    routes = new Map()
    reached.set(city, routes)
  }

  const members = routes.get(label.routeKey)
  if (members) {
    // Derselbe Weg, andere Linie: aufnehmen, solange Platz ist.
    if (members.some((m) => m.legs.every((leg, i) => leg.lineId === label.legs[i]!.lineId))) return false
    members.push(label)
    members.sort((a, b) => a.score - b.score)
    if (members.length > MAX_MEMBERS_PER_ROUTE) members.length = MAX_MEMBERS_PER_ROUTE
    return members.includes(label)
  }

  const best = (list: readonly Label[]): number => Math.min(...list.map((l) => l.score))
  // Ein Weg, der weder schneller noch umstiegsaermer ist als ein gefundener,
  // bringt nichts.
  for (const list of routes.values()) {
    if (best(list) <= label.score && list[0]!.legs.length <= label.legs.length) return false
  }

  routes.set(label.routeKey, [label])
  if (routes.size > MAX_ROUTES_PER_CITY) {
    const worst = [...routes.entries()].sort((a, b) => best(b[1]) - best(a[1]))[0]!
    routes.delete(worst[0])
    if (worst[0] === label.routeKey) return false
  }
  return true
}
