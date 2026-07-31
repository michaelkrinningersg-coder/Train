import type { SaveGame } from '@game/sim'

/**
 * Spielstände im Browser.
 *
 * IndexedDB und nicht `localStorage`: ein gewachsener Spielstand mit vierhundert
 * Tagen Historie liegt im Megabyte-Bereich, und `localStorage` ist bei etwa fünf
 * Megabyte am Ende — für *alle* Anwendungen derselben Herkunft zusammen. Der
 * Fehlerfall wäre zudem denkbar unangenehm: das Speichern schlägt fehl, wenn der
 * Spielstand groß genug geworden ist, dass man ihn wirklich nicht verlieren will.
 *
 * Bewusst ohne Bibliothek. Was hier gebraucht wird — lesen, schreiben, löschen,
 * auflisten — sind vier Aufrufe; eine Abhängigkeit dafür stünde in keinem
 * Verhältnis.
 */

const DB_NAME = 'rail-and-road'
const DB_VERSION = 1
const STORE = 'saves'

/** Der Platz, in den das Spiel von selbst speichert. */
export const AUTOSAVE_SLOT = 'auto'

export interface SaveSlot {
  readonly id: string
  readonly label: string
  readonly savedAt: string
  readonly day: number
  readonly bytes: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht verfügbar'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Zugriff fehlgeschlagen'))
    })
  } finally {
    db.close()
  }
}

interface StoredEntry {
  readonly save: SaveGame
  readonly meta: SaveSlot
}

export async function writeSlot(id: string, save: SaveGame): Promise<void> {
  // Die Größe wird beim Schreiben gemessen und nicht beim Auflisten: sonst
  // müsste die Liste jeden Spielstand vollständig laden, um sie zu zeigen.
  const bytes = new Blob([JSON.stringify(save)]).size
  const entry: StoredEntry = {
    save,
    meta: { id, label: save.label, savedAt: save.savedAt, day: save.state.day, bytes },
  }
  await withStore('readwrite', (store) => store.put(entry, id) as IDBRequest<unknown> as IDBRequest<void>)
}

export async function readSlot(id: string): Promise<SaveGame | null> {
  const entry = await withStore<StoredEntry | undefined>('readonly', (store) => store.get(id))
  return entry?.save ?? null
}

export async function deleteSlot(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id) as IDBRequest<unknown> as IDBRequest<void>)
}

export async function listSlots(): Promise<SaveSlot[]> {
  const entries = await withStore<StoredEntry[]>('readonly', (store) => store.getAll())
  return entries
    .map((e) => e.meta)
    .sort((a, b) => (a.id === AUTOSAVE_SLOT ? -1 : b.id === AUTOSAVE_SLOT ? 1 : b.savedAt.localeCompare(a.savedAt)))
}

/** Spielstand als Datei herunterladen — der einzige Weg aus dem Browser heraus. */
export function downloadSave(save: SaveGame, filename: string): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function readFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text())
}
