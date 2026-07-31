/**
 * Pipeline-Schritt 03: lokaler Basiskarten-Cache.
 *
 *   pnpm data:basemap                  # Bayern
 *   pnpm data:basemap -- --region=dach
 *
 * Laedt die Vektorkacheln der Region einmal herunter, damit die Entwicklung ohne
 * Netzwerk funktioniert. Gleichzeitig ist das die Generalprobe fuer Phase 5: dort
 * wird dieselbe Quelle gegen ein selbst erzeugtes europe.pmtiles getauscht
 * (siehe docs/05-DATENPIPELINE.md Abschnitt 3), die App aendert sich dabei nicht.
 *
 * Nutzung:  VITE_BASEMAP_TILES=/seed/basemap/{z}/{x}/{y}.pbf pnpm dev
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRegion } from './regions.js'

const TILE_URL = 'https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf'
/** Die Demokacheln enden bei Zoom 6; darueber ueberzoomt MapLibre selbst. */
const MAX_ZOOM = 6

const here = dirname(fileURLToPath(import.meta.url))
const outRoot = join(here, '..', '..', '..', 'data', 'seed', 'basemap')

const lngToX = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z)
const latToY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

async function main(): Promise<void> {
  const regionArg = process.argv.slice(2).find((a) => a.startsWith('--region='))
  const region = resolveRegion(regionArg?.slice('--region='.length))

  // Grosszuegiger Rahmen um die Startansicht, damit Herausscrollen nicht ins Leere laeuft.
  const [centreLng, centreLat] = region.view.centre
  const pad = 14
  const bounds = {
    west: centreLng - pad,
    east: centreLng + pad,
    south: centreLat - pad * 0.7,
    north: centreLat + pad * 0.7,
  }

  console.log(`Basiskarte fuer ${region.label}, Zoom 0-${MAX_ZOOM}`)
  let downloaded = 0
  let cached = 0
  let missing = 0

  for (let z = 0; z <= MAX_ZOOM; z++) {
    const xMin = Math.max(0, lngToX(bounds.west, z))
    const xMax = Math.min(2 ** z - 1, lngToX(bounds.east, z))
    const yMin = Math.max(0, latToY(bounds.north, z))
    const yMax = Math.min(2 ** z - 1, latToY(bounds.south, z))

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const path = join(outRoot, String(z), String(x), `${y}.pbf`)
        if (existsSync(path)) {
          cached++
          continue
        }

        const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
        const res = await fetch(url)
        if (!res.ok) {
          // Leere Kacheln liefern 404 - das ist normal und kein Fehler.
          missing++
          continue
        }
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, Buffer.from(await res.arrayBuffer()))
        downloaded++
      }
    }
  }

  console.log(`  ${downloaded} geladen, ${cached} bereits vorhanden, ${missing} leer`)
  console.log(`  -> ${outRoot}`)
  console.log('\n  Verwenden mit:')
  console.log('    VITE_BASEMAP_TILES=/seed/basemap/{z}/{x}/{y}.pbf pnpm dev')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
