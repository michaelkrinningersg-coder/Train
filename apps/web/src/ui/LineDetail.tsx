import { DAYS_ALL, DAYS_WEEKDAY, fareFor, type LineId, type VehicleId } from '@game/domain'
import { busClass } from '@game/domain'
import { formatMoney } from '@game/economy'
import { lineMetrics, vehiclesNeeded } from '@game/sim'
import { patternOf, useGame } from '../game/store.js'

const HEADWAYS = [15, 20, 30, 60, 120, 180] as const

const hhmm = (sec: number): string => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:00`

export function LineDetail({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const selectLine = useGame((s) => s.selectLine)
  if (!state) return null

  const line = state.lines.get(lineId)
  if (!line) return null

  const pattern = patternOf(state, lineId)
  const metrics = lineMetrics(state, line)
  const result = state.lastDay?.lines.find((l) => l.lineId === lineId)
  const assigned = new Set(pattern?.vehicleIds ?? [])

  const free = [...state.fleet.values()].filter(
    (v) => assigned.has(v.id) || ![...state.patterns.values()].some((p) => p.vehicleIds.includes(v.id)),
  )

  const setHeadway = (everyMinutes: number): void => {
    if (!pattern?.headway) return
    dispatch({ kind: 'set_pattern', pattern: { ...pattern, headway: { ...pattern.headway, everyMinutes } } })
  }

  const setWindow = (key: 'firstDeparture' | 'lastDeparture', hour: number): void => {
    if (!pattern?.headway) return
    dispatch({ kind: 'set_pattern', pattern: { ...pattern, headway: { ...pattern.headway, [key]: hour * 3600 } } })
  }

  const toggleVehicle = (id: VehicleId): void => {
    if (!pattern) return
    const next = assigned.has(id) ? [...assigned].filter((v) => v !== id) : [...assigned, id]
    dispatch({ kind: 'assign_vehicles', patternId: pattern.id, vehicleIds: next })
  }

  const needed = metrics && pattern?.headway ? vehiclesNeeded(pattern.headway.everyMinutes, metrics.roundTripSec) : 0
  const sampleKm = metrics?.lengthKm ?? 0

  return (
    <div className="detail">
      <button type="button" className="linkish" onClick={() => selectLine(null)}>
        ← Alle Linien
      </button>
      <h2>{line.name}</h2>

      {metrics && (
        <dl className="facts">
          <div>
            <dt>Länge</dt>
            <dd className="num">{metrics.lengthKm.toFixed(0)} km</dd>
          </div>
          <div>
            <dt>Fahrzeit je Richtung</dt>
            <dd className="num">{Math.round(metrics.oneWayTimeSec / 60)} min</dd>
          </div>
          <div>
            <dt>Umlaufzeit</dt>
            <dd className="num">{Math.round(metrics.roundTripSec / 60)} min</dd>
          </div>
        </dl>
      )}

      <h3>Fahrplan</h3>
      <div className="field">
        <span className="field__label">Takt</span>
        <div className="segmented">
          {HEADWAYS.map((h) => (
            <button
              key={h}
              type="button"
              className={pattern?.headway?.everyMinutes === h ? 'on' : ''}
              onClick={() => setHeadway(h)}
            >
              {h}′
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Betriebszeit</span>
        <div className="row">
          <select
            value={Math.floor((pattern?.headway?.firstDeparture ?? 0) / 3600)}
            onChange={(e) => setWindow('firstDeparture', Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 3).map((h) => (
              <option key={h} value={h}>
                {hhmm(h * 3600)}
              </option>
            ))}
          </select>
          <span className="muted">bis</span>
          <select
            value={Math.floor((pattern?.headway?.lastDeparture ?? 0) / 3600)}
            onChange={(e) => setWindow('lastDeparture', Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 14).map((h) => (
              <option key={h} value={h}>
                {hhmm(h * 3600)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <span className="field__label">Verkehrstage</span>
        <div className="segmented">
          <button
            type="button"
            className={pattern?.days === DAYS_ALL ? 'on' : ''}
            onClick={() => pattern && dispatch({ kind: 'set_pattern', pattern: { ...pattern, days: DAYS_ALL } })}
          >
            täglich
          </button>
          <button
            type="button"
            className={pattern?.days === DAYS_WEEKDAY ? 'on' : ''}
            onClick={() => pattern && dispatch({ kind: 'set_pattern', pattern: { ...pattern, days: DAYS_WEEKDAY } })}
          >
            Mo–Fr
          </button>
        </div>
      </div>

      <h3>Tarif</h3>
      <div className="field">
        <span className="field__label">
          Grundpreis <b className="num">{(line.fare.baseFare / 100).toFixed(2)} €</b>
        </span>
        <input
          type="range"
          min={0}
          max={600}
          step={25}
          value={line.fare.baseFare}
          onChange={(e) =>
            dispatch({ kind: 'set_fare', lineId, fare: { ...line.fare, baseFare: Number(e.target.value) } })
          }
        />
      </div>
      <div className="field">
        <span className="field__label">
          Preis je km <b className="num">{(line.fare.perKm.second / 100).toFixed(2)} €</b>
        </span>
        <input
          type="range"
          min={3}
          max={40}
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
      <p className="muted small">
        Fahrpreis über die ganze Linie ({sampleKm.toFixed(0)} km):{' '}
        <b className="num">{formatMoney(fareFor(line.fare, sampleKm, 'second'))}</b>
      </p>

      <h3>
        Fahrzeuge <span className="muted">{assigned.size} zugeteilt</span>
      </h3>
      {needed > 0 && (
        <p className="muted small">
          Für den gewählten Takt werden <b className="num">{needed}</b> Fahrzeuge gebraucht.
        </p>
      )}
      {free.length === 0 ? (
        <p className="muted small">Keine freien Fahrzeuge. Im Reiter „Fuhrpark“ kaufen.</p>
      ) : (
        <ul className="picklist">
          {free.map((v) => {
            const cls = busClass(v.classId)
            return (
              <li key={v.id}>
                <label>
                  <input type="checkbox" checked={assigned.has(v.id)} onChange={() => toggleVehicle(v.id)} />
                  <span>{cls?.displayName ?? v.classId}</span>
                  <span className="muted num">{cls?.seats ?? 0} Sitze</span>
                  <span className="muted num">{Math.round(v.condition * 100)} %</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

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
              <dt>Erlös</dt>
              <dd className="num">{formatMoney(result.revenue)}</dd>
            </div>
            <div>
              <dt>Betriebskosten</dt>
              <dd className="num">{formatMoney(result.operatingCost)}</dd>
            </div>
            <div>
              <dt>Spitzenauslastung</dt>
              <dd className={`num ${result.peakLoadFactor > 1 ? 'neg' : ''}`}>
                {Math.round(result.peakLoadFactor * 100)} %
              </dd>
            </div>
            <div>
              <dt>Abfahrten je Richtung</dt>
              <dd className="num">{result.departuresPerDirection}</dd>
            </div>
          </dl>
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
