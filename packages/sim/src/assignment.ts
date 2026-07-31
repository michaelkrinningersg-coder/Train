import { SEGMENT_IDS } from '@game/domain'
import type { Money, SegmentId } from '@game/domain'

/**
 * Fahrgastzuordnung auf eine Linie.
 *
 * Der Kern ist die **abschnittsweise Belegung**: ein Fahrgast von Halt 2 nach
 * Halt 4 besetzt nur die Abschnitte 2→3 und 3→4. Am Zielhalt steigt er aus, der
 * Platz wird wieder frei und kann weiterverkauft werden. Ein Zug fährt also
 * nicht mit einer festen Füllung durch, sondern wird unterwegs geleert und neu
 * gefüllt — auf einer langen Linie kann er zwischen zwei Ballungsräumen
 * überfüllt und auf dem Land halb leer sein.
 *
 * Reicht der Platz nicht, wird **nur dort rationiert, wo es eng ist**. Jeder
 * Abschnitt bekommt seinen eigenen Faktor; eine Fahrgastgruppe wird von dem
 * schlechtesten Abschnitt begrenzt, den sie durchfährt. Wer nur eine Station
 * auf einem freien Stück fährt, kommt mit — auch wenn zwei Abschnitte weiter
 * niemand mehr zusteigen kann.
 *
 * Nicht modelliert: die Reihenfolge am Bahnsteig. Real entscheidet, wer zuerst
 * da ist, ob ein Fernreisender oder ein Kurzstreckenfahrer den letzten Platz
 * bekommt. Hier werden alle Gruppen eines Abschnitts gleich behandelt.
 */

export const HOURS = 24

export interface AssignmentFlow {
  readonly fromIndex: number
  readonly toIndex: number
  /** Nachfrage je Stunde des Tages. */
  readonly perHour: Float64Array
  readonly fare: Money
  readonly segment: SegmentId
}

export interface AssignmentResult {
  readonly passengers: Record<SegmentId, number>
  readonly totalPassengers: number
  readonly revenue: Money
  readonly leftBehind: number
  /** Höchste Auslastung über alle Abschnitte und Stunden. */
  readonly peakLoadFactor: number
  /** Spitzenauslastung je Abschnitt zwischen zwei Halten. */
  readonly linkLoadFactors: readonly number[]
}

const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

/**
 * @param flows      Nachfragegruppen beider Richtungen, getrennt übergeben
 * @param seatsPerHour Angebotene Sitzplätze je Stunde und Richtung
 * @param stopCount  Zahl der Halte; es gibt stopCount-1 Abschnitte
 */
export function assignPassengers(
  flowsForward: readonly AssignmentFlow[],
  flowsBackward: readonly AssignmentFlow[],
  seatsPerHour: Float64Array,
  stopCount: number,
): AssignmentResult {
  const passengers = emptySegments()
  const linkCount = Math.max(1, stopCount - 1)
  const linkLoadFactors = new Array<number>(linkCount).fill(0)

  let revenue = 0
  let leftBehind = 0
  let peakLoadFactor = 0

  for (const flows of [flowsForward, flowsBackward]) {
    for (let h = 0; h < HOURS; h++) {
      const capacity = seatsPerHour[h] ?? 0

      // Belegung je Abschnitt in dieser Stunde.
      const linkLoad = new Float64Array(linkCount)
      let demandThisHour = 0
      for (const flow of flows) {
        const value = flow.perHour[h] ?? 0
        if (value <= 0) continue
        demandThisHour += value
        const lo = Math.min(flow.fromIndex, flow.toIndex)
        const hi = Math.max(flow.fromIndex, flow.toIndex)
        for (let link = lo; link < hi; link++) linkLoad[link]! += value
      }
      if (demandThisHour <= 0) continue

      // Ausserhalb der Betriebszeit faehrt nichts. Das ist keine Ueberlastung,
      // sondern fehlendes Angebot - es geht in `leftBehind`, nicht in die
      // Auslastung, sonst waere jede Linie nachts unendlich ueberfuellt.
      if (capacity <= 0) {
        leftBehind += demandThisHour
        continue
      }

      // Ein Faktor je Abschnitt statt eines Faktors für die ganze Linie.
      const linkScale = new Float64Array(linkCount).fill(1)
      for (let link = 0; link < linkCount; link++) {
        const load = linkLoad[link]! / capacity
        if (load > 0) {
          linkLoadFactors[link] = Math.max(linkLoadFactors[link]!, load)
          peakLoadFactor = Math.max(peakLoadFactor, load)
        }
        linkScale[link] = load > 1 ? 1 / load : 1
      }

      for (const flow of flows) {
        const wanted = flow.perHour[h] ?? 0
        if (wanted <= 0) continue

        const lo = Math.min(flow.fromIndex, flow.toIndex)
        const hi = Math.max(flow.fromIndex, flow.toIndex)
        let scale = 1
        for (let link = lo; link < hi; link++) scale = Math.min(scale, linkScale[link]!)

        const carried = wanted * scale
        leftBehind += wanted - carried
        passengers[flow.segment] += carried
        revenue += carried * flow.fare
      }
    }
  }

  const totalPassengers = SEGMENT_IDS.reduce((s, seg) => s + passengers[seg], 0)
  return {
    passengers,
    totalPassengers,
    revenue: Math.round(revenue),
    leftBehind,
    peakLoadFactor,
    linkLoadFactors,
  }
}
