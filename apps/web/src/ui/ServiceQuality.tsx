import type { LineDayResult } from '@game/domain'

/**
 * Die zwei Kennzahlen aus Phase 4, die sich Bus und Bahn teilen.
 *
 * Sie stehen bewusst neben Fahrgastzahl und Erlös und nicht in einem eigenen
 * Reiter: Zufriedenheit ist keine Statistik, die man gelegentlich nachschlägt,
 * sondern die Erklärung dafür, warum die Fahrgastzahl über Wochen sinkt,
 * obwohl sich am Fahrplan nichts geändert hat.
 */

export function satisfactionTone(value: number): string {
  if (value >= 0.9) return 'pos'
  if (value >= 0.7) return ''
  return 'neg'
}

export function satisfactionHint(value: number): string {
  if (value >= 0.95) return 'Die Fahrgäste sind zufrieden.'
  if (value >= 0.8) {
    return 'Einzelne bleiben stehen oder kommen zu spät an. Der Ruf leidet langsam — mehr Kapazität hilft.'
  }
  if (value >= 0.5) {
    return 'Deutlich zu wenig Kapazität. Die Fahrgäste weichen aufs Auto aus, und sie kommen nur langsam zurück.'
  }
  return 'Der Ruf der Linie ist ruiniert. Selbst nach einem Ausbau dauert es Monate, bis die Fahrgäste wieder da sind.'
}

export function QualityFacts({ result }: { readonly result: LineDayResult }): React.JSX.Element {
  const satisfaction = result.satisfaction ?? 1
  const transfers = result.transferPassengers ?? 0
  const transferShare = result.totalPassengers > 0 ? transfers / result.totalPassengers : 0

  return (
    <>
      <div title={satisfactionHint(satisfaction)}>
        <dt>Zufriedenheit</dt>
        <dd className={`num ${satisfactionTone(satisfaction)}`}>{Math.round(satisfaction * 100)} %</dd>
      </div>
      <div title="Fahrgäste, die auf dieser Linie nur ein Teilstück ihrer Reise zurücklegen und anschließend umsteigen.">
        <dt>davon Umsteiger</dt>
        <dd className="num">
          {Math.round(transfers).toLocaleString('de-DE')}
          {transferShare > 0.005 && <span className="muted"> · {Math.round(transferShare * 100)} %</span>}
        </dd>
      </div>
    </>
  )
}

/** Hinweis unter den Kennzahlen, wenn die Zufriedenheit erkennbar leidet. */
export function QualityNote({ result }: { readonly result: LineDayResult }): React.JSX.Element | null {
  const satisfaction = result.satisfaction ?? 1
  if (satisfaction >= 0.9) return null
  return <p className="warn small">⚠ {satisfactionHint(satisfaction)}</p>
}
