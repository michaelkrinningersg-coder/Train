/// <reference lib="webworker" />
import type { City, GameState } from '@game/domain'
import { buildDemandMatrix, withPotentials, type DemandMatrix } from '@game/demand'
import { advanceDays } from '@game/sim'

/**
 * Die Betriebssimulation, außerhalb des Hauptthreads.
 *
 * Ein Betriebstag kostet gemessen 36 ms bei acht Linien und 89 ms bei sechzehn.
 * Die schnellste Spielgeschwindigkeit taktet mit 180 ms — bei einem Netz, wie
 * es die Aufträge verlangen, rechnete der Hauptthread also die halbe Zeit und
 * die Karte ruckelte dazwischen.
 *
 * `@game/sim` war dafür vorbereitet: kein DOM, keine Ein- und Ausgabe, kein
 * `Math.random()`. Der Wechsel ist deshalb ein Verschieben und keine
 * Umschreibung.
 *
 * ## Was hier *nicht* passiert
 *
 * Der Worker hält **keinen** Spielzustand. Er bekommt einen und gibt einen
 * zurück — dieselbe reine Funktion wie vorher, nur woanders. Zwei Zustände, die
 * auseinanderlaufen können, wären der teuerste Fehler, den man sich an dieser
 * Stelle einhandeln kann; der Preis dafür ist eine Kopie je Richtung.
 *
 * Damit die bezahlbar bleibt, werden die **Städte nicht mitgeschickt**: sie sind
 * über ein ganzes Spiel unverändert, machen aber ein Drittel des Zustands aus.
 * Der Worker bekommt sie einmal beim Start und setzt sie wieder ein.
 *
 * Die **Nachfragematrix** baut der Worker sich selbst. Sie hängt nur an den
 * Städten, ist mit 141 000 Relationen groß und wäre als Nachricht teurer als
 * ihre Berechnung. Der Hauptthread baut seine eigene, weil Stadtpanel und
 * Bildfahrplan sie brauchen — beide Läufe laufen nebeneinander.
 *
 * ## Städte, die sich doch ändern
 *
 * Seit es den Strukturwandel gibt, stimmt „über ein ganzes Spiel unverändert"
 * nicht mehr ganz. Die Änderungen sind aber winzig und stehen als Liste im
 * Zustand, der ohnehin hin- und hergeht: beide Seiten wenden dieselbe Liste an
 * und kommen damit garantiert auf denselben Stand. Die Alternative — die
 * Städte wieder mitzuschicken — würde einen seltenen Fall mit einem ständigen
 * Preis bezahlen.
 */

/** Der Zustand ohne die Städte — alles, was sich von Tag zu Tag ändern kann. */
export type MobileState = Omit<GameState, 'cities'>

export type SimRequest =
  | { readonly kind: 'init'; readonly id: number; readonly cities: readonly City[] }
  | { readonly kind: 'advance'; readonly id: number; readonly state: MobileState; readonly days: number }

export type SimResponse =
  | { readonly kind: 'ready'; readonly id: number }
  | { readonly kind: 'advanced'; readonly id: number; readonly state: MobileState }
  | { readonly kind: 'error'; readonly id: number; readonly message: string }

let cities: ReadonlyMap<City['id'], City> | null = null
let demand: DemandMatrix | null = null

const post = (message: SimResponse): void => {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message)
}

self.onmessage = (event: MessageEvent<SimRequest>): void => {
  const request = event.data
  try {
    if (request.kind === 'init') {
      // Dieselbe Anreicherung wie im Hauptthread. Sie hier zu wiederholen ist
      // billiger, als angereicherte Staedte zu verschicken.
      const enriched = withPotentials(request.cities)
      cities = new Map(enriched.map((c) => [c.id, c]))
      demand = buildDemandMatrix(enriched, { minTripsPerDay: 1 })
      post({ kind: 'ready', id: request.id })
      return
    }

    if (!cities || !demand) throw new Error('Der Rechenthread kennt die Städte noch nicht.')

    const full: GameState = { ...request.state, cities }
    const next = advanceDays(full, demand, request.days)

    // Hat der Strukturwandel zugeschlagen, gelten ab jetzt andere Staedte und
    // eine andere Matrix. `advanceDays` hat innerhalb des Sprungs schon damit
    // gerechnet; hier wird der Stand fuer die naechsten Sprunge festgehalten.
    if (next.cities !== cities) {
      const enriched = withPotentials([...next.cities.values()])
      cities = new Map(enriched.map((c) => [c.id, c]))
      demand = buildDemandMatrix(enriched, { minTripsPerDay: 1 })
    }

    const { cities: _constant, ...mobile } = next
    post({ kind: 'advanced', id: request.id, state: mobile })
  } catch (error) {
    post({ kind: 'error', id: request.id, message: (error as Error).message })
  }
}
