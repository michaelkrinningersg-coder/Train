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
import {
  formatMoney,
  passingLoopCost,
  trackDemolitionValue,
  trackRenewalCost,
  trackRenewalDays,
  trackUpgradeCost,
  trackUpgradeDays,
} from '@game/economy'
import { previewTrack } from '@game/sim'
import { useState } from 'react'
import { useGame } from '../game/store.js'
import { RailLineDetail } from './RailLineDetail.js'

const SIGNALLING_LABEL: Record<Signalling, string> = {
  classic: 'klassisch',
  etcs_l1: 'ETCS L1',
  etcs_l2: 'ETCS L2',
}

export function RailTab(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const selectedTrackId = useGame((s) => s.selectedTrackId)
  const selectedLineId = useGame((s) => s.selectedLineId)
  const trackDraft = useGame((s) => s.trackDraft)
  const mapMode = useGame((s) => s.mapMode)
  const draftMode = useGame((s) => s.draftMode)
  if (!state) return null

  if (mapMode === 'draw-line' && draftMode === 'rail') return <RailLineDraft />
  if (trackDraft) return <TrackDraftPanel />
  if (selectedLineId && state.lines.get(selectedLineId)?.mode === 'rail') {
    return <RailLineDetail lineId={selectedLineId} />
  }
  if (selectedTrackId && mapMode !== 'place-loop') return <TrackDetail trackId={selectedTrackId} />
  if (mapMode === 'place-loop') return <LoopPlacement />
  return <RailOverview />
}

function LoopPlacement(): React.JSX.Element {
  const cancel = useGame((s) => s.cancelBuild)
  return (
    <div className="detail">
      <h2>Überholstelle setzen</h2>
      <p className="muted small">
        Stelle auf der Strecke anklicken. Dort können sich Gegenzüge kreuzen — auf einer eingleisigen Strecke ist das
        der Unterschied zwischen einem fahrbaren und einem unfahrbaren Fahrplan. Zu nah am Streckenende bringt sie
        nichts.
      </p>
      <button type="button" onClick={cancel}>
        Abbrechen
      </button>
    </div>
  )
}

function RailLineDraft(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const draft = useGame((s) => s.draft)
  const cancel = useGame((s) => s.cancelLine)
  const commit = useGame((s) => s.commitLine)
  const [name, setName] = useState('')
  if (!state) return null

  const names = draft.map((id) => state.network.stations.get(id)?.name).filter((n): n is string => Boolean(n))

  return (
    <div className="detail">
      <h2>Neue Bahnlinie</h2>
      <p className="muted small">
        Bahnhöfe auf der Karte in Fahrtreihenfolge anklicken. Die Strecke dazwischen sucht das Spiel selbst — sie muss
        durchgehend befahrbar sein, ein Elektrozug kommt ohne Fahrdraht nicht durch.
      </p>
      <ol className="draftlist">
        {names.length === 0 && <li className="muted">Noch nichts gewählt</li>}
        {names.map((n, i) => (
          <li key={`${n}-${i}`}>{n}</li>
        ))}
      </ol>
      <div className="field">
        <span className="field__label">Name</span>
        <input type="text" value={name} placeholder={names.join(' – ') || 'Linienname'} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <button type="button" className="primary" disabled={draft.length < 2} onClick={() => { commit(name.trim() || names.join(' – ')); setName('') }}>
          Linie anlegen
        </button>
        <button type="button" onClick={cancel}>
          Abbrechen
        </button>
      </div>
    </div>
  )
}

function RailOverview(): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const beginLine = useGame((s) => s.beginLine)
  const selectLine = useGame((s) => s.selectLine)
  if (!state) return null

  const lines = [...state.lines.values()].filter((l) => l.mode === 'rail')
  const stations = [...state.network.stations.values()].filter((s) => s.mode !== 'bus')

  return (
    <>
      <TrackList />
      <div className="detail detail--split">
        <div className="detail__head">
          <h2>Bahnlinien</h2>
          <button type="button" className="primary" disabled={stations.length < 2} onClick={() => beginLine('rail')}>
            Neue Bahnlinie
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="muted small">Noch keine Bahnlinie. Erst Strecke bauen, dann Linie darüberlegen.</p>
        ) : (
          <ul className="linelist">
            {lines.map((l) => {
              const r = state.lastDay?.lines.find((x) => x.lineId === l.id)
              return (
                <li key={l.id}>
                  <button type="button" onClick={() => selectLine(l.id)}>
                    <span className="linelist__name">{l.name}</span>
                    {r ? (
                      <>
                        <span className="muted num">{Math.round(r.totalPassengers).toLocaleString('de-DE')} Fg.</span>
                        <span className={`margin ${(r.punctuality ?? 1) >= 0.8 ? 'pos' : 'neg'}`}>
                          {Math.round((r.punctuality ?? 1) * 100)} %
                        </span>
                        {(r.conflictCount ?? 0) > 0 && <span className="badge" title="Fahrplankonflikte">⚠</span>}
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
    </>
  )
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
  const beginLoop = useGame((s) => s.beginLoop)
  if (!state) return null

  const track = state.network.tracks.get(trackId)
  if (!track) return null

  const stationName = (nodeId: string): string =>
    [...state.network.stations.values()].find((s) => s.nodeId === nodeId)?.name ?? 'Abzweig'

  const building = isUnderConstruction(track, state.day)
  const readyIn = track.readyOnDay - state.day
  const worksLeft = track.construction ? track.construction.finishesOnDay - state.day : 0

  const ageYears = Math.max(0, (state.day - track.builtOnDay) / 365)
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

      <h3>Zustand</h3>
      <p className="muted small">
        Die Strecke ist <b className="num">{ageYears.toFixed(1)}</b> Jahre alt. Mit dem Alter steigt die
        Störanfälligkeit — eine Erneuerung des Oberbaus setzt sie zurück.
      </p>
      <button
        type="button"
        className="wide"
        disabled={building || trackRenewalCost(track) > state.cash}
        title={`${trackRenewalDays(track)} Tage Bauzeit, in denen nur die halbe Kapazität zur Verfügung steht`}
        onClick={() => dispatch({ kind: 'renew_track', trackId })}
      >
        Oberbau erneuern · {formatMoney(trackRenewalCost(track), { compact: true })}
      </button>

      {track.tracks === 1 && (
        <>
          <h3>Überholstelle</h3>
          <p className="muted small">
            Teilt den eingleisigen Abschnitt. Gegenzüge können hier kreuzen, statt aufeinander zu warten.
          </p>
          <button type="button" className="primary wide" disabled={building} onClick={() => beginLoop(trackId)}>
            Überholstelle setzen · {formatMoney(passingLoopCost(2), { compact: true })}
          </button>
        </>
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
