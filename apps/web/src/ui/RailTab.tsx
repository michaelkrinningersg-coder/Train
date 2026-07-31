import {
  MAX_SPEEDS,
  SIGNALLING_KINDS,
  TRACK_COUNTS,
  isUnderConstruction,
  trackUpkeepPerDay,
  type MaxSpeed,
  type Signalling,
  type TrackCount,
  type TrackId,
} from '@game/domain'
import { formatMoney, trackDemolitionValue, trackUpgradeCost, trackUpgradeDays } from '@game/economy'
import { previewTrack } from '@game/sim'
import { useGame } from '../game/store.js'

const SIGNALLING_LABEL: Record<Signalling, string> = {
  classic: 'klassisch',
  etcs_l1: 'ETCS L1',
  etcs_l2: 'ETCS L2',
}

export function RailTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const selectedTrackId = useGame((s) => s.selectedTrackId)
  const trackDraft = useGame((s) => s.trackDraft)
  if (!state) return null

  if (trackDraft) return <TrackDraftPanel />
  if (selectedTrackId) return <TrackDetail trackId={selectedTrackId} />
  return <TrackList />
}

function TrackList(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const beginTrack = useGame((s) => s.beginTrack)
  const selectTrack = useGame((s) => s.selectTrack)
  if (!state) return null

  const tracks = [...state.network.tracks.values()]
  const stations = [...state.network.stations.values()].filter((s) => s.mode !== 'bus')
  const totalKm = tracks.reduce((n, t) => n + t.lengthKm, 0)
  const upkeep = tracks.reduce((n, t) => n + trackUpkeepPerDay(t), 0)

  const nodeName = (nodeId: string): string =>
    stations.find((s) => s.nodeId === nodeId)?.name ?? 'Abzweig'

  return (
    <div className="detail">
      <div className="detail__head">
        <h2>Schienennetz</h2>
        <button type="button" className="primary" disabled={stations.length < 2} onClick={beginTrack}>
          Strecke bauen
        </button>
      </div>

      <dl className="facts">
        <div>
          <dt>Bahnhöfe</dt>
          <dd className="num">{stations.length}</dd>
        </div>
        <div>
          <dt>Streckenlänge</dt>
          <dd className="num">{totalKm.toFixed(0)} km</dd>
        </div>
        <div>
          <dt>Unterhalt</dt>
          <dd className="num">{formatMoney(upkeep)} / Tag</dd>
        </div>
      </dl>

      {stations.length < 2 && (
        <p className="muted small">
          Für eine Strecke braucht es zwei Bahnhöfe. Stadt auf der Karte anklicken und im Stadtpanel
          „Bahnhof bauen“ wählen — die Lage bestimmt Einzugsgebiet und Grundstückspreis.
        </p>
      )}

      {tracks.length === 0 ? (
        <p className="muted small">Noch keine Strecke gebaut.</p>
      ) : (
        <ul className="linelist">
          {tracks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => selectTrack(t.id)}>
                <span className="linelist__name">
                  {nodeName(t.from)} – {nodeName(t.to)}
                </span>
                <span className="muted num">{t.lengthKm.toFixed(0)} km</span>
                <span className="muted num">{t.maxSpeed} km/h</span>
                {isUnderConstruction(t, state.day) && <span className="badge" title="Im Bau">⏳</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TrackDraftPanel(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const draft = useGame((s) => s.trackDraft)
  const hoverPoint = useGame((s) => s.hoverPoint)
  const elevation = useGame((s) => s.elevation)
  const setTrackSpec = useGame((s) => s.setTrackSpec)
  const cancelBuild = useGame((s) => s.cancelBuild)
  const undo = useGame((s) => s.trackUndoWaypoint)
  if (!state || !draft) return null

  const start = draft.from ? state.network.nodes.get(draft.from) : undefined
  const geometry = start
    ? [start.position, ...draft.waypoints, ...(hoverPoint ? [hoverPoint] : [])]
    : []
  const preview = geometry.length >= 2 ? previewTrack(geometry, draft.spec, elevation ?? undefined) : null

  return (
    <div className="detail">
      <h2>Strecke bauen</h2>
      <p className="muted small">
        {!draft.from
          ? 'Startbahnhof auf der Karte anklicken.'
          : 'Weiter klicken setzt Stützpunkte der Trasse; ein Klick auf einen Bahnhof schließt sie ab. Rücktaste nimmt einen Stützpunkt zurück, Escape bricht ab.'}
      </p>

      <h3>Ausbaustand</h3>
      <div className="field">
        <span className="field__label">Höchstgeschwindigkeit</span>
        <div className="segmented">
          {MAX_SPEEDS.map((v: MaxSpeed) => (
            <button
              key={v}
              type="button"
              className={draft.spec.maxSpeed === v ? 'on' : ''}
              onClick={() => setTrackSpec({ maxSpeed: v })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Gleise</span>
        <div className="segmented">
          {TRACK_COUNTS.map((v: TrackCount) => (
            <button
              key={v}
              type="button"
              className={draft.spec.tracks === v ? 'on' : ''}
              onClick={() => setTrackSpec({ tracks: v })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Signaltechnik</span>
        <div className="segmented">
          {SIGNALLING_KINDS.map((v: Signalling) => (
            <button
              key={v}
              type="button"
              className={draft.spec.signalling === v ? 'on' : ''}
              onClick={() => setTrackSpec({ signalling: v })}
            >
              {SIGNALLING_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={draft.spec.electrified}
          onChange={(e) => setTrackSpec({ electrified: e.target.checked })}
        />
        Elektrifiziert
      </label>

      {preview && (
        <>
          <h3>Vorschau</h3>
          <dl className="facts">
            <div>
              <dt>Länge</dt>
              <dd className="num">{preview.lengthKm.toFixed(1)} km</dd>
            </div>
            <div>
              <dt>Gelände</dt>
              <dd className="num">
                ×{preview.terrainFactor.toFixed(2)}{' '}
                <span className="muted">{terrainWord(preview.terrainFactor)}</span>
              </dd>
            </div>
            <div>
              <dt>Steigung</dt>
              <dd className="num">{preview.gradientPermille.toFixed(1)} ‰</dd>
            </div>
            <div>
              <dt>Bauzeit</dt>
              <dd className="num">{preview.buildDays} Tage</dd>
            </div>
            <div>
              <dt>Baukosten</dt>
              <dd className={`num ${preview.cost > state.cash ? 'neg' : ''}`}>
                {formatMoney(preview.cost, { compact: true })}
              </dd>
            </div>
          </dl>
          {preview.cost > state.cash && (
            <p className="warn small">
              ⚠ Nicht genug Kapital — {formatMoney(preview.cost - state.cash, { compact: true })} fehlen.
            </p>
          )}
        </>
      )}

      <div className="row">
        <button type="button" disabled={draft.waypoints.length === 0} onClick={undo}>
          Stützpunkt zurück
        </button>
        <button type="button" onClick={cancelBuild}>
          Abbrechen
        </button>
      </div>
    </div>
  )
}

function terrainWord(factor: number): string {
  if (factor < 1.25) return 'eben'
  if (factor < 1.8) return 'hügelig'
  if (factor < 2.6) return 'bergig'
  return 'Hochgebirge'
}

function TrackDetail({ trackId }: { readonly trackId: TrackId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const selectTrack = useGame((s) => s.selectTrack)
  if (!state) return null

  const track = state.network.tracks.get(trackId)
  if (!track) return null

  const stationName = (nodeId: string): string =>
    [...state.network.stations.values()].find((s) => s.nodeId === nodeId)?.name ?? 'Abzweig'

  const building = isUnderConstruction(track, state.day)
  const readyIn = track.readyOnDay - state.day
  const worksLeft = track.construction ? track.construction.finishesOnDay - state.day : 0

  const upgrades = [
    ...MAX_SPEEDS.filter((v) => v > track.maxSpeed).map((v) => ({
      label: `Ausbau auf ${v} km/h`,
      upgrade: { kind: 'speed', to: v } as const,
    })),
    ...(track.electrified ? [] : [{ label: 'Elektrifizieren', upgrade: { kind: 'electrify' } as const }]),
    ...TRACK_COUNTS.filter((v) => v > track.tracks).map((v) => ({
      label: `Auf ${v} Gleise ausbauen`,
      upgrade: { kind: 'tracks', to: v } as const,
    })),
    ...SIGNALLING_KINDS.filter((v) => SIGNALLING_KINDS.indexOf(v) > SIGNALLING_KINDS.indexOf(track.signalling)).map(
      (v) => ({ label: `Signaltechnik ${SIGNALLING_LABEL[v]}`, upgrade: { kind: 'signalling', to: v } as const }),
    ),
  ]

  return (
    <div className="detail">
      <button type="button" className="linkish" onClick={() => selectTrack(null)}>
        ← Alle Strecken
      </button>
      <h2>
        {stationName(track.from)} – {stationName(track.to)}
      </h2>

      <dl className="facts">
        <div>
          <dt>Länge</dt>
          <dd className="num">{track.lengthKm.toFixed(1)} km</dd>
        </div>
        <div>
          <dt>Höchstgeschwindigkeit</dt>
          <dd className="num">{track.maxSpeed} km/h</dd>
        </div>
        <div>
          <dt>Gleise</dt>
          <dd className="num">{track.tracks}</dd>
        </div>
        <div>
          <dt>Fahrdraht</dt>
          <dd>{track.electrified ? 'ja' : 'nein'}</dd>
        </div>
        <div>
          <dt>Signaltechnik</dt>
          <dd>{SIGNALLING_LABEL[track.signalling]}</dd>
        </div>
        <div>
          <dt>Gelände</dt>
          <dd className="num">
            ×{track.terrainFactor.toFixed(2)} <span className="muted">{terrainWord(track.terrainFactor)}</span>
          </dd>
        </div>
        <div>
          <dt>Unterhalt</dt>
          <dd className="num">{formatMoney(trackUpkeepPerDay(track))} / Tag</dd>
        </div>
      </dl>

      {building && (
        <p className="warn small">
          ⏳ {readyIn > 0 ? `Im Bau, fertig in ${readyIn} Tagen.` : `Ausbau läuft, fertig in ${worksLeft} Tagen.`}
        </p>
      )}

      <h3>Ausbau</h3>
      {track.construction ? (
        <p className="muted small">Es läuft bereits ein Ausbau.</p>
      ) : upgrades.length === 0 ? (
        <p className="muted small">Die Strecke ist voll ausgebaut.</p>
      ) : (
        <ul className="upgrades">
          {upgrades.map((u) => {
            const cost = trackUpgradeCost(track, u.upgrade)
            const days = trackUpgradeDays(track, u.upgrade)
            return (
              <li key={u.label}>
                <button
                  type="button"
                  disabled={building || cost > state.cash}
                  onClick={() => dispatch({ kind: 'upgrade_track', trackId, upgrade: u.upgrade })}
                  title={building ? 'Erst fertigstellen' : `${days} Tage Bauzeit`}
                >
                  <span>{u.label}</span>
                  <span className={`num ${cost > state.cash ? 'neg' : ''}`}>
                    {formatMoney(cost, { compact: true })}
                  </span>
                  <span className="muted num">{days} T</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="danger"
        onClick={() => {
          dispatch({ kind: 'demolish_track', trackId })
          selectTrack(null)
        }}
        title={`Rückbau bringt ${formatMoney(trackDemolitionValue(track), { compact: true })}`}
      >
        Strecke zurückbauen
      </button>
    </div>
  )
}
