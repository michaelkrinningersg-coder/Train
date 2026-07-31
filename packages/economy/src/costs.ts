import { busClass, cityRadiusKm } from '@game/domain'
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

/** Taeglicher Unterhalt eines Fahrzeugs. Alte Fahrzeuge kosten mehr. */
export function vehicleUpkeepPerDay(vehicle: Vehicle): Money {
  const cls = busClass(vehicle.classId)
  if (!cls) return 0
  // Bei Zustand 1,0 der Katalogwert, bei 0,0 das Doppelte.
  const wearFactor = 2 - Math.max(vehicle.condition, 0)
  return Math.round(cls.upkeepPerDay * vehicle.units * wearFactor)
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
