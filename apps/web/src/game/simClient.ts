import type { City, GameState } from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { advanceDays, applyChanges } from '@game/sim'
import type { SimRequest, SimResponse } from './sim.worker.js'

/**
 * Der Draht zum Rechenthread.
 *
 * Zwei Dinge macht diese Datei, und beide sind der Grund, warum sie überhaupt
 * existiert:
 *
 * **Sie hält den Worker vom Zustand fern.** Hinein geht der Zustand ohne
 * Städte, heraus kommt derselbe zurück; das Wiedereinsetzen der Städte
 * passiert hier, damit es der Store nicht wissen muss.
 *
 * **Sie hat einen Rückfallweg.** Wo es keine Worker gibt — ältere Umgebungen,
 * Tests, ein fehlgeschlagener Modulaufbau — rechnet das Spiel weiter im
 * Hauptthread. Ein Spiel, das ohne Worker gar nicht startet, wäre ein
 * schlechterer Tausch als eines, das dann eben ruckelt.
 */

export interface SimClient {
  /** Städte bekanntgeben. Muss vor dem ersten `advance` fertig sein. */
  init: (cities: readonly City[]) => Promise<void>
  advance: (state: GameState, days: number) => Promise<GameState>
  readonly available: boolean
  dispose: () => void
}

/** Rechnet im Hauptthread — der Weg ohne Worker. */
function inlineClient(): SimClient {
  let demand: DemandMatrix | null = null
  return {
    available: false,
    init: async (cities) => {
      demand = buildDemandMatrix(withPotentials(cities), { minTripsPerDay: 1 })
      await Promise.resolve()
    },
    advance: async (state, days) => {
      if (!demand) throw new Error('Der Rechenweg kennt die Städte noch nicht.')
      // Auch hier ein Mikrotask, damit der Aufrufer in beiden Faellen dieselbe
      // Nebenlaeufigkeit sieht - sonst faende ein Fehler nur im Worker statt.
      await Promise.resolve()
      const next = advanceDays(state, demand, days)
      // Strukturwandel: dieselbe Nachfuehrung wie im Worker.
      if (next.cities !== state.cities) {
        demand = buildDemandMatrix(withPotentials([...next.cities.values()]), { minTripsPerDay: 1 })
      }
      return next
    },
    dispose: () => {
      demand = null
    },
  }
}

/**
 * Erzeugt den Client. Schlägt der Worker fehl, wird im Hauptthread gerechnet.
 *
 * Der Fehlschlag wird bewusst **nicht** verschwiegen: `available` sagt, welcher
 * Weg gilt, und die Oberfläche kann es erwähnen. Ein stiller Rückfall auf den
 * langsamen Weg ist genau die Art Fehler, die man erst ein halbes Jahr später
 * bemerkt.
 */
export function createSimClient(): SimClient {
  // Zum Vergleichen: mit VITE_SIM_INLINE=1 rechnet das Spiel wieder im
  // Hauptthread. Ohne diesen Schalter liesse sich der Nutzen des Workers nur
  // behaupten, nicht messen.
  if (import.meta.env['VITE_SIM_INLINE'] === '1') return inlineClient()

  let worker: Worker
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'sim' })
  } catch {
    return inlineClient()
  }

  let nextId = 1
  let cities: ReadonlyMap<City['id'], City> = new Map()
  const waiting = new Map<number, { resolve: (r: SimResponse) => void; reject: (e: Error) => void }>()

  worker.onmessage = (event: MessageEvent<SimResponse>): void => {
    const pending = waiting.get(event.data.id)
    if (!pending) return
    waiting.delete(event.data.id)
    if (event.data.kind === 'error') pending.reject(new Error(event.data.message))
    else pending.resolve(event.data)
  }

  worker.onerror = (event): void => {
    const error = new Error(`Rechenthread abgestürzt: ${event.message}`)
    for (const pending of waiting.values()) pending.reject(error)
    waiting.clear()
  }

  // `Omit` auf einer Vereinigung fasst die Varianten zusammen und verliert
  // dabei genau die Trennung, um die es geht - deshalb die verteilte Form.
  type Unsent<T> = T extends { id: number } ? Omit<T, 'id'> : never

  const send = async (request: Unsent<SimRequest>): Promise<SimResponse> => {
    const id = nextId++
    return new Promise<SimResponse>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      worker.postMessage({ ...request, id })
    })
  }

  return {
    available: true,

    init: async (list) => {
      cities = new Map(withPotentials(list).map((c) => [c.id, c]))
      await send({ kind: 'init', cities: list })
    },

    advance: async (state, days) => {
      // Die Staedte bleiben hier: sie sind ein Drittel des Zustands und aendern
      // sich fast nie.
      const { cities: _constant, ...mobile } = state
      const reply = await send({ kind: 'advance', state: mobile, days })
      if (reply.kind !== 'advanced') throw new Error('Unerwartete Antwort des Rechenthreads.')

      // „Fast nie" ist der Strukturwandel. Der Worker hat ihn schon angewandt,
      // schickt aber nur die *Liste* zurueck - dieselbe Liste auf dieselben
      // Ausgangsstaedte ergibt zwangslaeufig denselben Stand, und das ist
      // billiger, als 694 Staedte je Betriebstag ueber die Grenze zu tragen.
      const fresh = reply.state.facilityChanges.slice(state.facilityChanges.length)
      if (fresh.length > 0) {
        const updated = applyChanges(cities, fresh)
        if (updated) {
          // Die Potenziale haengen an den Einrichtungen und muessen mit.
          cities = new Map(withPotentials([...updated.values()]).map((c) => [c.id, c]))
        }
      }

      return { ...reply.state, cities }
    },

    dispose: () => {
      worker.terminate()
      waiting.clear()
    },
  }
}
