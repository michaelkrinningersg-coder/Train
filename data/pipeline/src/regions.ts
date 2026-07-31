/**
 * Ausbaustufen des Datensatzes, siehe docs/05-DATENPIPELINE.md Abschnitt 8.
 * Die Pipeline ist fuer alle Stufen identisch, nur der Ausschnitt waechst.
 * Klein anfangen spart in der Entwicklung sehr viel Wartezeit.
 */
export interface Region {
  readonly id: string
  readonly label: string
  /** ISO-3166-alpha-2 Laendercodes, je einer GeoNames-Datei entsprechend. */
  readonly countries: readonly string[]
  /** Optionale Einschraenkung auf GeoNames-admin1-Codes je Land. */
  readonly admin1?: Readonly<Record<string, readonly string[]>>
  readonly minPopulation: number
  /** Startansicht der Karte. */
  readonly view: { readonly centre: readonly [number, number]; readonly zoom: number }
}

export const REGIONS: Readonly<Record<string, Region>> = {
  bavaria: {
    id: 'bavaria',
    label: 'Bayern',
    countries: ['DE'],
    admin1: { DE: ['02'] },
    minPopulation: 20_000,
    view: { centre: [11.4, 48.9], zoom: 6.6 },
  },
  dach: {
    id: 'dach',
    label: 'DACH',
    countries: ['DE', 'AT', 'CH'],
    minPopulation: 20_000,
    view: { centre: [10.5, 48.5], zoom: 5.4 },
  },
  central_europe: {
    id: 'central_europe',
    label: 'Mitteleuropa',
    countries: ['DE', 'AT', 'CH', 'CZ', 'PL', 'SK', 'HU', 'NL', 'BE', 'LU', 'DK', 'FR', 'IT', 'SI'],
    minPopulation: 20_000,
    view: { centre: [10.0, 48.0], zoom: 4.4 },
  },
}

export function resolveRegion(id: string | undefined): Region {
  const region = REGIONS[id ?? 'bavaria']
  if (!region) {
    throw new Error(`Unbekannte Region '${id}'. Verfuegbar: ${Object.keys(REGIONS).join(', ')}`)
  }
  return region
}
