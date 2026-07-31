import type { LineId } from '@game/domain'
import { applyConnectionHolding, connectionQuality, lineConnections, prepareLines, type ConnectionLeg } from '@game/sim'
import { useMemo } from 'react'
import { useGame } from '../game/store.js'

/**
 * Anschlüsse einer Linie.
 *
 * Das ist der Ort, an dem aus dem Fahrplan eine Entscheidung wird. Die Zahlen
 * hier ändern sich, sobald der Spieler die Abfahrtsminute verschiebt oder die
 * Wartebereitschaft ändert — und weil sie unmittelbar daneben stehen, sieht er
 * den Zusammenhang, ohne ihn erklärt zu bekommen.
 *
 * Neben der Umsteigezeit steht das **Risiko**: der Anteil der Umsteiger, die den
 * Anschluss verpassen, weil der Zubringer zu spät kommt. Ohne diese Spalte sähen
 * ein Zwei-Minuten-Anschluss hinter einem unpünktlichen Zug und ein
 * Zwei-Minuten-Anschluss hinter einem pünktlichen gleich gut aus.
 */

const minutes = (leg: ConnectionLeg | null): string => (leg === null ? '–' : `${Math.round(leg.waitSec / 60)} min`)

const tone = (leg: ConnectionLeg | null): string => {
  if (leg === null) return 'muted'
  const quality = connectionQuality(leg.waitSec, leg.missShare)
  if (quality === 'risky') return 'neg'
  return quality === 'good' ? 'pos' : quality === 'poor' ? 'neg' : ''
}

/** Risiko nur zeigen, wo es eins gibt — sonst wäre die Spalte voller Nullen. */
const risk = (leg: ConnectionLeg | null): string => {
  if (leg === null || leg.missShare < 0.005) return ''
  return `${Math.round(leg.missShare * 100)} % verpasst`
}

export function Connections({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)

  // Die Angebote aller Linien zu rechnen ist der einzige Weg, Anschlüsse zu
  // kennen — ein Anschluss gehört keiner Linie allein. Die Anschlusssicherung
  // muss mit hinein, sonst zeigte die Tabelle Verspätungen ohne das Warten.
  const connections = useMemo(() => {
    if (!state) return []
    const raw = prepareLines(state).flatMap((p) => (p.kind === 'idle' ? [] : [p.offer]))
    return lineConnections(state, applyConnectionHolding(state, raw).offers, lineId)
  }, [state, lineId])

  if (!state || connections.length === 0) return null

  const legs = connections.flatMap((c) => [c.toOther, c.fromOther].filter((v): v is ConnectionLeg => v !== null))
  const worst = legs.length > 0 ? Math.max(...legs.map((l) => l.waitSec)) : 0
  const risky = legs.some((l) => l.missShare >= 0.15)

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
              <td className={`num ${tone(c.toOther)}`}>
                {minutes(c.toOther)}
                {risk(c.toOther) && <span className="hint">{risk(c.toOther)}</span>}
              </td>
              <td className={`num ${tone(c.fromOther)}`}>
                {minutes(c.fromOther)}
                {risk(c.fromOther) && <span className="hint">{risk(c.fromOther)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {risky
          ? 'Ein Anschluss, den ein Teil der Umsteiger nicht erreicht, ist keiner. Entweder mehr Puffer legen — Abfahrtsminute verschieben — oder die Linie warten lassen.'
          : worst > 20 * 60
            ? 'Ein Anschluss über 20 Minuten kostet Fahrgäste. Die Abfahrtsminute oben verschieben — die Zeiten hier ändern sich sofort mit.'
            : 'Kurze Anschlüsse machen Umsteigerelationen erst attraktiv. Bei gleichem Takt beider Linien lässt sich meist nur eine der beiden Richtungen gut treffen — das ist die Entscheidung.'}
      </p>
    </section>
  )
}
