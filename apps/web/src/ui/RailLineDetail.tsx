import { availableTrains, formatDate, toDate, trainClass, type LineId, type VehicleId } from '@game/domain'
import { formatMoney } from '@game/economy'
import { planLine, trainsNeeded } from '@game/sim'
import { patternOf, useGame } from '../game/store.js'
import { ConnectionHold } from './ConnectionHold.js'
import { Connections } from './Connections.js'
import { DepartureOffset } from './DepartureOffset.js'
import { QualityFacts, QualityNote } from './ServiceQuality.js'
import { VehicleSwap } from './VehicleSwap.js'

const HEADWAYS = [15, 20, 30, 60, 120] as const
const hhmm = (sec: number): string => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:00`

export function RailLineDetail({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const selectLine = useGame((s) => s.selectLine)
  const showTimetable = useGame((s) => s.showTimetable)
  const toggleTimetable = useGame((s) => s.toggleTimetable)
  if (!state) return null

  const line = state.lines.get(lineId)
  if (!line || line.mode !== 'rail') return null

  const pattern = patternOf(state, lineId)
  const plan = planLine(state, line)
  const result = state.lastDay?.lines.find((l) => l.lineId === lineId)
  const assigned = new Set(pattern?.vehicleIds ?? [])

  // Nur Zuege, und nur solche, die keiner anderen Linie zugeteilt sind.
  const freeTrains = [...state.fleet.values()].filter(
    (v) =>
      v.mode === 'rail' &&
      (assigned.has(v.id) || ![...state.patterns.values()].some((p) => p.vehicleIds.includes(v.id))),
  )

  const needed = pattern?.headway ? trainsNeeded(pattern.headway.everyMinutes, plan.roundTripSeconds) : 0
  const year = toDate(state.day).year
  const stopNames = line.stops.map((s) => state.network.stations.get(s.stationId)?.name ?? '?')

  const setHeadway = (everyMinutes: number): void => {
    if (!pattern?.headway) return
    dispatch({ kind: 'set_pattern', pattern: { ...pattern, headway: { ...pattern.headway, everyMinutes } } })
  }

  const toggleTrain = (id: VehicleId): void => {
    if (!pattern) return
    const next = assigned.has(id) ? [...assigned].filter((v) => v !== id) : [...assigned, id]
    dispatch({ kind: 'assign_vehicles', patternId: pattern.id, vehicleIds: next })
  }

  return (
    <div className="detail">
      <button type="button" className="linkish" onClick={() => selectLine(null)}>
        ← Alle Bahnlinien
      </button>
      <h2>{line.name}</h2>
      <p className="muted small">{stopNames.join(' – ')}</p>

      {plan.problems.map((p) => (
        <p key={p} className="warn small">
          ⚠ {p}
        </p>
      ))}

      {plan.legs.length > 0 && (
        <dl className="facts">
          <div>
            <dt>Streckenlänge</dt>
            <dd className="num">{plan.lengthKm.toFixed(1)} km</dd>
          </div>
          <div>
            <dt>Fahrzeit je Richtung</dt>
            <dd className="num">{Math.round(plan.oneWaySeconds / 60)} min</dd>
          </div>
          <div>
            <dt>Reisegeschwindigkeit</dt>
            <dd className="num">
              {plan.oneWaySeconds > 0 ? Math.round(plan.lengthKm / (plan.oneWaySeconds / 3600)) : 0} km/h
            </dd>
          </div>
          <div>
            <dt>Umlaufzeit</dt>
            <dd className="num">{Math.round(plan.roundTripSeconds / 60)} min</dd>
          </div>
        </dl>
      )}

      <button type="button" className={`primary wide${showTimetable ? ' on' : ''}`} onClick={toggleTimetable}>
        {showTimetable ? 'Bildfahrplan ausblenden' : 'Bildfahrplan öffnen'}
      </button>

      <h3>Takt</h3>
      <div className="segmented">
        {HEADWAYS.map((h) => (
          <button key={h} type="button" className={pattern?.headway?.everyMinutes === h ? 'on' : ''} onClick={() => setHeadway(h)}>
            {h}′
          </button>
        ))}
      </div>
      <DepartureOffset lineId={lineId} />
      {pattern?.headway && (
        <p className="muted small">
          Betrieb {hhmm(pattern.headway.firstDeparture)} bis {hhmm(pattern.headway.lastDeparture)} ·{' '}
          {needed > 0 && (
            <>
              für diesen Takt <b className="num">{needed}</b> Züge nötig
            </>
          )}
        </p>
      )}

      <h3>Tarif</h3>
      <div className="field">
        <span className="field__label">
          Preis je km <b className="num">{(line.fare.perKm.second / 100).toFixed(2)} €</b>
        </span>
        <input
          type="range"
          min={5}
          max={60}
          step={1}
          value={line.fare.perKm.second}
          onChange={(e) =>
            dispatch({
              kind: 'set_fare',
              lineId,
              fare: { ...line.fare, perKm: { ...line.fare.perKm, second: Number(e.target.value) } },
            })
          }
        />
      </div>

      <h3>
        Züge <span className="muted">{assigned.size} zugeteilt</span>
      </h3>
      {freeTrains.length === 0 ? (
        <p className="muted small">
          Keine freien Züge. Im Reiter „Fuhrpark“ kaufen — verfügbar sind {availableTrains(year).length} Baureihen.
        </p>
      ) : (
        <ul className="picklist">
          {freeTrains.map((v) => {
            const cls = trainClass(v.classId)
            const away = v.inWorkshopUntil !== undefined && state.day < v.inWorkshopUntil
            return (
              <li key={v.id}>
                <label>
                  <input type="checkbox" checked={assigned.has(v.id)} onChange={() => toggleTrain(v.id)} />
                  <span>{cls?.displayName ?? v.classId}</span>
                  <span className="muted num">{(cls?.seats.first ?? 0) + (cls?.seats.second ?? 0)} Sitze</span>
                  <span className={`num ${away ? 'neg' : 'muted'}`}>
                    {away
                      ? `${v.workshopReason === 'repair' ? 'Schaden' : 'HU'} bis ${formatDate(v.inWorkshopUntil)}`
                      : `${cls?.topSpeedKmh ?? 0} km/h`}
                  </span>
                </label>
                {assigned.has(v.id) && pattern && <VehicleSwap patternId={pattern.id} outgoing={v.id} />}
              </li>
            )
          })}
        </ul>
      )}

      <ConnectionHold lineId={lineId} />
      <Connections lineId={lineId} />

      <h3>Gestern</h3>
      {result ? (
        <>
          <dl className="facts">
            <div>
              <dt>Fahrgäste</dt>
              <dd className="num">{Math.round(result.totalPassengers).toLocaleString('de-DE')}</dd>
            </div>
            <div>
              <dt>Stehen geblieben</dt>
              <dd className="num">{Math.round(result.leftBehind).toLocaleString('de-DE')}</dd>
            </div>
            <div>
              <dt>Pünktlichkeit</dt>
              <dd className={`num ${(result.punctuality ?? 1) < 0.8 ? 'neg' : 'pos'}`}>
                {Math.round((result.punctuality ?? 1) * 100)} %
              </dd>
            </div>
            <div>
              <dt>Ø Verspätung</dt>
              <dd className="num">{((result.averageDelaySec ?? 0) / 60).toFixed(1)} min</dd>
            </div>
            <div title="Ausfälle und Zwischenfälle: Fahrzeugzustand, Streckenalter und Auslastung bestimmen, wie oft es trifft.">
              <dt>Störungen</dt>
              <dd className={`num ${(result.disruptionCount ?? 0) > 2 ? 'neg' : ''}`}>{result.disruptionCount ?? 0}</dd>
            </div>
            <div>
              <dt>Erlös</dt>
              <dd className="num">{formatMoney(result.revenue)}</dd>
            </div>
            <div>
              <dt>Betriebskosten</dt>
              <dd className="num">{formatMoney(result.operatingCost)}</dd>
            </div>
            <QualityFacts result={result} />
          </dl>
          <QualityNote result={result} />

          {result.linkLoadFactors && result.linkLoadFactors.length > 0 && (
            <>
              <h3>Auslastung je Abschnitt</h3>
              <table className="segments">
                <tbody>
                  {result.linkLoadFactors.map((factor, i) => (
                    <tr key={`${stopNames[i]}-${i}`}>
                      <th scope="row">
                        {stopNames[i]} → {stopNames[i + 1]}
                      </th>
                      <td className={`num ${factor > 1 ? 'neg' : ''}`}>{Math.round(factor * 100)} %</td>
                      <td className="bar">
                        <span
                          style={{
                            width: `${Math.min(100, factor * 100)}%`,
                            background: factor > 1 ? 'var(--critical)' : 'var(--city)',
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Ein Zug wird unterwegs geleert und neu gefüllt — ein Fahrgast belegt nur die Abschnitte, die er
                tatsächlich fährt. Überfüllt ist deshalb selten die ganze Linie, sondern ein Abschnitt.
              </p>
            </>
          )}

          {result.warnings.map((w) => (
            <p key={w} className="warn small">
              ⚠ {w}
            </p>
          ))}
        </>
      ) : (
        <p className="muted small">Noch kein Betriebstag simuliert.</p>
      )}

      <button
        type="button"
        className="danger"
        onClick={() => {
          dispatch({ kind: 'delete_line', lineId })
          selectLine(null)
        }}
      >
        Linie löschen
      </button>
    </div>
  )
}
