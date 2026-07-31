import { availableBuses, availableTrains, busClass, toDate, trainClass } from '@game/domain'
import { useState } from 'react'
import { formatMoney, resaleValue } from '@game/economy'
import { useGame } from '../game/store.js'

export function FleetTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const selectLine = useGame((s) => s.selectLine)
  const [mode, setMode] = useState<'bus' | 'rail'>('bus')
  if (!state) return null

  const year = toDate(state.day).year
  const buses = availableBuses(year)
  const trains = availableTrains(year)
  const vehicles = [...state.fleet.values()]

  const assignmentOf = (vehicleId: string) => {
    const pattern = [...state.patterns.values()].find((p) => p.vehicleIds.includes(vehicleId as never))
    return pattern ? state.lines.get(pattern.lineId) : undefined
  }

  return (
    <div className="detail">
      <h2>Fuhrpark</h2>

      <div className="segmented">
        <button type="button" className={mode === 'bus' ? 'on' : ''} onClick={() => setMode('bus')}>
          Busse
        </button>
        <button type="button" className={mode === 'rail' ? 'on' : ''} onClick={() => setMode('rail')}>
          Züge
        </button>
      </div>

      <h3>Kaufen</h3>
      {mode === 'rail' && (
        <ul className="catalogue">
          {trains.map((t) => (
            <li key={t.id}>
              <div className="catalogue__head">
                <b>{t.displayName}</b>
                <span className="num">{formatMoney(t.purchasePrice, { compact: true })}</span>
              </div>
              <div className="catalogue__specs muted num">
                {t.seats.first + t.seats.second} Sitze · {t.topSpeedKmh} km/h ·{' '}
                {t.traction === 'electric' ? 'elektrisch' : t.traction === 'diesel' ? 'Diesel' : 'Zweikraft'} · ab{' '}
                {t.availableFrom}
              </div>
              <div className="catalogue__specs muted num">
                {formatMoney(t.upkeepPerDay)}/Tag · {(t.energyCostPerKm / 100).toFixed(2)} €/km ·{' '}
                {(t.crewCostPerHour / 100).toFixed(0)} €/h Personal · Komfort {Math.round(t.comfort * 100)} %
              </div>
              <div className="row">
                <button
                  type="button"
                  disabled={state.cash < t.purchasePrice}
                  onClick={() => dispatch({ kind: 'buy_vehicle', classId: t.id, units: 1 })}
                >
                  1 kaufen
                </button>
                <button
                  type="button"
                  disabled={state.cash < t.purchasePrice * 2}
                  onClick={() => dispatch({ kind: 'buy_vehicle', classId: t.id, units: 2 })}
                >
                  2 kaufen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mode === 'bus' && (
      <ul className="catalogue">
        {buses.map((bus) => (
          <li key={bus.id}>
            <div className="catalogue__head">
              <b>{bus.displayName}</b>
              <span className="num">{formatMoney(bus.purchasePrice, { compact: true })}</span>
            </div>
            <div className="catalogue__specs muted num">
              {bus.seats} Sitze · {bus.topSpeedKmh} km/h · Komfort {Math.round(bus.comfort * 100)} %
            </div>
            <div className="catalogue__specs muted num">
              {formatMoney(bus.upkeepPerDay)}/Tag · {(bus.fuelCostPerKm / 100).toFixed(2)} €/km ·{' '}
              {(bus.crewCostPerHour / 100).toFixed(0)} €/h Personal
            </div>
            <div className="row">
              <button
                type="button"
                disabled={state.cash < bus.purchasePrice}
                onClick={() => dispatch({ kind: 'buy_vehicle', classId: bus.id, units: 1 })}
              >
                1 kaufen
              </button>
              <button
                type="button"
                disabled={state.cash < bus.purchasePrice * 4}
                onClick={() => dispatch({ kind: 'buy_vehicle', classId: bus.id, units: 4 })}
              >
                4 kaufen
              </button>
            </div>
          </li>
        ))}
      </ul>
      )}

      <h3>
        Bestand <span className="muted num">{vehicles.length}</span>
      </h3>
      {vehicles.length === 0 ? (
        <p className="muted small">Noch keine Fahrzeuge.</p>
      ) : (
        <table className="fleet">
          <thead>
            <tr>
              <th>Typ</th>
              <th>Zustand</th>
              <th>Linie</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => {
              const cls = v.mode === 'rail' ? trainClass(v.classId) : busClass(v.classId)
              const line = assignmentOf(v.id)
              return (
                <tr key={v.id}>
                  <td>{cls?.displayName ?? v.classId}</td>
                  <td className="num">{Math.round(v.condition * 100)} %</td>
                  <td>
                    {line ? (
                      <button type="button" className="linkish" onClick={() => selectLine(line.id)}>
                        {line.name}
                      </button>
                    ) : (
                      <span className="muted">frei</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      disabled={Boolean(line)}
                      title={
                        line
                          ? 'Erst von der Linie abziehen'
                          : `Verkaufen für ${formatMoney(cls ? resaleValue(v, cls.purchasePrice) : 0)}`
                      }
                      onClick={() => dispatch({ kind: 'sell_vehicle', vehicleId: v.id })}
                    >
                      verkaufen
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
