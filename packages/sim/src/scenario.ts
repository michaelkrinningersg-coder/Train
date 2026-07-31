import { formatDate, type CityId, type GameState, type Goal, type LineDayResult, type Scenario } from '@game/domain'

/**
 * Auswertung eines Auftrags.
 *
 * Jedes Ziel ist eine **Frage an den Spielzustand**, keine mitgeschriebene
 * Zählung. Das ist die eine Entscheidung, die hier wirklich zählt: nichts wird
 * nebenher gebucht, also kann auch nichts auseinanderlaufen. Ein Spielstand
 * trägt seinen Fortschritt von selbst, und ein geladener Stand steht genau da,
 * wo er stand — ohne dass der Spielstand ein einziges Feld mehr enthielte.
 *
 * Der Preis dafür ist, dass sich Ziele nur auf Zustände beziehen können und
 * nicht auf Ereignisse. „Fahre einmal 10 000 Fahrgäste an einem Tag" lässt sich
 * so nicht stellen, „fahre heute 10 000" schon. Für ein Spiel, in dem man einen
 * Betrieb aufbaut und nicht eine Folge von Kunststücken vorführt, ist das die
 * richtige Seite des Handels.
 */

export type ScenarioOutcome = 'running' | 'won' | 'lost'

export interface GoalProgress {
  readonly goal: Goal
  /** Was zu tun ist, in einem Satzteil. */
  readonly label: string
  /** Städte, um die es geht — damit die Anzeige dorthin springen kann. */
  readonly cities?: readonly CityId[]
  readonly value: number
  readonly target: number
  readonly done: boolean
  /** Anteil 0..1 für den Balken. */
  readonly share: number
}

export interface ScenarioStatus {
  readonly goals: readonly GoalProgress[]
  readonly outcome: ScenarioOutcome
  /** Verbleibende Tage, null bei einem Auftrag ohne Frist. */
  readonly daysLeft: number | null
  /** Warum gewonnen oder verloren — für die Abschlussmeldung. */
  readonly reason: string | null
}

/**
 * Ab diesem Kontostand ist der Betrieb zahlungsunfähig.
 *
 * Nicht bei null: ein Konto darf ins Minus rutschen, das kostet
 * Überziehungszinsen und ist eine Entscheidung. Erst wenn die Zinsen selbst
 * nicht mehr zu tragen sind, ist es keine mehr.
 */
export const INSOLVENCY_CASH = -5_000_000_00

/**
 * Städte, die von einer Stadt aus mit höchstens `maxTransfers` Umstiegen
 * erreichbar sind.
 *
 * Bewusst **nicht** über die Reisekettensuche aus `itineraries.ts`: die fragt,
 * ob eine Verbindung *attraktiv* ist, und verwirft Wege, die zu lang oder zu
 * teuer sind. Für ein Ziel ist die Frage eine andere und eine einfachere —
 * kommt man an. Ein Ziel, das sich still ändert, weil ein Umweg im Nutzenmodell
 * knapp durchfällt, wäre für den Spieler nicht nachvollziehbar.
 */
export function reachableCities(state: GameState, from: CityId, maxTransfers: number): Set<CityId> {
  // Städte je Linie und Linien je Stadt - beides einmal aufgebaut.
  const citiesOfLine = new Map<string, CityId[]>()
  const linesOfCity = new Map<CityId, string[]>()

  for (const line of state.lines.values()) {
    const cities: CityId[] = []
    for (const stop of line.stops) {
      const station = state.network.stations.get(stop.stationId)
      if (!station || cities.includes(station.cityId)) continue
      cities.push(station.cityId)
      const list = linesOfCity.get(station.cityId)
      if (list) list.push(line.id)
      else linesOfCity.set(station.cityId, [line.id])
    }
    if (cities.length >= 2) citiesOfLine.set(line.id, cities)
  }

  const reached = new Set<CityId>([from])
  let frontier: CityId[] = [from]
  const usedLines = new Set<string>()

  for (let round = 0; round <= maxTransfers && frontier.length > 0; round++) {
    const next: CityId[] = []
    for (const city of frontier) {
      for (const lineId of linesOfCity.get(city) ?? []) {
        if (usedLines.has(lineId)) continue
        usedLines.add(lineId)
        for (const target of citiesOfLine.get(lineId) ?? []) {
          if (reached.has(target)) continue
          reached.add(target)
          next.push(target)
        }
      }
    }
    frontier = next
  }

  return reached
}

const cityByName = (state: GameState, name: string): CityId | undefined => {
  for (const city of state.cities.values()) if (city.name === name) return city.id
  return undefined
}

/**
 * Mittelwert einer Güte des letzten Betriebstags, nach Fahrgästen gewichtet.
 *
 * **Null, solange nichts fährt** — und das ist der eigentliche Inhalt dieser
 * Funktion. Der naheliegende Rückgabewert wäre 1: ohne Fahrgäste ist niemand
 * unzufrieden und kein Zug verspätet. Im Auftrag las sich das als „85 %
 * Zufriedenheit ✓ 100 %", bevor der Spieler die erste Haltestelle gebaut hatte
 * — ein Ziel, das zu Beginn erfüllt ist und später wieder aufgeht, ist
 * schlimmer als gar keins.
 *
 * Ein Betrieb ohne Fahrgäste erfüllt kein Qualitätsziel. Er hat schlicht keine
 * Qualität.
 */
function meanQuality(state: GameState, pick: (line: LineDayResult) => number | undefined): number {
  const lines = state.lastDay?.lines ?? []
  let weighted = 0
  let riders = 0
  for (const line of lines) {
    if (line.totalPassengers <= 0) continue
    weighted += (pick(line) ?? 1) * line.totalPassengers
    riders += line.totalPassengers
  }
  return riders > 0 ? weighted / riders : 0
}

function progressOf(state: GameState, goal: Goal): GoalProgress {
  const day = state.lastDay
  const make = (label: string, value: number, target: number, cities?: readonly CityId[]): GoalProgress => ({
    goal,
    label,
    ...(cities && cities.length > 0 ? { cities } : {}),
    value,
    target,
    done: value >= target,
    share: target > 0 ? Math.min(1, Math.max(0, value / target)) : value > 0 ? 1 : 0,
  })

  switch (goal.kind) {
    case 'daily_passengers':
      return make(`${goal.count.toLocaleString('de-DE')} Fahrgäste am Tag`, day?.passengers ?? 0, goal.count)

    case 'daily_profit':
      return make(`${(goal.amount / 100).toLocaleString('de-DE')} € Tagesgewinn`, day?.profit ?? 0, goal.amount)

    case 'cash':
      return make(`${(goal.amount / 100).toLocaleString('de-DE')} € auf dem Konto`, state.cash, goal.amount)

    case 'lines': {
      const matching = [...state.lines.values()].filter((l) => !goal.mode || l.mode === goal.mode)
      const what = goal.mode === 'rail' ? 'Bahnlinien' : goal.mode === 'bus' ? 'Buslinien' : 'Linien'
      return make(`${goal.count} ${what}`, matching.length, goal.count)
    }

    case 'stations':
      return make(`${goal.count} Haltestellen`, state.network.stations.size, goal.count)

    case 'connect': {
      const from = cityByName(state, goal.from)
      const to = cityByName(state, goal.to)
      const transfers = goal.maxTransfers ?? 1
      const label =
        `${goal.from} – ${goal.to} verbinden` +
        (transfers === 0 ? ' (ohne Umstieg)' : ` (höchstens ${transfers}× umsteigen)`)
      if (!from || !to) return make(label, 0, 1)
      return make(label, reachableCities(state, from, transfers).has(to) ? 1 : 0, 1, [from, to])
    }

    case 'satisfaction':
      return make(
        `${Math.round(goal.value * 100)} % Zufriedenheit`,
        meanQuality(state, (l) => l.satisfaction),
        goal.value,
      )

    case 'punctuality':
      return make(
        `${Math.round(goal.value * 100)} % Pünktlichkeit`,
        meanQuality(state, (l) => l.punctuality),
        goal.value,
      )
  }
}

/**
 * Wo der Spieler steht.
 *
 * Gewonnen ist erst, wenn **alle** Ziele zugleich erfüllt sind — nicht, wenn
 * jedes einmal erfüllt war. Ein Netz, das die Fahrgastzahl nur erreicht, indem
 * es die Zufriedenheit ruiniert, hat den Auftrag nicht erfüllt, sondern nur
 * einen Teil davon nacheinander.
 */
export function scenarioStatus(state: GameState, scenario: Scenario): ScenarioStatus {
  const goals = scenario.goals.map((goal) => progressOf(state, goal))
  // Die Frist laeuft ab dem Beginn *dieses* Auftrags, nicht ab Spielbeginn -
  // im Feldzug faengt der zweite Auftrag mitten in der Spielzeit an.
  const ends = state.scenarioStartedOnDay + scenario.deadlineDays
  const daysLeft = scenario.deadlineDays > 0 ? ends - state.day : null
  const complete = goals.length > 0 && goals.every((g) => g.done)

  if (complete) {
    return {
      goals,
      outcome: 'won',
      daysLeft,
      reason:
        daysLeft === null
          ? 'Alle Wegmarken erreicht.'
          : `Auftrag erfüllt — mit ${Math.max(0, daysLeft)} Tagen Reserve.`,
    }
  }

  if (state.cash <= INSOLVENCY_CASH) {
    return {
      goals,
      outcome: 'lost',
      daysLeft,
      reason: `Zahlungsunfähig: ${(state.cash / 100).toLocaleString('de-DE')} € am ${formatDate(state.day)}.`,
    }
  }

  if (daysLeft !== null && daysLeft <= 0) {
    const open = goals.filter((g) => !g.done).length
    return {
      goals,
      outcome: 'lost',
      daysLeft,
      reason: `Die Frist ist am ${formatDate(ends)} abgelaufen — ${open} von ${goals.length} Zielen offen.`,
    }
  }

  return { goals, outcome: 'running', daysLeft, reason: null }
}
