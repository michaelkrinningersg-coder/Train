import { SEGMENT_IDS, toDate, type CityId, type GameState, type LineId } from '@game/domain'
import {
  alternativeShares,
  carAlternative,
  dayFactor,
  hourShare,
  incumbentTransit,
  noTravelAlternative,
  type Alternative,
  type DemandMatrix,
} from '@game/demand'
import { HOURS, type AssignmentFlow } from './assignment.js'
import { optionAlternative, type ItineraryOption } from './itineraries.js'
import { satisfactionOffset } from './satisfaction.js'

/**
 * Verteilung der Nachfrage auf das eigene Netz.
 *
 * Diese Stelle ist neu in Phase 4 und ersetzt eine Rechnung, die vorher in jeder
 * Linie einzeln steckte. Der Unterschied ist nicht nur Aufräumen: solange jede
 * Linie ihren Anteil selbst aus der Matrix zog, konnte es keine Reisekette über
 * zwei Linien geben, und zwei Linien auf demselben Korridor bedienten beide die
 * volle Nachfrage — sie zählten dieselben Leute doppelt.
 *
 * Jetzt gibt es eine Wahl je Relation und Segment: alle Reiseketten des eigenen
 * Netzes stehen als *einzelne* Alternativen im Logit, zusammen mit Auto,
 * Bestandsverkehr und Zuhausebleiben. Wer sich für eine Kette entscheidet, wird
 * auf allen ihren Teilstücken eingebucht.
 */

export interface AssignedFlows {
  readonly forward: AssignmentFlow[]
  readonly backward: AssignmentFlow[]
}

export interface DemandAssignment {
  readonly byLine: ReadonlyMap<LineId, AssignedFlows>
  /** Pünktlichkeit der gewählten Ketten je Relation, nach Reisenden gewichtet. */
  readonly punctualityByOd: ReadonlyMap<string, number>
  /** Fahrgäste je Linie, die auf einer Kette mit Umstieg sitzen. */
  readonly transferRidersByLine: ReadonlyMap<LineId, number>
  /** Fahrgäste je Linie, die den Anschluss *an* diese Linie verpassen. */
  readonly missedByLine: ReadonlyMap<LineId, number>
}

export function assignDemand(
  state: GameState,
  demand: DemandMatrix,
  options: ReadonlyMap<string, readonly ItineraryOption[]>,
): DemandAssignment {
  const byLine = new Map<LineId, AssignedFlows>()
  const transferRidersByLine = new Map<LineId, number>()
  const missedByLine = new Map<LineId, number>()
  const punctualitySum = new Map<string, { weighted: number; riders: number }>()
  const { weekday, month } = toDate(state.day)

  const flowsOf = (lineId: LineId): AssignedFlows => {
    const existing = byLine.get(lineId)
    if (existing) return existing
    const created: AssignedFlows = { forward: [], backward: [] }
    byLine.set(lineId, created)
    return created
  }

  for (const [od, connections] of options) {
    if (connections.length === 0) continue
    const pair = demand.byKey.get(od)
    if (!pair) continue

    const [fromCity, toCity] = od.split('|') as [CityId, CityId]
    const offset = satisfactionOffset(state.satisfaction.get(od) ?? 1)

    const own: Alternative[] = connections.map((c) => optionAlternative(c, offset))
    const alternatives: Alternative[] = [...own, carAlternative(pair.distanceKm), noTravelAlternative]

    // Wo der Spieler selbst mit der Bahn faehrt, faellt der Bestandsverkehr weg -
    // er hat die Relation uebernommen. Sonst konkurrierte er gegen ein Phantom.
    if (!connections.some((c) => c.mode === 'rail')) {
      const smaller = Math.min(
        state.cities.get(fromCity)?.population ?? 0,
        state.cities.get(toCity)?.population ?? 0,
      )
      alternatives.push(incumbentTransit(pair.distanceKm, smaller))
    }

    for (const segment of SEGMENT_IDS) {
      const daily = pair.trips[segment] * dayFactor(segment, weekday, month)
      if (daily <= 0) continue

      const shares = alternativeShares(segment, alternatives)

      for (let i = 0; i < connections.length; i++) {
        const connection = connections[i]!
        // Der Einzugsgrad begrenzt, wie viele der Reisenden diese Halte
        // ueberhaupt erreichen - er wirkt auf die Verbindung, nicht auf den
        // Pool, weil verschiedene Verbindungen verschiedene Halte benutzen.
        const chosen = daily * (shares[i] ?? 0) * connection.reach
        if (chosen <= 0.01) continue

        // Auf die beteiligten Linien nach Fahrtenangebot verteilt: wer am
        // Bahnsteig steht, nimmt, was zuerst kommt.
        for (const { itinerary, share } of connection.members) {
          const riders = chosen * share
          if (riders <= 0.001) continue

          const perHour = new Float64Array(HOURS)
          for (let h = 0; h < HOURS; h++) perHour[h] = riders * hourShare(segment, h)

          itinerary.legs.forEach((leg, position) => {
            const flow: AssignmentFlow = {
              fromIndex: leg.fromIndex,
              toIndex: leg.toIndex,
              // Dieselbe Ganglinie fuer alle Teilstuecke: `assignPassengers`
              // liest sie nur, deshalb ist das Teilen sicher.
              perHour,
              fare: leg.fareCents,
              segment,
              od,
            }
            const target = flowsOf(leg.lineId)
            if (leg.fromIndex < leg.toIndex) target.forward.push(flow)
            else target.backward.push(flow)

            if (itinerary.transfers > 0) {
              transferRidersByLine.set(leg.lineId, (transferRidersByLine.get(leg.lineId) ?? 0) + riders)
            }

            // Verpasste Anschluesse zaehlen bei der Linie, die weggefahren ist -
            // dort entscheidet der Spieler ueber die Wartebereitschaft.
            const missed = riders * (itinerary.legMisses[position] ?? 0)
            if (missed > 0) missedByLine.set(leg.lineId, (missedByLine.get(leg.lineId) ?? 0) + missed)
          })
        }

        const entry = punctualitySum.get(od)
        if (entry) {
          entry.weighted += connection.punctuality * chosen
          entry.riders += chosen
        } else {
          punctualitySum.set(od, { weighted: connection.punctuality * chosen, riders: chosen })
        }
      }
    }
  }

  const punctualityByOd = new Map<string, number>()
  for (const [od, { weighted, riders }] of punctualitySum) {
    punctualityByOd.set(od, riders > 0 ? weighted / riders : 1)
  }

  return { byLine, punctualityByOd, transferRidersByLine, missedByLine }
}
