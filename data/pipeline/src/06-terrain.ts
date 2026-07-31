/**
 * Pipeline-Schritt 06: Höhenraster der Region.
 *
 *   pnpm data:terrain [-- --region=dach]
 *
 * Quelle sind die frei zugänglichen Terrain-Kacheln von AWS (terrarium-Kodierung,
 * abgeleitet aus SRTM und weiteren offenen Höhenmodellen). Sie werden einmal
 * heruntergeladen und auf ein regelmäßiges Lat/Lng-Raster heruntergerechnet.
 *
 * Warum ein eigenes Raster statt der Kacheln direkt: das Spiel braucht beim
 * Ziehen einer Trasse hunderte Höhenabfragen pro Sekunde. Ein flaches
 * Int16-Array im Speicher beantwortet die in Nanosekunden, Kachel-Dekodierung
 * nicht.
 *
 * Ausgabe:
 *   data/seed/elevation.<region>.json   Metadaten des Rasters
 *   data/seed/elevation.<region>.bin    Höhen in Metern als Int16 (little endian)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { resolveRegion } from './regions.js'

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const ZOOM = 9
const TILE_SIZE = 256
/** Rasterweite in Grad. Rund 900 m in der Breite, 600 m in der Länge bei 48° Nord. */
const STEP_DEG = 0.008
/** Kein Datenwert - Meere und Lücken. */
const NO_DATA = -32768

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, '..', '.cache', 'terrain')
const seedDir = join(here, '..', '..', '..', 'data', 'seed')

const lngToTileX = (lng: number, z: number): number => ((lng + 180) / 360) * 2 ** z
const latToTileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}

/** terrarium: Höhe in Metern = (R * 256 + G + B / 256) - 32768. */
const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768

async function fetchTile(z: number, x: number, y: number): Promise<PNG | null> {
  const path = join(cacheDir, `${z}-${x}-${y}.png`)
  let buffer: Buffer

  if (existsSync(path)) {
    buffer = await readFile(path)
  } else {
    const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    const res = await fetch(url)
    if (!res.ok) return null
    buffer = Buffer.from(await res.arrayBuffer())
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path, buffer)
  }

  return PNG.sync.read(buffer)
}

async function main(): Promise<void> {
  const regionArg = process.argv.slice(2).find((a) => a.startsWith('--region='))
  const region = resolveRegion(regionArg?.slice('--region='.length))

  // Das Raster deckt nur ab, wo gebaut werden kann - also die Staedte plus
  // etwas Rand. Ein Rahmen um die Startansicht waere um ein Vielfaches groesser
  // und bestuende groesstenteils aus Meer und Nachbarlaendern.
  const citiesPath = join(seedDir, `cities.${region.id}.json`)
  if (!existsSync(citiesPath)) {
    throw new Error(`${citiesPath} fehlt. Erst 'pnpm data:cities' ausfuehren.`)
  }
  const cityData = JSON.parse(await readFile(citiesPath, 'utf8')) as {
    bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null
  }
  if (!cityData.bbox) throw new Error('Der Staedtedatensatz hat keine Bounding-Box.')

  const pad = 0.6
  const bounds = {
    west: cityData.bbox.minLng - pad,
    east: cityData.bbox.maxLng + pad,
    south: cityData.bbox.minLat - pad,
    north: cityData.bbox.maxLat + pad,
  }

  const cols = Math.ceil((bounds.east - bounds.west) / STEP_DEG)
  const rows = Math.ceil((bounds.north - bounds.south) / STEP_DEG)
  console.log(`Höhenraster für ${region.label}: ${cols} × ${rows} Punkte (${STEP_DEG}° Schrittweite)`)

  const xMin = Math.floor(lngToTileX(bounds.west, ZOOM))
  const xMax = Math.floor(lngToTileX(bounds.east, ZOOM))
  const yMin = Math.floor(latToTileY(bounds.north, ZOOM))
  const yMax = Math.floor(latToTileY(bounds.south, ZOOM))
  const tileCount = (xMax - xMin + 1) * (yMax - yMin + 1)
  console.log(`  ${tileCount} Kacheln auf Zoom ${ZOOM}`)

  const grid = new Int16Array(cols * rows).fill(NO_DATA)
  let loaded = 0
  let missing = 0

  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      const png = await fetchTile(ZOOM, tx, ty)
      if (!png) {
        missing++
        continue
      }
      loaded++
      if (loaded % 16 === 0) process.stdout.write(`  ${loaded}/${tileCount}\r`)

      // Jedes Kachelpixel in die passende Rasterzelle schreiben. Fallen mehrere
      // Pixel in dieselbe Zelle, gewinnt das letzte - bei dieser Aufloesung
      // unerheblich und deutlich schneller als eine Mittelung.
      for (let py = 0; py < TILE_SIZE; py++) {
        const worldY = (ty + py / TILE_SIZE) / 2 ** ZOOM
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI
        const row = Math.round((bounds.north - lat) / STEP_DEG)
        if (row < 0 || row >= rows) continue

        for (let px = 0; px < TILE_SIZE; px++) {
          const lng = ((tx + px / TILE_SIZE) / 2 ** ZOOM) * 360 - 180
          const col = Math.round((lng - bounds.west) / STEP_DEG)
          if (col < 0 || col >= cols) continue

          const i = (py * TILE_SIZE + px) * 4
          const height = decodeTerrarium(png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0)
          grid[row * cols + col] = Math.round(height)
        }
      }
    }
  }

  // Bewusst als Schleife und nicht ueber Math.min(...grid): der Spread-Operator
  // sprengt bei hunderttausenden Werten den Aufrufstapel.
  let filled = 0
  let lowest = Number.POSITIVE_INFINITY
  let highest = Number.NEGATIVE_INFINITY
  for (const v of grid) {
    if (v === NO_DATA) continue
    filled++
    if (v < lowest) lowest = v
    if (v > highest) highest = v
  }
  console.log(
    `\n  ${loaded} Kacheln gelesen, ${missing} fehlten · ` +
      `${((filled / grid.length) * 100).toFixed(1)} % des Rasters belegt · ` +
      `${lowest} bis ${highest} m`,
  )

  await mkdir(seedDir, { recursive: true })
  const meta = {
    region: region.id,
    bounds,
    cols,
    rows,
    stepDeg: STEP_DEG,
    noData: NO_DATA,
    source: 'AWS Terrain Tiles (terrarium), abgeleitet aus SRTM und weiteren offenen Höhenmodellen',
  }
  await writeFile(join(seedDir, `elevation.${region.id}.json`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await writeFile(join(seedDir, `elevation.${region.id}.bin`), Buffer.from(grid.buffer))

  console.log(`  -> data/seed/elevation.${region.id}.{json,bin} (${(grid.byteLength / 1024).toFixed(0)} KB)`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
