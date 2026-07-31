import type { GameTime, Money, PatternId, VehicleId } from './ids.js'

export type Traction = 'electric' | 'diesel' | 'bimodal'

export interface TrainClass {
  readonly id: string
  readonly displayName: string
  readonly traction: Traction
  readonly topSpeedKmh: number
  readonly accelMs2: number
  readonly brakeMs2: number
  readonly seats: { readonly first: number; readonly second: number }
  /** 0..1, geht als Komfortnutzen ins Logit-Modell. */
  readonly comfort: number
  readonly lengthM: number
  /** Relatives Gewicht fuer den Steigungsfaktor, 1,0 = leichter Triebwagen. */
  readonly massFactor: number
  readonly purchasePrice: Money
  readonly upkeepPerDay: Money
  readonly energyCostPerKm: Money
  readonly crewCostPerHour: Money
  readonly availableFrom: number
  readonly availableUntil?: number
}

export interface BusClass {
  readonly id: string
  readonly displayName: string
  readonly seats: number
  readonly comfort: number
  readonly topSpeedKmh: number
  readonly purchasePrice: Money
  readonly upkeepPerDay: Money
  readonly fuelCostPerKm: Money
  readonly crewCostPerHour: Money
  readonly availableFrom: number
}

export interface Vehicle {
  readonly id: VehicleId
  readonly classId: string
  readonly mode: 'rail' | 'bus'
  /** Mehrfachtraktion: 2 Einheiten = doppelte Sitzplaetze und doppelte Kosten. */
  readonly units: number
  readonly boughtAt: GameTime
  /** 1,0 neu bis 0,0 schrottreif. Beeinflusst Unterhalt und Stoeranfaelligkeit. */
  readonly condition: number
  readonly assignedPatternId?: PatternId
  /**
   * Im Werk bis zu diesem Spieltag — solange faehrt das Fahrzeug nicht.
   *
   * Es bleibt seiner Linie zugeteilt: wer es abzieht und spaeter wieder
   * zuteilt, hat nichts gewonnen. Die Linie faehrt einfach mit einem Fahrzeug
   * weniger, also duenneren Takt — es sei denn, der Spieler hat ein
   * Ersatzfahrzeug und tauscht es ein.
   */
  readonly inWorkshopUntil?: number
}

/** Faehrt dieses Fahrzeug an diesem Tag? */
export function isAvailable(vehicle: Vehicle, day: number): boolean {
  return vehicle.inWorkshopUntil === undefined || day >= vehicle.inWorkshopUntil
}

export function totalSeats(cls: TrainClass, units: number): number {
  return (cls.seats.first + cls.seats.second) * units
}

/** Ein E-Zug kann eine nicht elektrifizierte Strecke nicht befahren. */
export function canTraverse(traction: Traction, electrified: boolean): boolean {
  if (electrified) return true
  return traction !== 'electric'
}
