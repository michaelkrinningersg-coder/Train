import { campaignStep, scenarioById, formatDate } from '@game/domain'
import { scenarioStatus } from '@game/sim'
import { useMemo } from 'react'
import { useGame } from '../game/store.js'

/**
 * Der Auftrag: was zu tun ist und wie weit es ist.
 *
 * Die Ziele werden bei jeder Anzeige neu aus dem Spielzustand abgelesen und
 * nirgends mitgeschrieben. Das ist nicht nur billiger, es ist die einzige
 * Fassung, die einen geladenen Spielstand richtig anzeigen kann — ein
 * mitgezählter Fortschritt müsste im Spielstand stehen und könnte von ihm
 * abweichen.
 */

const number = (value: number): string => Math.round(value).toLocaleString('de-DE')

export function MissionTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const restart = useGame((s) => s.restart)
  const focusCity = useGame((s) => s.focusCity)

  const scenario = state ? scenarioById(state.scenarioId) : undefined
  const status = useMemo(() => (state && scenario ? scenarioStatus(state, scenario) : null), [state, scenario])
  if (!state || !scenario || !status) return null

  const step = campaignStep(scenario.id)

  return (
    <div className="mission-tab">
      {step && (
        <p className="muted small">
          {step.campaign.title} · Auftrag {step.index + 1} von {step.campaign.steps.length}
        </p>
      )}
      <h2>{scenario.title}</h2>
      <p className="small">{scenario.briefing}</p>

      <h3>Ziele</h3>
      <ul className="goals">
        {status.goals.map((goal, i) => (
          <li key={i} className={goal.done ? 'goals__item goals__item--done' : 'goals__item'}>
            <span className="goals__mark">{goal.done ? '✓' : '○'}</span>
            <span className="goals__label">
              {goal.label}
              {goal.cities && (
                <span className="goals__jump">
                  {goal.cities.map((id) => (
                    <button key={id} type="button" className="linkish" onClick={() => focusCity(id)}>
                      {state.cities.get(id)?.name ?? '?'} zeigen
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span className="goals__value num">
              {goal.goal.kind === 'connect'
                ? goal.done
                  ? 'verbunden'
                  : 'offen'
                : goal.goal.kind === 'satisfaction' || goal.goal.kind === 'punctuality'
                  ? `${Math.round(goal.value * 100)} %`
                  : number(goal.value)}
            </span>
            <span className="goals__bar">
              <span style={{ width: `${goal.share * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>

      {status.daysLeft !== null && (
        <p className={`small ${status.daysLeft < 180 ? 'warn' : 'muted'}`}>
          {status.daysLeft > 0
            ? `Frist bis ${formatDate(scenario.deadlineDays)} — noch ${number(status.daysLeft)} Tage.`
            : `Die Frist ist abgelaufen (${formatDate(scenario.deadlineDays)}).`}
        </p>
      )}
      {status.daysLeft === null && <p className="muted small">Ohne Frist. Die Ziele sind Wegmarken.</p>}

      {scenario.hints && scenario.hints.length > 0 && (
        <>
          <h3>Wie man anfängt</h3>
          <ol className="hints">
            {scenario.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ol>
        </>
      )}

      <button type="button" className="danger" onClick={restart}>
        Auftrag abbrechen
      </button>
    </div>
  )
}

/** Abschlussmeldung, sobald der Auftrag entschieden ist. */
export function MissionOutcome(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const seen = useGame((s) => s.outcomeSeen)
  const dismiss = useGame((s) => s.dismissOutcome)
  const restart = useGame((s) => s.restart)
  const nextScenario = useGame((s) => s.nextScenario)

  const scenario = state ? scenarioById(state.scenarioId) : undefined
  const status = useMemo(() => (state && scenario ? scenarioStatus(state, scenario) : null), [state, scenario])
  if (!state || !scenario || !status || seen || status.outcome === 'running') return null

  const won = status.outcome === 'won'
  const step = campaignStep(scenario.id)
  const next = step ? scenarioById(step.campaign.steps[step.index + 1] ?? '') : undefined
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__box">
        <h2>{won ? 'Auftrag erfüllt' : 'Auftrag gescheitert'}</h2>
        <p className="muted small">{scenario.title}</p>
        <p>{status.reason}</p>
        <dl className="facts">
          <div>
            <dt>Fahrgäste gestern</dt>
            <dd className="num">{number(state.lastDay?.passengers ?? 0)}</dd>
          </div>
          <div>
            <dt>Kasse</dt>
            <dd className="num">{(state.cash / 100).toLocaleString('de-DE')} €</dd>
          </div>
          <div>
            <dt>Linien</dt>
            <dd className="num">{state.lines.size}</dd>
          </div>
          <div>
            <dt>Spielzeit</dt>
            <dd className="num">{formatDate(state.day)}</dd>
          </div>
        </dl>
        <div className="modal__actions">
          {won && next ? (
            <button type="button" className="primary" onClick={nextScenario}>
              Weiter: {next.title}
            </button>
          ) : (
            <button type="button" className="primary" onClick={restart}>
              Anderen Auftrag wählen
            </button>
          )}
          <button type="button" onClick={dismiss}>
            {won ? 'Weiterspielen' : 'Trotzdem weitermachen'}
          </button>
        </div>
        {won && next && (
          <p className="muted small">
            Netz, Fuhrpark und Kasse bleiben stehen
            {next.grant ? `, dazu ${(next.grant / 100).toLocaleString('de-DE')} € Zuschuss` : ''}.
          </p>
        )}
      </div>
    </div>
  )
}
