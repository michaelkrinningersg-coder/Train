import { busClass, formatDate, isAvailable, trainClass, type PatternId, type VehicleId } from '@game/domain'
import { useState } from 'react'
import { useGame } from '../game/store.js'

/**
 * Fahrzeugtausch auf einer Linie.
 *
 * Der Fall, für den es gebaut ist: ein Fahrzeug geht zur Hauptuntersuchung und
 * fehlt der Linie wochenlang. Ohne Ersatz fährt sie so lange dünneren Takt —
 * genau das soll die Entscheidung sein, ob man eine Reserve vorhält. Die Reserve
 * kostet Unterhalt, ohne sie kostet die Werkstatt Fahrgäste.
 *
 * Derselbe Griff dient der Flottenerneuerung: einen alten Bus gegen einen neuen
 * tauschen, ohne die Linie erst leerzuräumen und neu zu bestücken. Deshalb ist
 * er nicht auf Werkstattfälle beschränkt.
 */

export function VehicleSwap({
  patternId,
  outgoing,
}: {
  readonly patternId: PatternId
  readonly outgoing: VehicleId
}): React.JSX.Element | null {
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const [open, setOpen] = useState(false)
  if (!state) return null

  const vehicle = state.fleet.get(outgoing)
  if (!vehicle) return null

  const assigned = new Set([...state.patterns.values()].flatMap((p) => p.vehicleIds))
  const spares = [...state.fleet.values()].filter(
    (v) => v.mode === vehicle.mode && !assigned.has(v.id) && isAvailable(v, state.day),
  )

  const nameOf = (id: VehicleId): string => {
    const v = state.fleet.get(id)
    if (!v) return '?'
    const cls = v.mode === 'rail' ? trainClass(v.classId) : busClass(v.classId)
    return `${cls?.displayName ?? v.classId} · ${Math.round(v.condition * 100)} %`
  }

  const workshop = vehicle.inWorkshopUntil
  const away = workshop !== undefined && state.day < workshop

  if (!open) {
    return (
      <button
        type="button"
        className="linkish"
        disabled={spares.length === 0}
        title={
          spares.length === 0
            ? 'Kein freies Fahrzeug vorhanden — im Fuhrpark eines kaufen oder von einer anderen Linie abziehen.'
            : away
              ? `Steht bis ${formatDate(workshop)} im Werk. Ein Ersatzfahrzeug einsetzen.`
              : 'Durch ein anderes Fahrzeug ersetzen'
        }
        onClick={() => setOpen(true)}
      >
        {away ? 'ersetzen ⚠' : 'ersetzen'}
      </button>
    )
  }

  return (
    <span className="row">
      <select
        defaultValue=""
        onChange={(e) => {
          const incoming = e.target.value as VehicleId
          if (!incoming) return
          dispatch({ kind: 'replace_vehicle', patternId, outgoing, incoming })
          setOpen(false)
        }}
      >
        <option value="">{nameOf(outgoing)} ersetzen durch …</option>
        {spares.map((v) => (
          <option key={v.id} value={v.id}>
            {nameOf(v.id)}
          </option>
        ))}
      </select>
      <button type="button" className="linkish" onClick={() => setOpen(false)}>
        ×
      </button>
    </span>
  )
}
