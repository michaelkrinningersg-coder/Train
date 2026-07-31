import { CONNECTION_HOLD_CHOICES, type LineId } from '@game/domain'
import { useGame } from '../game/store.js'

/**
 * Anschlusssicherung: wie lange diese Linie auf verspätete Zubringer wartet.
 *
 * Der Regler steht neben der Abfahrtsminute, weil er dieselbe Frage aus der
 * anderen Richtung beantwortet. Die Abfahrtsminute legt fest, wie viel Puffer
 * ein Anschluss hat; die Wartebereitschaft, was passiert, wenn der Puffer nicht
 * reicht. Beides zusammen ergibt einen Fahrplan, eines allein nicht.
 *
 * Es gibt keine richtige Einstellung. „Nie" hält die eigene Linie pünktlich und
 * lässt Umsteiger stehen; zehn Minuten holen jeden ab und verspäten dafür alle
 * anderen an Bord. Welche der beiden Gruppen größer ist, hängt am Netz — und
 * genau das soll der Spieler abwägen.
 */

const label = (sec: number): string => (sec === 0 ? 'nie' : `${sec / 60}′`)

export function ConnectionHold({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  if (!state) return null

  const line = state.lines.get(lineId)
  if (!line) return null

  const current = line.connectionHoldSec
  const held = state.lastDay?.lines.find((l) => l.lineId === lineId)?.holdDelaySec ?? 0

  return (
    <div className="field">
      <span className="field__label">
        Auf Anschluss warten{' '}
        {held > 0 && <b className="num neg">gestern {(held / 60).toFixed(1)} min</b>}
      </span>
      <div className="segmented">
        {CONNECTION_HOLD_CHOICES.map((sec) => (
          <button
            key={sec}
            type="button"
            className={current === sec ? 'on' : ''}
            onClick={() => dispatch({ kind: 'set_connection_hold', lineId, seconds: sec })}
          >
            {label(sec)}
          </button>
        ))}
      </div>
      <p className="muted small">
        {current === 0
          ? 'Die Linie fährt immer nach Plan. Wer seinen Anschluss verpasst, wartet auf die nächste Fahrt.'
          : `Kommt ein Zubringer zu spät, wartet die Linie bis zu ${current / 60} Minuten — die Verspätung fahren dann alle an Bord mit.`}
      </p>
    </div>
  )
}
