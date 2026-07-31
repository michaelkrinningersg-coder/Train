import type { CityId, GameState, LineId } from '@game/domain'
import { generalisedCost, odKey, waitFromHeadway, type Alternative } from '@game/demand'
import { distanceKm } from '@game/geo'
import { legFare, rideSeconds, type LineOffer } from './offers.js'

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
 * **Höchstens ein Umstieg.** Zwei Umstiege wären ein spürbar größeres Stück
 * Arbeit (die Kandidatenmenge wächst kubisch, und man braucht eine echte
 * Verbindungssuche statt einer Aufzählung), bringen aber in einem Netz dieser
 * Größe wenig: die zweite Umsteigestrafe frisst den Gewinn meist auf. Sollte
 * sich das mit einem europaweiten Netz ändern, ist der Ersatz dieser Datei durch
 * einen RAPTOR-Lauf der richtige Weg — die Schnittstelle bleibt dieselbe.
 */

export const MAX_TRANSFERS = 1
/** Mindestzeit für einen Umstieg, auch am selben Bahnsteig. */
export const MIN_INTERCHANGE_SEC = 120
/** Fußweg zwischen zwei Halten derselben Stadt. */
export const INTERCHANGE_WALK_KMH = 4.5
/** Mehr Wahlmöglichkeiten je Relation bringen im Logit kaum noch Unterschied. */
export const MAX_ITINERARIES_PER_OD = 3
/**
 * Obergrenze für die *ungebündelten* Ketten je Relation. Großzügiger als die
 * Zahl der Verbindungen, weil erst das Zusammenfassen austauschbare Ketten zu
 * einer Verbindung macht — würde hier zu früh gekappt, verschwänden Linien aus
 * einem gemeinsamen Takt, statt ihn zu verdichten.
 */
export const MAX_CHAINS_PER_OD = 12

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

/** Städte einer Linie mit dem Index ihres ersten Halts. */
function citiesOf(offer: LineOffer): Map<CityId, number> {
  const map = new Map<CityId, number>()
  offer.stops.forEach((stop, index) => {
    // Fährt eine Linie dieselbe Stadt zweimal an, zählt der erste Halt. Ein
    // Ringverkehr durch dieselbe Stadt ist im Spiel nicht vorgesehen.
    if (!map.has(stop.cityId)) map.set(stop.cityId, index)
  })
  return map
}

function singleLeg(offer: LineOffer, a: number, b: number): ItineraryLeg {
  return {
    lineId: offer.lineId,
    fromIndex: a,
    toIndex: b,
    fareCents: legFare(offer, a, b),
    timeSec: rideSeconds(offer, a, b) + offer.averageDelaySec,
  }
}

/** Fußweg zwischen zwei Halten derselben Stadt, plus Mindestumsteigezeit. */
function interchangeSeconds(state: GameState, fromStation: string, toStation: string): number {
  if (fromStation === toStation) return MIN_INTERCHANGE_SEC
  const a = state.network.stations.get(fromStation as never)
  const b = state.network.stations.get(toStation as never)
  if (!a || !b) return MIN_INTERCHANGE_SEC
  const km = distanceKm(a.position, b.position)
  return MIN_INTERCHANGE_SEC + (km / INTERCHANGE_WALK_KMH) * 3600
}

function combine(offers: readonly LineOffer[], od: string, legs: readonly ItineraryLeg[], extraTimeSec: number): Itinerary {
  const byId = new Map(offers.map((o) => [o.lineId, o]))
  const parts = legs.map((leg) => ({ leg, offer: byId.get(leg.lineId)! }))

  const travelTimeSec = legs.reduce((s, l) => s + l.timeSec, 0) + extraTimeSec
  const waitTimeSec = parts.reduce((s, p) => s + waitFromHeadway(p.offer.headwayMin), 0)
  const fareCents = legs.reduce((s, l) => s + l.fareCents, 0)

  // Komfort nach Fahrzeit gewichtet - eine kurze Busanfahrt verdirbt keine
  // dreistuendige Bahnfahrt.
  const totalRide = Math.max(1, legs.reduce((s, l) => s + l.timeSec, 0))
  const comfort = parts.reduce((s, p) => s + p.offer.comfort * (p.leg.timeSec / totalRide), 0)

  const longest = parts.reduce((best, p) => (p.leg.timeSec > best.leg.timeSec ? p : best), parts[0]!)
  const first = parts[0]!
  const last = parts[parts.length - 1]!

  return {
    od,
    legs,
    mode: longest.offer.mode,
    travelTimeSec,
    waitTimeSec,
    fareCents,
    comfort,
    transfers: legs.length - 1,
    reach: first.offer.stops[first.leg.fromIndex]!.catchment * last.offer.stops[last.leg.toIndex]!.catchment,
    punctuality: parts.reduce((s, p) => s * p.offer.punctuality, 1),
  }
}

/**
 * Neutrale Rangfolge, um je Relation die besten Ketten zu behalten.
 *
 * Gewertet wird mit den Parametern der Besuchsreisenden — ein Segment in der
 * Mitte des Feldes, weder besonders zeitkritisch noch besonders preissensibel.
 * Eine segmentgenaue Auswahl wäre schöner, aber die Auswahl entscheidet nur,
 * *welche* drei Ketten ins Logit gehen, nicht wie es ausgeht.
 */
function neutralCost(itinerary: Itinerary): number {
  return generalisedCost('vfr', itineraryAlternative(itinerary, 0))
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
  const parts: string[] = []
  for (const leg of itinerary.legs) {
    const offer = byId.get(leg.lineId)!
    parts.push(`${offer.stops[leg.fromIndex]!.cityId}>${offer.stops[leg.toIndex]!.cityId}:${offer.mode}`)
  }
  return parts.join('+')
}

/**
 * Fasst austauschbare Ketten zu einer Verbindung zusammen.
 *
 * Die Takte addieren sich als Frequenzen: zwei Linien im Stundentakt ergeben
 * einen Halbstundentakt und damit die halbe Wartezeit. Fahrzeit, Preis und
 * Komfort werden nach Fahrtenangebot gemittelt — wer öfter fährt, prägt das
 * Bild der Verbindung stärker.
 */
function mergeOptions(offers: readonly LineOffer[], chains: readonly Itinerary[]): ItineraryOption[] {
  const groups = new Map<string, Itinerary[]>()
  for (const chain of chains) {
    const key = optionKey(offers, chain)
    const list = groups.get(key)
    if (list) list.push(chain)
    else groups.set(key, [chain])
  }

  const options: ItineraryOption[] = []
  for (const list of groups.values()) {
    // Fahrten je Stunde als Kehrwert des Takts; die erste Teilstrecke bestimmt,
    // wie oft man ueberhaupt losfahren kann.
    const frequency = list.map((c) => 60 / Math.max(1, headwayOf(offers, c)))
    const total = frequency.reduce((a, b) => a + b, 0)
    const weight = (pick: (c: Itinerary) => number): number =>
      list.reduce((s, c, i) => s + pick(c) * (frequency[i]! / total), 0)

    const first = list[0]!
    options.push({
      od: first.od,
      mode: first.mode,
      travelTimeSec: weight((c) => c.travelTimeSec),
      // Gemeinsamer Takt aus der Summe der Frequenzen.
      waitTimeSec: waitFromHeadway(60 / total),
      fareCents: weight((c) => c.fareCents),
      comfort: weight((c) => c.comfort),
      transfers: first.transfers,
      reach: weight((c) => c.reach),
      punctuality: weight((c) => c.punctuality),
      members: list.map((itinerary, i) => ({ itinerary, share: frequency[i]! / total })),
    })
  }
  return options
}

/** Takt der Kette: der dünnste ihrer Teilstrecken begrenzt sie. */
function headwayOf(offers: readonly LineOffer[], itinerary: Itinerary): number {
  const byId = new Map(offers.map((o) => [o.lineId, o]))
  return Math.max(...itinerary.legs.map((l) => byId.get(l.lineId)!.headwayMin))
}

/**
 * Alle sinnvollen Verbindungen des eigenen Netzes, nach Relation gebündelt.
 *
 * Die Relationen sind gerichtet: A→B und B→A stehen getrennt, weil Nachfrage
 * und Fahrplan nicht symmetrisch sein müssen.
 */
export function buildOptions(state: GameState, offers: readonly LineOffer[]): Map<string, ItineraryOption[]> {
  const merged = new Map<string, ItineraryOption[]>()
  for (const [od, chains] of buildItineraries(state, offers)) {
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

/** Die einzelnen Ketten, vor dem Zusammenfassen. */
export function buildItineraries(state: GameState, offers: readonly LineOffer[]): Map<string, Itinerary[]> {
  const result = new Map<string, Itinerary[]>()
  const cityIndex = offers.map((offer) => ({ offer, cities: citiesOf(offer) }))

  const add = (itinerary: Itinerary): void => {
    const list = result.get(itinerary.od)
    if (list) list.push(itinerary)
    else result.set(itinerary.od, [itinerary])
  }

  // Direktverbindungen.
  for (const offer of offers) {
    for (let a = 0; a < offer.stops.length; a++) {
      for (let b = 0; b < offer.stops.length; b++) {
        if (a === b) continue
        const from = offer.stops[a]!
        const to = offer.stops[b]!
        if (from.cityId === to.cityId) continue
        add(combine(offers, odKey(from.cityId, to.cityId), [singleLeg(offer, a, b)], 0))
      }
    }
  }

  // Ketten mit genau einem Umstieg.
  for (const first of cityIndex) {
    for (const second of cityIndex) {
      if (first.offer.lineId === second.offer.lineId) continue

      for (const [transferCity, exitIndex] of first.cities) {
        const entryIndex = second.cities.get(transferCity)
        if (entryIndex === undefined) continue

        const walk = interchangeSeconds(
          state,
          first.offer.stops[exitIndex]!.stationId,
          second.offer.stops[entryIndex]!.stationId,
        )

        for (let a = 0; a < first.offer.stops.length; a++) {
          const origin = first.offer.stops[a]!
          if (a === exitIndex || origin.cityId === transferCity) continue

          for (let b = 0; b < second.offer.stops.length; b++) {
            const destination = second.offer.stops[b]!
            if (b === entryIndex || destination.cityId === transferCity) continue
            if (destination.cityId === origin.cityId) continue

            add(
              combine(
                offers,
                odKey(origin.cityId, destination.cityId),
                [singleLeg(first.offer, a, exitIndex), singleLeg(second.offer, entryIndex, b)],
                walk,
              ),
            )
          }
        }
      }
    }
  }

  // Je Relation nur die besten Ketten behalten.
  for (const [od, list] of result) {
    if (list.length <= MAX_CHAINS_PER_OD) continue
    list.sort((x, y) => neutralCost(x) - neutralCost(y))
    result.set(od, list.slice(0, MAX_CHAINS_PER_OD))
  }

  return result
}
