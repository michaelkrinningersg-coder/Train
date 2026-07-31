import { formatDate } from '@game/domain'
import { makeSave } from '@game/sim'
import { useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store.js'
import {
  AUTOSAVE_SLOT,
  deleteSlot,
  downloadSave,
  listSlots,
  readFile,
  readSlot,
  writeSlot,
  type SaveSlot,
} from '../game/storage.js'

/**
 * Spielstände.
 *
 * Der Export als Datei steht gleichberechtigt neben den Plätzen im Browser und
 * nicht in einer Ecke: IndexedDB gehört dem Browser, und was ihm gehört, kann er
 * beim Aufräumen wegwerfen. Ein Spielstand, in dem mehrere Spieljahre stecken,
 * sollte nicht nur dort liegen.
 */

const sizeOf = (bytes: number): string =>
  bytes > 1_000_000 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`

const clock = (iso: string): string => {
  const date = new Date(iso)
  return `${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

export function SaveMenu({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const state = useGame((s) => s.state)
  const load = useGame((s) => s.load)
  const notify = useGame((s) => s.notify)

  const [slots, setSlots] = useState<SaveSlot[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    void listSlots()
      .then(setSlots)
      .catch(() => notify('Spielstände lassen sich nicht lesen — läuft der Browser im privaten Modus?'))
  }

  useEffect(refresh, [])

  const save = async (): Promise<void> => {
    if (!state) return
    setBusy(true)
    const label = name.trim() || formatDate(state.day)
    try {
      await writeSlot(`s-${Date.now()}`, makeSave(state, label, new Date().toISOString()))
      setName('')
      refresh()
    } catch {
      notify('Speichern fehlgeschlagen — Spielstand notfalls exportieren.')
    } finally {
      setBusy(false)
    }
  }

  const restore = async (id: string): Promise<void> => {
    const save = await readSlot(id)
    if (!save) return
    if (load(save)) onClose()
  }

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      if (load(await readFile(file))) onClose()
    } catch {
      notify('Die Datei ist kein lesbarer Spielstand.')
    }
  }

  return (
    <section className="panel savemenu" aria-label="Spielstände">
      <header className="panel__head">
        <h2>Spielstände</h2>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
      </header>

      <div className="field">
        <span className="field__label">Neuer Spielstand</span>
        <div className="row">
          <input
            type="text"
            value={name}
            placeholder={state ? formatDate(state.day) : ''}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" className="primary" disabled={!state || busy} onClick={() => void save()}>
            Speichern
          </button>
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="muted small">Noch kein Spielstand. Das Spiel speichert alle 30 Spieltage von selbst.</p>
      ) : (
        <ul className="savelist">
          {slots.map((slot) => (
            <li key={slot.id}>
              <div className="savelist__main">
                <b>{slot.label}</b>
                {slot.id === AUTOSAVE_SLOT && <span className="muted small"> automatisch</span>}
                <div className="muted small num">
                  {formatDate(slot.day)} · gespeichert {clock(slot.savedAt)} · {sizeOf(slot.bytes)}
                </div>
              </div>
              <div className="row">
                <button type="button" onClick={() => void restore(slot.id)}>
                  Laden
                </button>
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    void readSlot(slot.id).then((s) => s && downloadSave(s, `${slot.label.replace(/\W+/g, '-')}.json`))
                  }
                >
                  Export
                </button>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => void deleteSlot(slot.id).then(refresh)}
                  title="Löschen"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Datei</h3>
      <div className="row">
        <button
          type="button"
          disabled={!state}
          onClick={() =>
            state && downloadSave(makeSave(state, formatDate(state.day), new Date().toISOString()), 'rail-and-road.json')
          }
        >
          Exportieren
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Importieren
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      <p className="muted small">
        Spielstände im Browser überlebt kein Aufräumen der Websitedaten. Wer einen Stand behalten will, exportiert ihn.
      </p>
    </section>
  )
}
