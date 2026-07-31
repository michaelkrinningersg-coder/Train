import type { BusClass } from './fleet.js'

/**
 * Buskatalog. Preise in Cent.
 *
 * `fuelCostPerKm` ist bewusst mehr als nur Kraftstoff: Reifen, Wartung und
 * Verschleiss haengen ebenfalls an der Fahrleistung. `crewCostPerHour` ist der
 * Arbeitgeberaufwand inklusive Lohnnebenkosten, nicht der Bruttolohn.
 * `upkeepPerDay` deckt Versicherung, Steuer, Betriebshof und Werkstattvorhaltung. Die Werte sind an reale Groessenordnungen
 * angelehnt und bewusst so gespreizt, dass es keine dominante Wahl gibt:
 * der Kleinbus hat den besten Sitzplatzpreis bei kleiner Nachfrage, der
 * Doppelstockbus die niedrigsten Kosten je Sitzplatz bei voller Auslastung,
 * der Reisebus den Komfort, den Geschaeftsreisende honorieren.
 */
export const BUS_CLASSES: readonly BusClass[] = [
  {
    id: 'minibus',
    displayName: 'Kleinbus',
    seats: 22,
    comfort: 0.35,
    topSpeedKmh: 90,
    purchasePrice: 8_500_000,
    upkeepPerDay: 6_000,
    fuelCostPerKm: 35,
    crewCostPerHour: 3_600,
    availableFrom: 1970,
  },
  {
    id: 'citybus',
    displayName: 'Linienbus',
    seats: 45,
    comfort: 0.4,
    topSpeedKmh: 80,
    purchasePrice: 18_000_000,
    upkeepPerDay: 11_000,
    fuelCostPerKm: 60,
    crewCostPerHour: 3_800,
    availableFrom: 1970,
  },
  {
    id: 'intercity',
    displayName: 'Überlandbus',
    seats: 49,
    comfort: 0.65,
    topSpeedKmh: 100,
    purchasePrice: 24_000_000,
    upkeepPerDay: 13_000,
    fuelCostPerKm: 65,
    crewCostPerHour: 3_800,
    availableFrom: 1980,
  },
  {
    id: 'coach',
    displayName: 'Reisebus',
    seats: 55,
    comfort: 0.8,
    topSpeedKmh: 100,
    purchasePrice: 32_000_000,
    upkeepPerDay: 16_000,
    fuelCostPerKm: 70,
    crewCostPerHour: 4_000,
    availableFrom: 1990,
  },
  {
    id: 'doubledecker',
    displayName: 'Doppelstockbus',
    seats: 80,
    comfort: 0.85,
    topSpeedKmh: 100,
    purchasePrice: 48_000_000,
    upkeepPerDay: 21_000,
    fuelCostPerKm: 85,
    crewCostPerHour: 4_200,
    availableFrom: 2000,
  },
]

export const busClass = (id: string): BusClass | undefined => BUS_CLASSES.find((b) => b.id === id)

export const availableBuses = (year: number): readonly BusClass[] =>
  BUS_CLASSES.filter((b) => year >= b.availableFrom)

/** Busse fahren langsamer als Autos: Beschleunigung, Haltestellen, Lenkzeiten. */
export const BUS_TIME_FACTOR = 1.15
/** Aufenthalt je Halt in Sekunden. */
export const BUS_DWELL_SEC = 120
