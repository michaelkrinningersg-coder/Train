import { busClass, cityRadiusKm, trainClass } from '@game/domain'
import type { Money, Vehicle } from '@game/domain'

/** Baukosten und laufende Kosten. Alle Betraege in Cent. */

/** Grundkosten einer Bushaltestelle. */
export const BUS_STOP_BASE_COST: Money = 12_000_00
/** Haltestellen in grossen Staedten sind teurer: Grundstueck, Umbau, Genehmigung. */
export function busStopCost(population: number): Money {
  return Math.round(BUS_STOP_BASE_COST * (1 + cityRadiusKm(population) / 12))
}

export const BUS_STOP_UPKEEP_PER_DAY: Money = 800

/** Wiederverkaufswert eines Fahrzeugs: sofortiger Wertverlust plus Alterung. */
export function resaleValue(vehicle: Vehicle, purchasePrice: Money): Money {
  return Math.round(purchasePrice * vehicle.units * 0.7 * Math.max(vehicle.condition, 0.15))
}

/** Katalogeintrag eines Fahrzeugs, gleich ob Bus oder Zug. */
export function vehicleSpec(vehicle: Vehicle): { purchasePrice: Money; upkeepPerDay: Money } | undefined {
  return vehicle.mode === 'rail' ? trainClass(vehicle.classId) : busClass(vehicle.classId)
}

/** Taeglicher Unterhalt eines Fahrzeugs. Alte Fahrzeuge kosten mehr. */
export function vehicleUpkeepPerDay(vehicle: Vehicle): Money {
  const cls = vehicleSpec(vehicle)
  if (!cls) return 0
  // Bei Zustand 1,0 der Katalogwert, bei 0,0 das Doppelte.
  const wearFactor = 2 - Math.max(vehicle.condition, 0)
  return Math.round(cls.upkeepPerDay * vehicle.units * wearFactor)
}

/**
 * Zustand nach einer Hauptuntersuchung. Nie ganz neu — ein aufgearbeitetes
 * Fahrzeug ist ein aufgearbeitetes Fahrzeug, und irgendwann lohnt der Ersatz
 * mehr als die naechste Werkstatt.
 */
export const SERVICE_RESTORES_TO = 0.92

/**
 * Kosten einer Hauptuntersuchung: anteilig am Neupreis, und zwar nach dem, was
 * aufzuholen ist. Ein fast neues Fahrzeug durchzusehen ist billig, ein
 * heruntergefahrenes kostet ein Drittel des Neupreises — dort faengt der
 * Vergleich mit dem Neukauf an, und genau der soll die Entscheidung sein.
 */
export function serviceCost(vehicle: Vehicle, purchasePrice: Money): Money {
  const gap = Math.max(0, SERVICE_RESTORES_TO - vehicle.condition)
  return Math.round(purchasePrice * vehicle.units * (0.04 + 0.36 * gap))
}

/**
 * Wie lange eine Hauptuntersuchung dauert.
 *
 * Ein Durchsehen sind zwei Wochen, eine Grundinstandsetzung mehrere Monate. Das
 * ist der eigentliche Preis der Instandhaltung: nicht das Geld, sondern das
 * fehlende Fahrzeug. Wer keine Reserve hat, faehrt so lange duenneren Takt.
 */
export function serviceDays(vehicle: Vehicle): number {
  const gap = Math.max(0, SERVICE_RESTORES_TO - vehicle.condition)
  return Math.round(14 + 130 * gap)
}

/**
 * Eine unplanmäßige Reparatur macht das Fahrzeug wieder fahrbereit — mehr nicht.
 *
 * Sie ist keine kleine Hauptuntersuchung. Wer nach einem Schaden dachte, das
 * Fahrzeug sei jetzt „durchgesehen", hätte einen Anreiz, auf den Schaden zu
 * warten statt ihm zuvorzukommen. Deshalb hebt die Reparatur den Zustand nur um
 * so viel, wie der Schaden selbst gekostet hat.
 */
export const REPAIR_RESTORES = 0.03

/**
 * Kosten einer unplanmäßigen Reparatur.
 *
 * Teurer je Ausfalltag, weil eine lange Reparatur eine große ist. Der Anteil am
 * Neupreis liegt unter dem einer Hauptuntersuchung — repariert wird ein Schaden,
 * nicht das Fahrzeug.
 */
export function repairCost(vehicle: Vehicle, purchasePrice: Money, days: number): Money {
  const severity = Math.min(1, Math.max(0, days) / 20)
  return Math.round(purchasePrice * vehicle.units * (0.012 + 0.05 * severity))
}

/** Alterung pro Betriebstag. Ein Bus ist nach rund 15 Jahren durch. */
export const CONDITION_LOSS_PER_DAY = 1 / (15 * 365)

export function ageVehicle(vehicle: Vehicle): Vehicle {
  return { ...vehicle, condition: Math.max(0, vehicle.condition - CONDITION_LOSS_PER_DAY) }
}

/**
 * Verwaltung, Vertrieb und Disposition. Ohne diesen Posten waere jede Linie
 * absurd profitabel: Kraftstoff und Personal alleine decken nur den Fahrbetrieb
 * ab, nicht den Apparat drumherum. Als Anteil am Fahrgelderloes modelliert,
 * weil er real mit dem Verkaufsvolumen skaliert.
 */
export const ADMIN_COST_RATE = 0.18

/** Fixer Aufwand je betriebener Linie und Tag: Disposition, Haltestellenentgelte. */
export const LINE_OVERHEAD_PER_DAY: Money = 8_000

export function adminCost(ticketRevenue: Money): Money {
  return Math.round(ticketRevenue * ADMIN_COST_RATE)
}
