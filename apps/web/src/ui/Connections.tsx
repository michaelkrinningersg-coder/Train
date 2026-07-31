import type { LineId } from '@game/domain'
import { connectionQuality, lineConnections, prepareLines } from '@game/sim'
import { useMemo } from 'react'
import { useGame } from '../game/store.js'

/**
 * Anschlüsse einer Linie.
 *
 * Das ist der Ort, an dem aus dem Fahrplan eine Entscheidung wird. Die Zahlen
 * hier ändern sich, sobald der Spieler die Abfahrtsminute verschiebt — und weil
 * sie unmittelbar daneben steht, sieht er den Zusammenhang, ohne ihn erklärt zu
 * bekommen.
 */

const minutes = (sec: number | null): string => (sec === null ? '–' : `${Math.round(sec / 60)} min`)

const tone = (sec: number | null): string => {
  if (sec === null) return 'muted'
  const quality = connectionQuality(sec)
  return quality === 'good' ? 'pos' : quality === 'poor' ? 'neg' : ''
}

export function Connections({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)

  // Die Angebote aller Linien zu rechnen ist der einzige Weg, Anschlüsse zu
  // kennen — ein Anschluss gehört keiner Linie allein.
  const connections = useMemo(() => {
    if (!state) return []
    const offers = prepareLines(state).flatMap((p) => (p.kind === 'idle' ? [] : [p.offer]))
    return lineConnections(state, offers, lineId)
  }, [state, lineId])

  if (!state || connections.length === 0) return null

  const known = connections.flatMap((c) => [c.toOtherSec, c.fromOtherSec].filter((v): v is number => v !== null))
  const worst = known.length > 0 ? Math.max(...known) : 0

  return (
    <section>
      <h3>Anschlüsse</h3>
      <table className="segments">
        <thead>
          <tr>
            <th scope="col">Halt</th>
            <th scope="col">Linie</th>
            <th scope="col" title="Wer mit dieser Linie ankommt und auf die andere umsteigt">
              → dorthin
            </th>
            <th scope="col" title="Wer aus der anderen Linie kommt und hier einsteigt">
              → hierher
            </th>
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={`${c.stopIndex}-${c.otherLineId}`}>
              <th scope="row">{c.stationName}</th>
              <td className="muted">{c.otherLineName}</td>
              <td className={`num ${tone(c.toOtherSec)}`}>{minutes(c.toOtherSec)}</td>
              <td className={`num ${tone(c.fromOtherSec)}`}>{minutes(c.fromOtherSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {worst > 20 * 60
          ? 'Ein Anschluss über 20 Minuten kostet Fahrgäste. Die Abfahrtsminute oben verschieben — die Zeiten hier ändern sich sofort mit.'
          : 'Kurze Anschlüsse machen Umsteigerelationen erst attraktiv. Bei gleichem Takt beider Linien lässt sich meist nur eine der beiden Richtungen gut treffen — das ist die Entscheidung.'}
      </p>
    </section>
  )
}
