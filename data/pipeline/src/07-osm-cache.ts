/**
 * Pipeline-Schritt 07: OSM-Basiskarte lokal zwischenspeichern.
 *
 *   pnpm data:osm [-- --region=dach --style=liberty --maxzoom=10]
 *
 * Lädt einen OpenFreeMap-Stil samt Vektorkacheln, Schriften und Symbolen für die
 * Region herunter und schreibt ihn so um, dass alles aus dem eigenen /seed-Pfad
 * kommt. Damit funktioniert die Entwicklung ohne Netzwerk — und es ist zugleich
 * die Generalprobe für Phase 5, wo dieselbe Struktur aus einem selbst erzeugten
 * europe.pmtiles gespeist wird.
 *
 * Im Spiel aktivieren mit:
 *   VITE_OSM_STYLE=/seed/osm/<style>/style.json pnpm dev
 *
 * Ohne diesen Cache holt das Spiel die Kacheln direkt von OpenFreeMap. Das ist
 * der Normalfall und liefert den vollen Detailgrad bis zu den Gebäuden.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveRegion } from './regions.js'

const STYLE_URL = (name: string): string => `https://tiles.openfreemap.org/styles/${name}`

const here = dirname(fileURLToPath(import.meta.url))
const seedDir = join(here, '..', '..', '..', 'data', 'seed')

const lngToTileX = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z)
const latToTileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

interface StyleSpec {
  sources: Record<string, { url?: string; tiles?: string[]; type: string; maxzoom?: number }>
  glyphs?: string
  sprite?: string
  layers: { id: string; layout?: Record<string, unknown> }[]
}

async function download(url: string, target: string): Promise<Buffer | null> {
  if (existsSync(target)) return readFile(target)
  const res = await fetch(url)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buf)
  return buf
}

/** Alle im Stil verwendeten Schriftschnitte einsammeln. */
function fontstacks(style: StyleSpec): string[] {
  const found = new Set<string>()
  for (const layer of style.layers) {
    const fonts = layer.layout?.['text-font']
    if (Array.isArray(fonts)) found.add(fonts.join(','))
  }
  return [...found]
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined =>
    process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

  const region = resolveRegion(arg('region'))
  const styleName = arg('style') ?? 'liberty'
  const maxZoom = Number(arg('maxzoom') ?? 10)

  const citiesPath = join(seedDir, `cities.${region.id}.json`)
  if (!existsSync(citiesPath)) throw new Error(`${citiesPath} fehlt. Erst 'pnpm data:cities' ausführen.`)
  const cityData = JSON.parse(await readFile(citiesPath, 'utf8')) as {
    bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null
  }
  if (!cityData.bbox) throw new Error('Der Städtedatensatz hat keine Bounding-Box.')

  const pad = 0.8
  const bounds = {
    west: cityData.bbox.minLng - pad,
    east: cityData.bbox.maxLng + pad,
    south: cityData.bbox.minLat - pad,
    north: cityData.bbox.maxLat + pad,
  }

  const outDir = join(seedDir, 'osm', styleName)
  console.log(`OSM-Cache "${styleName}" für ${region.label}, Zoom 0-${maxZoom}`)

  const styleRes = await fetch(STYLE_URL(styleName))
  if (!styleRes.ok) throw new Error(`Stil nicht erreichbar: HTTP ${styleRes.status}`)
  const style = (await styleRes.json()) as StyleSpec

  // ── Vektorkacheln ────────────────────────────────────────────────────────
  const vectorSource = Object.entries(style.sources).find(([, s]) => s.type === 'vector')
  if (!vectorSource) throw new Error('Der Stil hat keine Vektorquelle.')
  const [sourceName, source] = vectorSource

  let tileTemplate = source.tiles?.[0]
  if (!tileTemplate && source.url) {
    const tj = (await (await fetch(source.url)).json()) as { tiles: string[] }
    tileTemplate = tj.tiles[0]
  }
  if (!tileTemplate) throw new Error('Keine Kachel-URL gefunden.')

  let tiles = 0
  let empty = 0
  for (let z = 0; z <= maxZoom; z++) {
    for (let x = lngToTileX(bounds.west, z); x <= lngToTileX(bounds.east, z); x++) {
      for (let y = latToTileY(bounds.north, z); y <= latToTileY(bounds.south, z); y++) {
        const url = tileTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
        const got = await download(url, join(outDir, 'tiles', String(z), String(x), `${y}.pbf`))
        if (got) tiles++
        else empty++
        if ((tiles + empty) % 50 === 0) process.stdout.write(`  ${tiles} Kacheln\r`)
      }
    }
  }
  console.log(`  ${tiles} Kacheln geladen, ${empty} leer          `)

  // ── Schriften ────────────────────────────────────────────────────────────
  let glyphCount = 0
  if (style.glyphs) {
    // Latin-1 und Latin Extended-A decken alle europäischen Ortsnamen ab.
    const ranges = ['0-255', '256-511']
    for (const stack of fontstacks(style)) {
      for (const range of ranges) {
        const url = style.glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range)
        const got = await download(url, join(outDir, 'fonts', stack, `${range}.pbf`))
        if (got) glyphCount++
      }
    }
  }
  console.log(`  ${glyphCount} Schriftbereiche`)

  // ── Symbole ──────────────────────────────────────────────────────────────
  let spriteCount = 0
  if (style.sprite) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      const got = await download(`${style.sprite}${suffix}`, join(outDir, `sprite${suffix}`))
      if (got) spriteCount++
    }
  }
  console.log(`  ${spriteCount} Symboldateien`)

  // ── Stil umschreiben ─────────────────────────────────────────────────────
  const base = `/seed/osm/${styleName}`
  const rewritten: StyleSpec = {
    ...style,
    sources: {
      ...style.sources,
      [sourceName]: {
        type: 'vector',
        tiles: [`${base}/tiles/{z}/{x}/{y}.pbf`],
        maxzoom: maxZoom,
        ...(source.url ? {} : {}),
      },
    },
    ...(style.glyphs ? { glyphs: `${base}/fonts/{fontstack}/{range}.pbf` } : {}),
    ...(style.sprite ? { sprite: `${base}/sprite` } : {}),
  }
  // Quellen ohne lokale Kacheln (etwa Natural-Earth-Reliefbilder) entfernen,
  // sonst laufen sie beim Rendern ins Leere.
  for (const [key, value] of Object.entries(rewritten.sources)) {
    if (key !== sourceName && value.type !== 'vector') delete rewritten.sources[key]
  }
  rewritten.layers = rewritten.layers.filter((l) => {
    const src = (l as { source?: string }).source
    return !src || src in rewritten.sources
  })

  await writeFile(join(outDir, 'style.json'), `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8')
  console.log(`\n  -> ${outDir}/style.json`)
  console.log('\n  Verwenden mit:')
  console.log(`    VITE_OSM_STYLE=/seed/osm/${styleName}/style.json pnpm dev`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
