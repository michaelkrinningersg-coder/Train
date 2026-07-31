import type { LineId } from '@game/domain'
import { patternOf, useGame } from '../game/store.js'

/**
 * Die Abfahrtsminute — der Hebel für Anschlüsse.
 *
 * Für sich genommen ändert sie nichts: eine Linie, die um :00 statt um :20
 * losfährt, hat dieselbe Fahrzeit, dieselben Kosten, dieselbe Kapazität. Erst
 * gegenüber einer zweiten Linie entscheidet sie darüber, ob ein Umstieg fünf
 * oder fünfzig Minuten kostet. Deshalb steht sie direkt über der Anschlussliste.
 *
 * Die Schritte sind fünf Minuten groß. Feiner wäre Scheingenauigkeit — die
 * Fahrzeiten des Spiels sind auf ganze Minuten gerundet, und niemand plant
 * einen Fahrplan auf die Sekunde.
 */

const STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const

export function DepartureOffset({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  if (!state) return null

  const pattern = patternOf(state, lineId)
  if (!pattern?.headway) return null

  const first = pattern.headway.firstDeparture
  const current = Math.floor((first % 3600) / 60)
  const headway = pattern.headway.everyMinutes

  const set = (minute: number): void => {
    const hour = Math.floor(first / 3600)
    dispatch({
      kind: 'set_pattern',
      pattern: { ...pattern, headway: { ...pattern.headway!, firstDeparture: hour * 3600 + minute * 60 } },
    })
  }

  // Bei kurzem Takt wiederholt sich die Lage schon vorher - alles darueber
  // waere dieselbe Phasenlage unter anderem Namen.
  const relevant = STEPS.filter((m) => m < Math.max(headway, 5))

  return (
    <div className="field">
      <span className="field__label">
        Abfahrtsminute <b className="num">:{String(current).padStart(2, '0')}</b>
      </span>
      <div className="segmented">
        {relevant.map((m) => (
          <button key={m} type="button" className={current % headway === m ? 'on' : ''} onClick={() => set(m)}>
            :{String(m).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  )
}
