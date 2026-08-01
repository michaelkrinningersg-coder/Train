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
 * Reicht der Platz nicht, entscheidet die **Reihenfolge am Bahnsteig**: wer
 * sitzt, bleibt sitzen. Der Zug wird in Fahrtreihenfolge abgearbeitet — an
 * jedem Halt steigen erst die Reisenden aus, deren Ziel erreicht ist, dann
 * bekommen die Wartenden, was frei geworden ist. Wer keinen Platz mehr
 * bekommt, bleibt am Bahnsteig zurück; die Fahrgäste im Zug werden dafür nicht
 * angetastet.
 *
 * Das ist der Unterschied zwischen einem vollen Zug und einem überbuchten. Bis
 * Phase 5f wurde jeder Abschnitt für sich rationiert, und wer ihn durchfuhr,
 * wurde am schwächsten Glied anteilig gekürzt — der Fernreisende aus Hamburg
 * verlor also mitten in Kassel seinen Platz an einen Zusteiger. Real ist es
 * andersherum: der Zusteiger bleibt stehen. Für eine Fernachse macht das den
 * Unterschied aus, ob die Überfüllung die langen oder die kurzen Reisen trifft.
 *
 * Die gemeldete Auslastung bleibt davon unberührt: sie misst weiterhin die
 * **Nachfrage** je Abschnitt gegen die Kapazität und darf über 100 % gehen.
 * Sonst wäre ein hoffnungslos überfüllter Zug in der Anzeige nicht von einem
 * gerade eben ausgelasteten zu unterscheiden.
 */

export const HOURS = 24

export interface AssignmentFlow {
  readonly fromIndex: number
  readonly toIndex: number
  /** Nachfrage je Stunde des Tages. */
  readonly perHour: Float64Array
  readonly fare: Money
  readonly segment: SegmentId
  /**
   * Relation, aus der diese Gruppe stammt ("stadtA|stadtB").
   *
   * Nötig, um am Ende des Tages sagen zu können, *welche* Relation schlecht
   * bedient wurde — die Zufriedenheit hängt an der Relation, nicht an der Linie.
   * Bei einer Reisekette über zwei Linien tragen beide Teilstücke dieselbe
   * Relation, und beide können sie verderben.
   */
  readonly od: string
  /**
   * Kennung der Reisekette, wenn sie umsteigt — sonst nicht gesetzt.
   *
   * Eine Linie kann nur über ihr eigenes Teilstück Auskunft geben. Ob der
   * Fahrgast angekommen ist, entscheidet sich erst, wenn alle Linien gerechnet
   * sind: dafür müssen die Teilstücke wiedererkennbar sein. Bei einer direkten
   * Verbindung gibt es nichts zusammenzusetzen.
   */
  readonly chain?: string
  /** Stellung dieses Teilstücks in der Kette, 0 für das erste. */
  readonly leg?: number
}

/** Was eine Linie über ein Teilstück einer Reisekette zu berichten hat. */
export interface ChainLegOutcome {
  readonly chain: string
  readonly od: string
  readonly leg: number
  readonly wanted: number
  readonly carried: number
}

/** Nachgefragt und mitgenommen je Relation — Grundlage der Zufriedenheit. */
export interface OdOutcome {
  readonly wanted: number
  readonly carried: number
}

export interface AssignmentResult {
  readonly passengers: Record<SegmentId, number>
  readonly totalPassengers: number
  readonly revenue: Money
  readonly leftBehind: number
  /** Davon nur deshalb, weil zu dieser Stunde gar nichts fuhr. */
  readonly outsideService: number
  /** Höchste Auslastung über alle Abschnitte und Stunden. */
  readonly peakLoadFactor: number
  /** Spitzenauslastung je Abschnitt zwischen zwei Halten. */
  readonly linkLoadFactors: readonly number[]
  /**
   * Je Relation, was gewollt und was daraus geworden ist — **nur für Stunden
   * mit Betrieb**. Grundlage der Zufriedenheit.
   */
  readonly byOd: ReadonlyMap<string, OdOutcome>
  /**
   * Ein- und Aussteigende je Fahrt und Halt in der stärksten Stunde.
   * Daraus bemisst der nächste Betriebstag seine Haltezeiten.
   */
  readonly stopFlowPerDeparture: readonly number[]
  /**
   * Teilstücke von Reiseketten, die über diese Linie laufen. Erst der
   * Tagesabschluss setzt daraus zusammen, wer wirklich angekommen ist.
   */
  readonly chainLegs: readonly ChainLegOutcome[]
}

export interface AssignmentInput {
  readonly forward: readonly AssignmentFlow[]
  readonly backward: readonly AssignmentFlow[]
  /** Angebotene Sitzplätze je Stunde und Richtung. */
  readonly seatsPerHour: Float64Array
  /** Fahrten je Stunde und Richtung — für die Haltezeit aus Andrang. */
  readonly departuresPerHour: Float64Array
  /** Zahl der Halte; es gibt stopCount-1 Abschnitte. */
  readonly stopCount: number
}

const emptySegments = (): Record<SegmentId, number> => {
  const r = {} as Record<SegmentId, number>
  for (const s of SEGMENT_IDS) r[s] = 0
  return r
}

export function assignPassengers(input: AssignmentInput): AssignmentResult {
  const { forward, backward, seatsPerHour, departuresPerHour, stopCount } = input
  const passengers = emptySegments()
  const linkCount = Math.max(1, stopCount - 1)
  const stops = Math.max(1, stopCount)
  const linkLoadFactors = new Array<number>(linkCount).fill(0)
  const stopFlowPerDeparture = new Array<number>(stops).fill(0)
  const byOd = new Map<string, { wanted: number; carried: number }>()

  let revenue = 0
  let leftBehind = 0
  let outsideService = 0
  let peakLoadFactor = 0

  const record = (od: string, wanted: number, carried: number): void => {
    const entry = byOd.get(od)
    if (entry) {
      entry.wanted += wanted
      entry.carried += carried
    } else {
      byOd.set(od, { wanted, carried })
    }
  }

  // Ueber die Segmente hinweg zusammengefasst: fuer die Frage, ob die Kette
  // haelt, ist es gleich, ob der Fahrgast Pendler oder Tourist ist.
  const chainLegs = new Map<string, { chain: string; od: string; leg: number; wanted: number; carried: number }>()
  const recordChain = (flow: AssignmentFlow, wanted: number, carried: number): void => {
    if (flow.chain === undefined || flow.leg === undefined) return
    const key = `${flow.chain} ${flow.leg}`
    const entry = chainLegs.get(key)
    if (entry) {
      entry.wanted += wanted
      entry.carried += carried
    } else {
      chainLegs.set(key, { chain: flow.chain, od: flow.od, leg: flow.leg, wanted, carried })
    }
  }

  for (const flows of [forward, backward]) {
    if (flows.length === 0) continue

    // Fahrtreihenfolge: vorwaerts steigende Haltnummern, rueckwaerts fallende.
    // Daran haengt, wer zuerst am Bahnsteig steht.
    const outbound = flows[0]!.fromIndex < flows[0]!.toIndex
    const order = Array.from({ length: stops }, (_, i) => (outbound ? i : stops - 1 - i))

    // Gruppen nach Einstiegshalt, einmal fuer alle Stunden.
    const boardingAt: AssignmentFlow[][] = Array.from({ length: stops }, () => [])
    for (const flow of flows) boardingAt[flow.fromIndex]?.push(flow)

    // Puffer ausserhalb der Stundenschleife: 24 Stunden mal zwei Richtungen
    // mal jede Linie waere sonst viel Muell fuer den Sammler.
    const alighting = new Float64Array(stops)

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
      //
      // Es geht auch *nicht* in die Relationsabrechnung, aus der die
      // Zufriedenheit entsteht: dass um 23 Uhr nichts faehrt, weiss der Reisende
      // vorher, und die Verkehrsmittelwahl hat den duennen Takt ueber die
      // Wartezeit laengst bestraft. Ihn hier ein zweites Mal zu bestrafen machte
      // aus einem Dreistundentakt eine Katastrophe, obwohl kein einziger
      // Fahrgast stehen geblieben ist.
      if (capacity <= 0) {
        leftBehind += demandThisHour
        outsideService += demandThisHour
        continue
      }

      // Gemeldet wird die Nachfrage gegen die Kapazitaet, nicht die Belegung -
      // siehe Kopfkommentar.
      for (let link = 0; link < linkCount; link++) {
        const load = linkLoad[link]! / capacity
        if (load > 0) {
          linkLoadFactors[link] = Math.max(linkLoadFactors[link]!, load)
          peakLoadFactor = Math.max(peakLoadFactor, load)
        }
      }

      // Ein- und Aussteigende dieser Stunde, fuer die Haltezeit des Folgetags.
      const boarding = new Float64Array(stops)
      alighting.fill(0)
      let onboard = 0

      // Der Zug faehrt die Halte der Reihe nach ab. Erst aussteigen, dann
      // einsteigen, so weit der frei gewordene Platz reicht.
      for (const stop of order) {
        onboard -= alighting[stop]!

        const waiting = boardingAt[stop]!
        if (waiting.length === 0) continue

        let wantedHere = 0
        for (const flow of waiting) wantedHere += flow.perHour[h] ?? 0
        if (wantedHere <= 0) continue

        // Wer schon sitzt, wird nicht angetastet. Frei ist nur der Rest.
        const free = Math.max(0, capacity - onboard)
        const scale = wantedHere > free ? free / wantedHere : 1

        for (const flow of waiting) {
          const wanted = flow.perHour[h] ?? 0
          if (wanted <= 0) continue
          const carried = wanted * scale
          leftBehind += wanted - carried
          passengers[flow.segment] += carried
          revenue += carried * flow.fare
          record(flow.od, wanted, carried)
          recordChain(flow, wanted, carried)

          // Jeder Fahrgast steigt einmal ein und einmal aus.
          boarding[flow.fromIndex]! += carried
          boarding[flow.toIndex]! += carried
          alighting[flow.toIndex]! += carried
          onboard += carried
        }
      }

      const runsThisHour = departuresPerHour[h] ?? 0
      if (runsThisHour > 0) {
        for (let s = 0; s < stops; s++) {
          stopFlowPerDeparture[s] = Math.max(stopFlowPerDeparture[s]!, boarding[s]! / runsThisHour)
        }
      }
    }
  }

  const totalPassengers = SEGMENT_IDS.reduce((s, seg) => s + passengers[seg], 0)
  return {
    passengers,
    totalPassengers,
    revenue: Math.round(revenue),
    leftBehind,
    outsideService,
    peakLoadFactor,
    linkLoadFactors,
    byOd,
    stopFlowPerDeparture,
    chainLegs: [...chainLegs.values()],
  }
}
