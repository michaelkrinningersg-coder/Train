import type { TrainClass } from './fleet.js'

/**
 * Zugkatalog. Preise in Cent.
 *
 * Die technischen Kennwerte sind an reale Baureihen angelehnt — Höchst-
 * geschwindigkeit, Sitzplatzzahl, Beschleunigung und Baujahr sind Tatsachen und
 * unproblematisch. Die Anzeigenamen sind bewusst generisch: Baureihen­marken,
 * Logos und Lackierungen sind geschützt, die Fahrzeugdaten nicht.
 *
 * `massFactor` steuert, wie stark eine Steigung den Zug bremst: ein leichter
 * Triebwagen kommt den Berg deutlich besser hoch als ein lokbespannter Zug.
 */
export const TRAIN_CLASSES: readonly TrainClass[] = [
  {
    id: 'dmu_light',
    displayName: 'Dieseltriebwagen, leicht',
    traction: 'diesel',
    topSpeedKmh: 100,
    accelMs2: 0.7,
    brakeMs2: 0.9,
    seats: { first: 0, second: 68 },
    comfort: 0.35,
    lengthM: 27,
    massFactor: 0.8,
    purchasePrice: 1_600_000_00,
    upkeepPerDay: 42_000,
    energyCostPerKm: 210,
    crewCostPerHour: 5_200,
    availableFrom: 1955,
  },
  {
    id: 'dmu_regional',
    displayName: 'Dieseltriebzug, Nahverkehr',
    traction: 'diesel',
    topSpeedKmh: 140,
    accelMs2: 1.0,
    brakeMs2: 1.1,
    seats: { first: 12, second: 168 },
    comfort: 0.55,
    lengthM: 56,
    massFactor: 0.95,
    purchasePrice: 4_200_000_00,
    upkeepPerDay: 78_000,
    energyCostPerKm: 260,
    crewCostPerHour: 5_600,
    availableFrom: 1996,
  },
  {
    id: 'emu_regional',
    displayName: 'Elektrotriebzug, Nahverkehr',
    traction: 'electric',
    topSpeedKmh: 140,
    accelMs2: 1.1,
    brakeMs2: 1.1,
    seats: { first: 16, second: 190 },
    comfort: 0.6,
    lengthM: 68,
    massFactor: 0.9,
    purchasePrice: 5_600_000_00,
    upkeepPerDay: 82_000,
    energyCostPerKm: 145,
    crewCostPerHour: 5_600,
    availableFrom: 1994,
  },
  {
    id: 'push_pull_double',
    displayName: 'Doppelstockzug, lokbespannt',
    traction: 'electric',
    topSpeedKmh: 140,
    accelMs2: 0.55,
    brakeMs2: 0.9,
    seats: { first: 60, second: 460 },
    comfort: 0.6,
    lengthM: 155,
    massFactor: 1.5,
    purchasePrice: 9_800_000_00,
    upkeepPerDay: 138_000,
    energyCostPerKm: 260,
    crewCostPerHour: 7_400,
    availableFrom: 1976,
  },
  {
    id: 'loco_coaches',
    displayName: 'Elektrolok mit Reisezugwagen',
    traction: 'electric',
    topSpeedKmh: 160,
    accelMs2: 0.5,
    brakeMs2: 0.85,
    seats: { first: 78, second: 300 },
    comfort: 0.7,
    lengthM: 180,
    massFactor: 1.6,
    purchasePrice: 8_600_000_00,
    upkeepPerDay: 126_000,
    energyCostPerKm: 250,
    crewCostPerHour: 7_400,
    availableFrom: 1965,
  },
  {
    id: 'tilting',
    displayName: 'Neigetechnik-Triebzug',
    traction: 'bimodal',
    topSpeedKmh: 200,
    accelMs2: 0.9,
    brakeMs2: 1.0,
    seats: { first: 40, second: 160 },
    comfort: 0.75,
    lengthM: 107,
    massFactor: 1.0,
    purchasePrice: 12_400_000_00,
    upkeepPerDay: 168_000,
    energyCostPerKm: 290,
    crewCostPerHour: 7_800,
    availableFrom: 1997,
  },
  {
    id: 'hst_250',
    displayName: 'Hochgeschwindigkeitszug, 250 km/h',
    traction: 'electric',
    topSpeedKmh: 250,
    accelMs2: 0.6,
    brakeMs2: 0.9,
    seats: { first: 130, second: 500 },
    comfort: 0.9,
    lengthM: 358,
    massFactor: 1.4,
    purchasePrice: 26_000_000_00,
    upkeepPerDay: 320_000,
    energyCostPerKm: 480,
    crewCostPerHour: 11_000,
    availableFrom: 1991,
  },
  {
    id: 'hst_300',
    displayName: 'Hochgeschwindigkeitszug, 300 km/h',
    traction: 'electric',
    topSpeedKmh: 300,
    accelMs2: 0.65,
    brakeMs2: 0.95,
    seats: { first: 110, second: 330 },
    comfort: 0.95,
    lengthM: 200,
    massFactor: 1.2,
    purchasePrice: 31_000_000_00,
    upkeepPerDay: 360_000,
    energyCostPerKm: 560,
    crewCostPerHour: 11_500,
    availableFrom: 2000,
  },
]

export const trainClass = (id: string): TrainClass | undefined => TRAIN_CLASSES.find((t) => t.id === id)

export const availableTrains = (year: number): readonly TrainClass[] =>
  TRAIN_CLASSES.filter((t) => year >= t.availableFrom && (t.availableUntil === undefined || year <= t.availableUntil))

/** Fahrzeitreserve im Fahrplan. Ohne sie klingt keine Verspätung je ab. */
export const DEFAULT_RUNTIME_RESERVE_RAIL = 1.07

/** Aufenthalt an einem Unterwegshalt. */
export const RAIL_DWELL_SEC = 60
/** Wendezeit an einem Linienende. */
export const RAIL_TURNAROUND_SEC = 600

/**
 * Steigungsfaktor: schwere Züge verlieren am Berg.
 * Siehe docs/04-BETRIEBSSIMULATION.md Abschnitt 1.
 */
export function gradientFactor(gradientPermille: number, massFactor: number): number {
  return Math.max(0.6, 1 / (1 + (gradientPermille * massFactor) / 40))
}
