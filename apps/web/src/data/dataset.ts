import type { City } from '@game/domain'
import type { BBox } from '@game/geo'
import { useEffect, useState } from 'react'

export interface CityDataset {
  readonly region: string
  readonly label: string
  readonly generatedFrom: string
  readonly minPopulation: number
  readonly view: { readonly centre: readonly [number, number]; readonly zoom: number }
  readonly bbox: BBox | null
  readonly cities: readonly City[]
}

export type DatasetState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: CityDataset }
  | { readonly status: 'error'; readonly message: string }

/**
 * Laedt den Staedtedatensatz zur Laufzeit (siehe vite-plugin-seed.ts).
 * Der Regionswechsel Bayern -> DACH -> Europa ist damit ein reiner Datentausch.
 */
export function useCityDataset(region: string): DatasetState {
  const [state, setState] = useState<DatasetState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    fetch(`/seed/cities.${region}.json`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as CityDataset
      })
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const hint = `Datensatz '${region}' nicht gefunden. Erst 'pnpm data:cities' ausfuehren.`
        setState({ status: 'error', message: `${hint} (${String(err)})` })
      })

    return () => controller.abort()
  }, [region])

  return state
}
