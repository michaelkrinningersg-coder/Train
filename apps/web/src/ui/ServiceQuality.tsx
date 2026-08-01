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
  const missed = result.missedConnections ?? 0
  const held = result.holdDelaySec ?? 0
  const stranded = result.strandedTransfers ?? 0

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
      {missed >= 1 && (
        <div title="Fahrgäste, deren Zubringer zu spät kam und die deshalb erst die nächste Fahrt dieser Linie bekommen haben.">
          <dt>Anschluss verpasst</dt>
          <dd className="num neg">{Math.round(missed).toLocaleString('de-DE')}</dd>
        </div>
      )}
      {stranded >= 1 && (
        <div title="Umsteiger, die diese Linie nicht mehr mitnehmen konnte. Sie sind bereits mit dem Zubringer angereist und kommen an ihrem Ziel gar nicht mehr an.">
          <dt>gestrandete Umsteiger</dt>
          <dd className="num neg">{Math.round(stranded).toLocaleString('de-DE')}</dd>
        </div>
      )}
      {held > 0 && (
        <div title="Verspätung, die allein daraus entsteht, dass diese Linie auf Zubringer gewartet hat.">
          <dt>davon Anschlusswarten</dt>
          <dd className="num">{(held / 60).toFixed(1)} min</dd>
        </div>
      )}
    </>
  )
}

/** Hinweis unter den Kennzahlen, wenn die Zufriedenheit erkennbar leidet. */
export function QualityNote({ result }: { readonly result: LineDayResult }): React.JSX.Element | null {
  const satisfaction = result.satisfaction ?? 1
  const missed = result.missedConnections ?? 0
  const missedShare = result.totalPassengers > 0 ? missed / result.totalPassengers : 0
  const stranded = result.strandedTransfers ?? 0

  return (
    <>
      {satisfaction < 0.9 && <p className="warn small">⚠ {satisfactionHint(satisfaction)}</p>}
      {missedShare > 0.03 && (
        <p className="warn small">
          ⚠ {Math.round(missedShare * 100)} % der Fahrgäste erreichen ihren Anschluss an diese Linie nicht. Entweder
          mehr Puffer legen oder die Linie warten lassen.
        </p>
      )}
      {stranded >= 1 && (
        <p className="warn small">
          ⚠ {Math.round(stranded).toLocaleString('de-DE')} Umsteiger bekommen hier keinen Platz mehr. Sie sind mit dem
          Zubringer schon unterwegs und stranden am Umsteigebahnhof — das trifft die Zufriedenheit härter als eine
          Fahrt, die gar nicht erst zustande kommt.
        </p>
      )}
    </>
  )
}
