import { availableBuses, busClass, toDate } from '@game/domain'
import { formatMoney, resaleValue } from '@game/economy'
import { useGame } from '../game/store.js'

export function FleetTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const selectLine = useGame((s) => s.selectLine)
  if (!state) return null

  const year = toDate(state.day).year
  const catalogue = availableBuses(year)
  const vehicles = [...state.fleet.values()]

  const assignmentOf = (vehicleId: string) => {
    const pattern = [...state.patterns.values()].find((p) => p.vehicleIds.includes(vehicleId as never))
    return pattern ? state.lines.get(pattern.lineId) : undefined
  }

  return (
    <div className="detail">
      <h2>Fuhrpark</h2>

      <h3>Kaufen</h3>
      <ul className="catalogue">
        {catalogue.map((bus) => (
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
              const cls = busClass(v.classId)
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
