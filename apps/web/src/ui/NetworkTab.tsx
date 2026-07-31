import { formatMoney } from '@game/economy'
import { useState } from 'react'
import { useGame } from '../game/store.js'
import { LineDetail } from './LineDetail.js'

/** Farbe, Zahl und Wort stehen hier zusammen - deshalb darf Farbe hier Status tragen. */
function Margin({ value }: { readonly value: number }): React.JSX.Element {
  const good = value >= 0
  return (
    <span className={`margin ${good ? 'pos' : 'neg'}`}>
      {good ? '▲' : '▼'} {formatMoney(value)}
    </span>
  )
}

export function NetworkTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const selectedLineId = useGame((s) => s.selectedLineId)
  const selectLine = useGame((s) => s.selectLine)
  const mapMode = useGame((s) => s.mapMode)
  const draft = useGame((s) => s.draft)
  const beginLine = useGame((s) => s.beginLine)
  const cancelLine = useGame((s) => s.cancelLine)
  const commitLine = useGame((s) => s.commitLine)
  const [name, setName] = useState('')

  if (!state) return null
  if (selectedLineId) return <LineDetail lineId={selectedLineId} />

  const lines = [...state.lines.values()]
  const draftNames = draft
    .map((id) => state.network.stations.get(id)?.name)
    .filter((n): n is string => Boolean(n))

  if (mapMode === 'draw-line') {
    return (
      <div className="detail">
        <h2>Neue Linie</h2>
        <p className="muted small">
          Haltestellen auf der Karte in der gewünschten Reihenfolge anklicken. Nur Städte mit Haltestelle sind wählbar.
        </p>
        <ol className="draftlist">
          {draftNames.length === 0 && <li className="muted">Noch nichts gewählt</li>}
          {draftNames.map((n, i) => (
            <li key={`${n}-${i}`}>{n}</li>
          ))}
        </ol>
        <div className="field">
          <span className="field__label">Name</span>
          <input
            type="text"
            value={name}
            placeholder={draftNames.join(' – ') || 'Linienname'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={draft.length < 2}
            onClick={() => {
              commitLine(name.trim() || draftNames.join(' – '))
              setName('')
            }}
          >
            Linie anlegen
          </button>
          <button type="button" onClick={cancelLine}>
            Abbrechen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="detail">
      <div className="detail__head">
        <h2>Liniennetz</h2>
        <button type="button" className="primary" onClick={beginLine}>
          Neue Linie
        </button>
      </div>

      <p className="muted small">
        {state.network.stations.size} Haltestellen · {lines.length} Linien
      </p>

      {lines.length === 0 ? (
        <p className="muted small">
          Noch keine Linie. Zuerst in zwei Städten eine Haltestelle bauen (Stadt auf der Karte anklicken), dann hier
          „Neue Linie“.
        </p>
      ) : (
        <ul className="linelist">
          {lines.map((line) => {
            const r = state.lastDay?.lines.find((l) => l.lineId === line.id)
            const margin = r ? r.revenue - r.operatingCost : 0
            return (
              <li key={line.id}>
                <button type="button" onClick={() => selectLine(line.id)}>
                  <span className="linelist__name">{line.name}</span>
                  {r ? (
                    <>
                      <span className="muted num">{Math.round(r.totalPassengers).toLocaleString('de-DE')} Fg.</span>
                      <Margin value={margin} />
                      {r.warnings.length > 0 && <span className="badge" title={r.warnings.join(' | ')}>⚠</span>}
                    </>
                  ) : (
                    <span className="muted">noch kein Betriebstag</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
