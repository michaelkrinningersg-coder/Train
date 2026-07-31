import { formatDate } from '@game/domain'
import { formatMoney } from '@game/economy'
import { SPEED_INTERVAL_MS, useGame, type Speed } from '../game/store.js'
import { BasemapPicker } from './BasemapPicker.js'
import { CitySearch } from './CitySearch.js'
import { MissionChip } from './MissionChip.js'

const SPEEDS: { readonly value: Speed; readonly label: string; readonly title: string }[] = [
  { value: 0, label: '❚❚', title: 'Pause' },
  { value: 1, label: '▶', title: 'Normal' },
  { value: 2, label: '▶▶', title: 'Schnell' },
]

export function TopBar(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const speed = useGame((s) => s.speed)
  const setSpeed = useGame((s) => s.setSpeed)
  const step = useGame((s) => s.step)
  const showDemand = useGame((s) => s.showDemand)
  const showLoad = useGame((s) => s.showLoad)
  const toggleLoad = useGame((s) => s.toggleLoad)
  const toggleDemand = useGame((s) => s.toggleDemand)
  const setShowSaves = useGame((s) => s.setShowSaves)
  if (!state) return null

  const profit = state.lastDay?.profit ?? 0
  const passengers = state.lastDay?.passengers ?? 0

  return (
    <header className="topbar">
      <span className="topbar__brand">Rail &amp; Road</span>
      <span className="topbar__date num">{formatDate(state.day)}</span>

      <span className={`topbar__stat${state.cash < 0 ? ' topbar__stat--bad' : ''}`}>
        <span className="topbar__label">Kasse</span>
        <b className="num">{formatMoney(state.cash, { compact: true })}</b>
      </span>

      <span className="topbar__stat">
        <span className="topbar__label">Gestern</span>
        <b className={`num ${profit >= 0 ? 'pos' : 'neg'}`}>
          {profit >= 0 ? '+' : ''}
          {formatMoney(profit)}
        </b>
      </span>

      <span className="topbar__stat">
        <span className="topbar__label">Fahrgäste</span>
        <b className="num">{Math.round(passengers).toLocaleString('de-DE')}</b>
      </span>

      <div className="topbar__spacer" />

      <CitySearch />

      <MissionChip />

      <BasemapPicker />

      <button type="button" className="chip" onClick={() => setShowSaves(true)} title="Speichern, laden, exportieren">
        Spielstand
      </button>

      <button
        type="button"
        className={`chip${showDemand ? ' chip--on' : ''}`}
        onClick={toggleDemand}
        title="Die stärksten Reiserelationen einblenden"
      >
        Nachfrage
      </button>

      <button
        type="button"
        className={`chip${showLoad ? ' chip--on' : ''}`}
        onClick={toggleLoad}
        title="Auslastung je Abschnitt aus dem letzten Betriebstag"
      >
        Auslastung
      </button>

      <div className="speed" role="group" aria-label="Geschwindigkeit">
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`speed__btn${speed === s.value ? ' speed__btn--on' : ''}`}
            onClick={() => setSpeed(s.value)}
            title={`${s.title}${s.value > 0 ? ` (1 Tag / ${SPEED_INTERVAL_MS[s.value]} ms)` : ''}`}
            aria-pressed={speed === s.value}
          >
            {s.label}
          </button>
        ))}
        <button type="button" className="speed__btn" onClick={() => step(1)} title="Einen Tag weiter">
          +1 Tag
        </button>
        <button type="button" className="speed__btn" onClick={() => step(7)} title="Eine Woche weiter">
          +7
        </button>
      </div>
    </header>
  )
}
