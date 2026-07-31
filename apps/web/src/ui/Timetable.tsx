import { formatDate, type LineId } from '@game/domain'
import { isMinor, simulateRailLine, type Conflict, type RailRun } from '@game/sim'
import { useMemo } from 'react'
import { useGame } from '../game/store.js'
import { THEME } from '../theme.js'

/**
 * Bildfahrplan (Zeit-Weg-Diagramm).
 *
 * Die Y-Achse ist der Streckenkilometer, die X-Achse der Betriebstag. Jede Linie
 * ist ein Zuglauf; ihre Steigung ist die Geschwindigkeit. Wo sich zwei Linien
 * kreuzen, treffen sich zwei Züge — auf zweigleisiger Strecke unproblematisch,
 * auf eingleisiger nur an einer Überholstelle möglich.
 *
 * Selbst gebaut und nicht mit einer Diagrammbibliothek: keine davon kennt
 * Betriebsstellen als Y-Achse, Konfliktmarken oder zwei Fahrtrichtungen als
 * gegenläufige Linienscharen. Wer einmal mit einem echten Bildfahrplan
 * gearbeitet hat, sieht sofort, warum ein Zug nicht fahren kann — das ist besser
 * als jede Fehlermeldung.
 */

const MARGIN = { top: 14, right: 18, bottom: 26, left: 92 }
const HEIGHT = 320
const START_HOUR = 4
const END_HOUR = 23

const hhmm = (sec: number): string => {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function Timetable({ lineId }: { readonly lineId: LineId }): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const demand = useGame((s) => s.demand)
  const toggle = useGame((s) => s.toggleTimetable)

  const result = useMemo(() => {
    if (!state || !demand) return null
    // Bewusst hier gerechnet statt im Spielzustand abgelegt: die Zuglaeufe eines
    // Tages sind gross, und sie haengen nur vom Zustand ab.
    return simulateRailLine(state, demand, lineId)
  }, [state, demand, lineId])

  const line = state?.lines.get(lineId)
  if (!state || !line || !result || result.runs.length === 0) {
    return (
      <section className="timetable">
        <header className="timetable__head">
          <h3>Bildfahrplan</h3>
          <button type="button" className="panel__close" onClick={toggle} aria-label="Schließen">
            ×
          </button>
        </header>
        <p className="muted small">Noch kein fahrbarer Fahrplan — Zug zuteilen und Takt setzen.</p>
      </section>
    )
  }

  const runs = result.runs
  const reference = runs.find((r) => r.direction === 'forward') ?? runs[0]!
  const maxKm = Math.max(...runs.map((r) => r.lengthKm))
  const width = 1000
  const innerWidth = width - MARGIN.left - MARGIN.right
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const x = (sec: number): number =>
    MARGIN.left + ((sec / 3600 - START_HOUR) / (END_HOUR - START_HOUR)) * innerWidth
  const y = (km: number): number => MARGIN.top + (km / Math.max(maxKm, 1)) * innerHeight

  const pathFor = (run: RailRun): string =>
    run.graph
      .filter((g) => g.seconds / 3600 >= START_HOUR - 1 && g.seconds / 3600 <= END_HOUR + 1)
      .map((g, i) => {
        const km = run.direction === 'forward' ? g.km : maxKm - g.km
        return `${i === 0 ? 'M' : 'L'}${x(g.seconds).toFixed(1)},${y(km).toFixed(1)}`
      })
      .join(' ')

  const serious: Conflict[] = result.conflicts.filter((c) => !isMinor(c))

  /** Position eines Zuges zu einer Zeit, auf der gemeinsamen Kilometerachse. */
  const positionAt = (run: RailRun, seconds: number): number | null => {
    const g = run.graph
    if (g.length === 0 || seconds < g[0]!.seconds || seconds > g[g.length - 1]!.seconds) return null
    for (let i = 1; i < g.length; i++) {
      if (g[i]!.seconds >= seconds) {
        const a = g[i - 1]!
        const b = g[i]!
        const t = b.seconds === a.seconds ? 0 : (seconds - a.seconds) / (b.seconds - a.seconds)
        const km = a.km + (b.km - a.km) * t
        return run.direction === 'forward' ? km : maxKm - km
      }
    }
    return null
  }

  /**
   * Die Marke sitzt dort, wo sich die beiden Zuglaeufe treffen - genau da, wo
   * man im Bildfahrplan die Kreuzung sieht. Am Startpunkt eines Zuges waere sie
   * zwar zeitlich richtig, aber ortlich nichtssagend.
   */
  const marks = serious.slice(0, 120).map((c) => {
    const a = runs.find((r) => r.id === c.runs[0])
    const b = runs.find((r) => r.id === c.runs[1])

    let bestTime = c.at
    let bestKm = a ? (positionAt(a, c.at) ?? 0) : 0

    if (a && b) {
      let smallest = Infinity
      const steps = 24
      for (let i = 0; i <= steps; i++) {
        const t = c.at + (c.overlapSec * i) / steps
        const pa = positionAt(a, t)
        const pb = positionAt(b, t)
        if (pa === null || pb === null) continue
        const gap = Math.abs(pa - pb)
        if (gap < smallest) {
          smallest = gap
          bestTime = t
          bestKm = (pa + pb) / 2
        }
      }
    }
    return { conflict: c, cx: x(bestTime), cy: y(bestKm) }
  })

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  return (
    <section className="timetable">
      <header className="timetable__head">
        <h3>
          Bildfahrplan <span className="muted">{line.name}</span>
        </h3>
        <div className="timetable__legend">
          <span>
            <i style={{ background: THEME.city }} /> Hinrichtung
          </span>
          <span>
            <i style={{ background: THEME.demand }} /> Gegenrichtung
          </span>
          {serious.length > 0 && (
            <span>
              <i style={{ background: THEME.critical }} /> {serious.length} Konflikte
            </span>
          )}
          <span className="muted">{formatDate(state.day)}</span>
        </div>
        <button type="button" className="panel__close" onClick={toggle} aria-label="Schließen">
          ×
        </button>
      </header>

      <div className="timetable__scroll">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="timetable__svg" role="img" aria-label="Zeit-Weg-Diagramm">
          {/* Stundenraster */}
          {hours.map((h) => (
            <g key={h}>
              <line
                x1={x(h * 3600)}
                x2={x(h * 3600)}
                y1={MARGIN.top}
                y2={HEIGHT - MARGIN.bottom}
                stroke={THEME.border}
                strokeWidth={h % 3 === 0 ? 1 : 0.4}
              />
              <text x={x(h * 3600)} y={HEIGHT - 8} fill={THEME.textMuted} fontSize={10} textAnchor="middle">
                {h}
              </text>
            </g>
          ))}

          {/* Betriebsstellen als Y-Achse */}
          {reference.stops.map((stop) => {
            const station = state.network.stations.get(stop.stationId)
            return (
              <g key={stop.stationId}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(stop.km)}
                  y2={y(stop.km)}
                  stroke={THEME.border}
                  strokeWidth={1}
                />
                <text x={MARGIN.left - 8} y={y(stop.km) + 3} fill={THEME.textSecondary} fontSize={10} textAnchor="end">
                  {station?.name ?? '?'}
                </text>
              </g>
            )
          })}

          {/* Zuglaeufe */}
          {runs.map((run) => (
            <path
              key={run.id}
              d={pathFor(run)}
              fill="none"
              stroke={run.direction === 'forward' ? THEME.city : THEME.demand}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Konflikte */}
          {marks.map((m, i) => (
            <circle key={`${m.conflict.resource}-${i}`} cx={m.cx} cy={m.cy} r={3.5} fill={THEME.critical}>
              <title>
                {`${hhmm(m.conflict.at)} · ${conflictLabel(m.conflict)} · ${Math.round(m.conflict.overlapSec)} s Überschneidung`}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="timetable__facts">
        <span>
          Pünktlichkeit <b className={result.punctuality < 0.8 ? 'neg' : 'pos'}>{Math.round(result.punctuality * 100)} %</b>
        </span>
        <span>
          Ø Verspätung <b className="num">{(result.averageDelaySec / 60).toFixed(1)} min</b>
        </span>
        <span>
          Züge <b className="num">{result.departuresPerDirection}</b> je Richtung
        </span>
        <span>
          Takt <b className="num">{Math.round(result.effectiveHeadwayMin)}′</b>
        </span>
      </div>
    </section>
  )
}

function conflictLabel(conflict: Conflict): string {
  switch (conflict.kind) {
    case 'opposing_single':
      return `Gegenzug auf eingleisigem Abschnitt (${conflict.label})`
    case 'block':
      return `Zugfolge zu dicht (${conflict.label})`
    case 'platform':
      return `Bahnsteig belegt (${conflict.label})`
    case 'vehicle':
      return 'Fahrzeug doppelt eingeplant'
  }
}
