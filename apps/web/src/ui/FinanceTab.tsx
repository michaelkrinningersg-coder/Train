import type { LedgerEntry } from '@game/domain'
import { creditLimit, formatMoney, totalDebt } from '@game/economy'
import { fleetValue } from '@game/sim'
import { useState } from 'react'
import { useGame } from '../game/store.js'
import { THEME } from '../theme.js'

const CATEGORY_LABEL: Record<string, string> = {
  ticket_revenue: 'Fahrgelderlöse',
  energy: 'Kraftstoff und Fahrpersonal',
  crew: 'Verwaltung und Vertrieb',
  vehicle_upkeep: 'Fahrzeugunterhalt',
  station_upkeep: 'Haltestellenunterhalt',
  stop_construction: 'Haltestellenbau',
  vehicle_purchase: 'Fahrzeugkauf',
  interest: 'Zinsen',
  loan: 'Kreditaufnahme',
  repayment: 'Tilgung',
  construction: 'Bau',
  track_upkeep: 'Streckenunterhalt',
}

/**
 * Tagesgewinn als Verlaufslinie. Eine Serie, also ohne Legende - die Ueberschrift
 * benennt sie. Grundlinie bei null, damit Verluste als solche lesbar sind.
 */
function ProfitSparkline({ values }: { readonly values: readonly number[] }): React.JSX.Element {
  const width = 300
  const height = 64
  if (values.length < 2) return <p className="muted small">Noch zu wenige Betriebstage.</p>

  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const x = (i: number): number => (i / (values.length - 1)) * width
  const y = (v: number): number => height - ((v - min) / span) * height
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tagesgewinn im Verlauf">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={THEME.border} strokeWidth={1} />
      <path d={path} fill="none" stroke={THEME.city} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function FinanceTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const [loanAmount, setLoanAmount] = useState(500_000_00)
  const [term, setTerm] = useState(10)
  if (!state) return null

  const window = 30
  const from = state.day - window
  const recent = state.ledger.filter((e: LedgerEntry) => e.day >= from)

  const byCategory = new Map<string, number>()
  for (const e of recent) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)

  // Betrieb und Investition getrennt ausweisen. Ein Bus, den man einmal kauft,
  // gehoert nicht ins Betriebsergebnis - sonst sieht jede Expansion wie ein
  // Zusammenbruch aus.
  const OPERATING = new Set([
    'ticket_revenue',
    'energy',
    'crew',
    'vehicle_upkeep',
    'station_upkeep',
    'track_upkeep',
    'interest',
  ])
  const CAPEX = new Set(['stop_construction', 'vehicle_purchase', 'construction'])

  const operating = [...byCategory.entries()].filter(([c]) => OPERATING.has(c)).sort((a, b) => b[1] - a[1])
  const capex = [...byCategory.entries()].filter(([c]) => CAPEX.has(c)).sort((a, b) => b[1] - a[1])
  const operatingResult = operating.reduce((s, r) => s + r[1], 0)

  const debt = totalDebt(state.loans)
  const equity = state.cash + fleetValue(state)
  const limit = creditLimit(equity, debt)
  const profits = state.history.map((d) => d.profit)

  return (
    <div className="detail">
      <h2>Finanzen</h2>

      <dl className="facts">
        <div>
          <dt>Kasse</dt>
          <dd className={`num ${state.cash < 0 ? 'neg' : ''}`}>{formatMoney(state.cash)}</dd>
        </div>
        <div>
          <dt>Fuhrparkwert</dt>
          <dd className="num">{formatMoney(fleetValue(state))}</dd>
        </div>
        <div>
          <dt>Verbindlichkeiten</dt>
          <dd className="num">{formatMoney(debt)}</dd>
        </div>
      </dl>

      <h3>Tagesgewinn</h3>
      <ProfitSparkline values={profits} />

      <h3>Betrieb, letzte {window} Tage</h3>
      {operating.length === 0 ? (
        <p className="muted small">Noch keine Buchungen.</p>
      ) : (
        <table className="ledger">
          <tbody>
            {operating.map(([category, amount]) => (
              <tr key={category}>
                <th scope="row">{CATEGORY_LABEL[category] ?? category}</th>
                <td className={`num ${amount >= 0 ? 'pos' : 'neg'}`}>{formatMoney(amount)}</td>
              </tr>
            ))}
            <tr className="ledger__total">
              <th scope="row">Betriebsergebnis</th>
              <td className={`num ${operatingResult >= 0 ? 'pos' : 'neg'}`}>{formatMoney(operatingResult)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {capex.length > 0 && (
        <>
          <h3>Investitionen</h3>
          <table className="ledger">
            <tbody>
              {capex.map(([category, amount]) => (
                <tr key={category}>
                  <th scope="row">{CATEGORY_LABEL[category] ?? category}</th>
                  <td className="num neg">{formatMoney(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Kredite</h3>
      {state.loans.length > 0 && (
        <ul className="loans">
          {state.loans.map((l) => (
            <li key={l.id}>
              <span className="num">{formatMoney(l.principal)}</span>
              <span className="muted num">{(l.interestRate * 100).toFixed(1)} %</span>
              <span className="muted num">
                fällig Tag {l.takenOnDay + l.termYears * 365 - state.day > 0
                  ? `in ${l.takenOnDay + l.termYears * 365 - state.day}`
                  : 'jetzt'}
              </span>
              <button
                type="button"
                className="linkish"
                disabled={state.cash < l.principal}
                onClick={() => dispatch({ kind: 'repay_loan', loanId: l.id, amount: l.principal })}
              >
                tilgen
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="field">
        <span className="field__label">
          Aufnehmen <b className="num">{formatMoney(loanAmount, { compact: true })}</b>{' '}
          <span className="muted">Rahmen {formatMoney(limit, { compact: true })}</span>
        </span>
        <input
          type="range"
          min={100_000_00}
          max={Math.max(100_000_00, limit)}
          step={100_000_00}
          value={Math.min(loanAmount, Math.max(100_000_00, limit))}
          onChange={(e) => setLoanAmount(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
          {[5, 10, 15, 20].map((t) => (
            <option key={t} value={t}>
              {t} Jahre
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={limit < 100_000_00}
          onClick={() => dispatch({ kind: 'take_loan', amount: Math.min(loanAmount, limit), termYears: term })}
        >
          Kredit aufnehmen
        </button>
      </div>
    </div>
  )
}
