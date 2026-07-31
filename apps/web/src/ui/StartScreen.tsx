import { SCENARIOS, formatDate, type City, type Goal } from '@game/domain'
import { useGame } from '../game/store.js'

/**
 * Auftragsauswahl.
 *
 * Der Bildschirm, der bisher fehlte. Vorher landete man ohne ein Wort mitten in
 * Deutschland und durfte raten, was jetzt zu tun ist — die Mechanik war da, die
 * Frage, auf die sie antwortet, nicht.
 *
 * Die Aufträge stehen in der Reihenfolge, in der sie zu spielen sind, und der
 * erste ist ein Einstieg, der sich nicht so nennt: er stellt genau die vier
 * Handgriffe als Ziele, die man einmal gemacht haben muss. Ein Tutorial, das man
 * wegklicken kann, wäre entweder überflüssig oder ungelesen.
 */

const years = (days: number): string => {
  if (days <= 0) return 'ohne Frist'
  const y = days / 365
  return y >= 1 ? `${Math.round(y)} Jahre Zeit` : `${Math.round(days / 30)} Monate Zeit`
}

export function StartScreen({ cities }: { readonly cities: readonly City[] }): React.JSX.Element {
  const start = useGame((s) => s.start)

  return (
    <div className="start">
      <div className="start__inner">
        <header className="start__head">
          <h1>Rail &amp; Road</h1>
          <p className="muted">
            Ein Verkehrsbetrieb in Deutschland, ab {formatDate(0)}. {cities.length} Städte, echte
            Einwohnerzahlen, echtes Gelände.
          </p>
        </header>

        <div className="start__grid">
          {SCENARIOS.map((scenario) => (
            <button key={scenario.id} type="button" className="mission" onClick={() => start(cities, scenario.id)}>
              <h2>{scenario.title}</h2>
              <p className="mission__summary">{scenario.summary}</p>
              <p className="mission__brief muted small">{scenario.briefing}</p>
              <ul className="mission__goals">
                {scenario.goals.map((goal, i) => (
                  <li key={i}>{goalLabel(goal)}</li>
                ))}
              </ul>
              <footer className="mission__foot">
                <span>{(scenario.startingCash / 100).toLocaleString('de-DE')} € Startkapital</span>
                <span>{years(scenario.deadlineDays)}</span>
              </footer>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Kurzform eines Ziels für die Auswahlkarte.
 *
 * Bewusst eine eigene, knappere Fassung als die im Auftragspanel: dort steht der
 * Fortschritt daneben und die Zahl muss genau sein, hier zählt der Überblick.
 */
function goalLabel(goal: Goal): string {
  switch (goal.kind) {
    case 'daily_passengers':
      return `${goal.count.toLocaleString('de-DE')} Fahrgäste am Tag`
    case 'daily_profit':
      return `${(goal.amount / 100).toLocaleString('de-DE')} € Tagesgewinn`
    case 'cash':
      return `${(goal.amount / 100).toLocaleString('de-DE')} € auf dem Konto`
    case 'lines':
      return `${goal.count} ${goal.mode === 'rail' ? 'Bahnlinien' : goal.mode === 'bus' ? 'Buslinien' : 'Linien'}`
    case 'stations':
      return `${goal.count} Haltestellen`
    case 'connect':
      return `${goal.from} – ${goal.to} verbinden`
    case 'satisfaction':
      return `${Math.round(goal.value * 100)} % Zufriedenheit`
    case 'punctuality':
      return `${Math.round(goal.value * 100)} % Pünktlichkeit`
  }
}
