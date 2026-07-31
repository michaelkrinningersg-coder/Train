import { scenarioById } from '@game/domain'
import { scenarioStatus } from '@game/sim'
import { useMemo } from 'react'
import { useGame } from '../game/store.js'

/**
 * Auftragsstand in der Kopfzeile.
 *
 * Zwei Zahlen, mehr nicht: erfüllte Ziele und verbleibende Jahre. Wer mehr
 * wissen will, klickt — dann steht der Auftrag mit Fortschritt im Reiter
 * daneben. Ein ständig sichtbares Zielpanel würde die Karte verkleinern, und
 * die Karte ist die Bühne.
 */
export function MissionChip(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const setTab = useGame((s) => s.setTab)

  const scenario = state ? scenarioById(state.scenarioId) : undefined
  const status = useMemo(() => (state && scenario ? scenarioStatus(state, scenario) : null), [state, scenario])
  if (!state || !scenario || !status) return null

  const done = status.goals.filter((g) => g.done).length
  const years = status.daysLeft === null ? null : status.daysLeft / 365
  const tight = years !== null && years < 0.5

  return (
    <button
      type="button"
      className={`chip${status.outcome === 'won' ? ' chip--on' : ''}`}
      onClick={() => setTab('mission')}
      title={`${scenario.title} — ${scenario.summary}`}
    >
      Ziele{' '}
      <b className="num">
        {done}/{status.goals.length}
      </b>
      {years !== null && (
        <span className={tight ? 'neg' : 'muted'}>
          {' · '}
          {years > 0 ? `noch ${years < 1 ? `${Math.round(years * 12)} Monate` : `${Math.round(years)} Jahre`}` : 'Frist abgelaufen'}
        </span>
      )}
    </button>
  )
}
