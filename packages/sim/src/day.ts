import type { GameState, LineDayResult, LineId, VehicleId } from '@game/domain'
import type { DemandMatrix } from '@game/demand'
import { finishBusDay, idleResult } from './busDay.js'
import { applyConnectionHolding, type LineHold } from './connections.js'
import { assignDemand, type AssignedFlows } from './demandAssignment.js'
import { buildOptions, type ItineraryOption } from './itineraries.js'
import { prepareLines, type PreparedLine } from './offers.js'
import { finishRailDay, type RailDayResult } from './railDay.js'
import { updateSatisfaction, type ServiceObservation } from './satisfaction.js'

/**
 * Ein Betriebstag des ganzen Netzes.
 *
 * Die Reihenfolge ist der eigentliche Inhalt dieser Datei:
 *
 * 1. **Angebot** — jede Linie rechnet aus, was sie heute fährt. Für Bahnlinien
 *    heißt das Fahrplan bauen, Konflikte suchen und Verspätungen auflösen. Die
 *    Haltezeiten stammen aus den Fahrgastzahlen von gestern.
 * 2. **Anschlusssicherung** — Linien, die auf Zubringer warten, holen sich
 *    deren Verspätung ins eigene Angebot. Das muss zwischen 1 und 3 stehen:
 *    vorher ist die Verspätung des Zubringers noch nicht bekannt, nachher wäre
 *    die Reisekette schon mit falschen Zeiten bewertet.
 * 3. **Reiseketten** — aus allen Angeboten zusammen werden die möglichen
 *    Verbindungen gebildet, direkt und mit bis zu zwei Umstiegen.
 * 4. **Wahl** — je Relation und Segment entscheidet ein Logit zwischen den
 *    Ketten, dem Auto, dem Bestandsverkehr und Zuhausebleiben. Die Zufriedenheit
 *    der Relation geht als Abschlag auf das eigene Angebot ein.
 * 5. **Kapazität** — jede Linie prüft abschnittsweise, wer mitkommt.
 * 6. **Nachwirkung** — daraus werden Zufriedenheit und Andrang des nächsten
 *    Tages fortgeschrieben.
 *
 * Schritt 2 und 3 gab es vorher nicht; jede Linie zog ihren Anteil selbst aus
 * der Matrix. Deshalb konnte niemand umsteigen, und zwei Linien auf demselben
 * Korridor bedienten beide dieselben Leute.
 */

export interface DaySimulation {
  readonly lines: readonly LineDayResult[]
  readonly prepared: readonly PreparedLine[]
  readonly options: ReadonlyMap<string, readonly ItineraryOption[]>
  /** Was jede Linie an Verspätung durch gehaltene Anschlüsse aufnimmt. */
  readonly holds: ReadonlyMap<LineId, LineHold>
  /** Fahrzeuge, die heute liegengeblieben sind und in die Werkstatt müssen. */
  readonly breakdowns: readonly Breakdown[]
  /** Zufriedenheit nach diesem Tag — Eingabe für den nächsten. */
  readonly satisfaction: ReadonlyMap<string, number>
  /** Ein- und Aussteigende je Fahrt und Halt — Eingabe für die Haltezeiten morgen. */
  readonly crowding: ReadonlyMap<LineId, readonly number[]>
}

/**
 * Ein Fahrzeugschaden, wie ihn der Tagesabschluss verarbeitet.
 *
 * Er wirkt **ab morgen**: die restlichen Läufe des Tages fahren noch. Sie
 * mitzustreichen hieße, den Fahrplan mitten am Tag neu zu bauen — mit allen
 * Belegungen und Anschlüssen, die daran hängen. Für ein Spiel, in dem der
 * Spieler Fahrpläne und keine Einzelfahrten disponiert, ist der Tag die
 * richtige Auflösung.
 */
export interface Breakdown {
  readonly vehicleId: VehicleId
  readonly lineId: LineId
  readonly days: number
}

const NO_FLOWS: AssignedFlows = { forward: [], backward: [] }

export function simulateDay(state: GameState, demand: DemandMatrix): DaySimulation {
  const raw = prepareLines(state)
  const { offers, holds } = applyConnectionHolding(
    state,
    raw.flatMap((p) => (p.kind === 'idle' ? [] : [p.offer])),
  )

  // Die gehaltenen Angebote zurueck an ihre Linien - alles Weitere rechnet mit
  // der Verspaetung *nach* dem Warten, weil das die ist, die der Fahrgast
  // erlebt und die der Betrieb bezahlt.
  const byLineOffer = new Map(offers.map((o) => [o.lineId, o]))
  const prepared = raw.map((p) =>
    p.kind === 'idle' ? p : { ...p, offer: byLineOffer.get(p.offer.lineId) ?? p.offer },
  )

  const options = buildOptions(state, offers)
  const { byLine, punctualityByOd, transferRidersByLine, missedByLine } = assignDemand(state, demand, options)

  const lines: LineDayResult[] = []
  const crowding = new Map<LineId, readonly number[]>()
  const observations = new Map<string, { wanted: number; carried: number; punctuality: number }>()

  for (const line of prepared) {
    if (line.kind === 'idle') {
      lines.push(idleResult(line))
      continue
    }

    const flows = byLine.get(line.line.id) ?? NO_FLOWS
    const transfers = transferRidersByLine.get(line.line.id) ?? 0
    const { result, odOutcomes } =
      line.kind === 'rail'
        ? finishRailDay(state, line, flows, transfers)
        : finishBusDay(state, line, flows, transfers)

    lines.push({
      ...result,
      holdDelaySec: holds.get(line.line.id)?.seconds ?? 0,
      missedConnections: missedByLine.get(line.line.id) ?? 0,
    })
    if (result.stopFlowPerDeparture) crowding.set(line.line.id, result.stopFlowPerDeparture)

    // Beobachtungen je Relation einsammeln. Bei einer Kette ueber zwei Linien
    // zaehlen beide Teilstuecke - wer auf dem zweiten haengen bleibt, gilt damit
    // als halb bedient. Das ist grosszuegiger als die Wahrheit (er kommt gar
    // nicht an), aber ehrlicher als ihn ganz zu ignorieren, und es haelt die
    // Rechnung ohne einen zweiten Zuordnungsdurchgang aus.
    for (const [od, outcome] of odOutcomes) {
      const entry = observations.get(od)
      const punctuality = punctualityByOd.get(od) ?? 1
      if (entry) {
        entry.wanted += outcome.wanted
        entry.carried += outcome.carried
        entry.punctuality = Math.min(entry.punctuality, punctuality)
      } else {
        observations.set(od, { wanted: outcome.wanted, carried: outcome.carried, punctuality })
      }
    }
  }

  const breakdowns: Breakdown[] = prepared.flatMap((p) =>
    p.kind !== 'rail'
      ? []
      : p.detail.disruptions.flatMap((d) =>
          d.workshopDays > 0 && d.vehicleId
            ? [{ vehicleId: d.vehicleId, lineId: p.line.id, days: d.workshopDays }]
            : [],
        ),
  )

  const observed: ReadonlyMap<string, ServiceObservation> = observations
  return {
    lines,
    prepared,
    options,
    holds,
    breakdowns,
    satisfaction: updateSatisfaction(state.satisfaction, observed),
    crowding,
  }
}

/** Nur die Bahnlinien eines Tages, mit Zugläufen und Konflikten. */
export function railResults(day: DaySimulation): RailDayResult[] {
  return day.lines.filter((l): l is RailDayResult => 'runs' in l)
}

/**
 * Der Betriebstag einer einzelnen Bahnlinie — für den Bildfahrplan.
 *
 * Gerechnet wird trotzdem das ganze Netz, und das ist kein Versehen: seit es
 * Reiseketten gibt, hängen die Fahrgastzahlen einer Linie von allen anderen ab.
 * Eine Linie für sich zu rechnen ergäbe eine Zahl, die im Spiel nirgends
 * vorkommt.
 */
export function simulateRailLine(state: GameState, demand: DemandMatrix, lineId: LineId): RailDayResult | null {
  const line = state.lines.get(lineId)
  if (!line || line.mode !== 'rail') return null
  return railResults(simulateDay(state, demand)).find((r) => r.lineId === lineId) ?? null
}
