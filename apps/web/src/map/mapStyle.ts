import type { SourceSpecification, StyleSpecification } from 'maplibre-gl'
import { THEME, type Tone } from '../theme.js'

/**
 * Basiskarten.
 *
 * „Schlicht" ist der reduzierte Spielstil: nur Landflächen und Grenzen, damit
 * das eigene Netz die visuelle Hauptrolle behält. Für Planung reicht das oft
 * nicht - wer eine Trasse legt, will Flüsse, Gebirge, Wälder und bestehende
 * Bahnstrecken sehen. Dafür gibt es die OSM-Stile.
 *
 * Quelle der OSM-Stile ist OpenFreeMap: vollständige OpenStreetMap-Vektorkacheln,
 * ohne API-Schlüssel und ohne Nutzungslimit. Die Kachelserver der OSM Foundation
 * selbst dürfen für so etwas ausdrücklich nicht verwendet werden.
 */

const DEMO_TILES = 'https://demotiles.maplibre.org/tiles/tiles.json'
const OPENFREEMAP_STYLE = (name: string): string => `https://tiles.openfreemap.org/styles/${name}`

/**
 * Lokal zwischengespeicherter OSM-Stil aus `pnpm data:osm`. Ersetzt den
 * farbigen OSM-Stil, damit die Entwicklung ohne Netzwerk funktioniert.
 */
const localOsmStyle = import.meta.env['VITE_OSM_STYLE']
const osmStyle = (name: string): string =>
  name === 'liberty' && typeof localOsmStyle === 'string' && localOsmStyle.length > 0
    ? localOsmStyle
    : OPENFREEMAP_STYLE(name)

/**
 * Lokaler Kachelcache aus `pnpm data:basemap`, falls gesetzt. Damit läuft die
 * Entwicklung ohne Netzwerk - und Phase 5 tauscht hier nur die Quelle gegen
 * ein selbst erzeugtes europe.pmtiles.
 */
const localTiles = import.meta.env['VITE_BASEMAP_TILES']

const plainSource: SourceSpecification =
  typeof localTiles === 'string' && localTiles.length > 0
    ? // Nicht über new URL() normalisieren - das würde die {z}/{x}/{y}-Platzhalter
      // prozentkodieren und MapLibre könnte sie nicht mehr ersetzen.
      { type: 'vector', tiles: [`${window.location.origin}${localTiles}`], maxzoom: 6 }
    : { type: 'vector', url: DEMO_TILES }

export const PLAIN_STYLE: StyleSpecification = {
  version: 8,
  name: 'rail-and-road-plain',
  sources: { basemap: plainSource },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': THEME.water } },
    {
      id: 'land',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'countries',
      paint: { 'fill-color': THEME.land },
    },
    {
      id: 'land-border',
      type: 'line',
      source: 'basemap',
      'source-layer': 'countries',
      paint: {
        'line-color': THEME.border,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 8, 1.2],
      },
    },
  ],
  // Bewusst ohne `glyphs`: der Stil hat keine Symbol-Layer, die Beschriftung
  // kommt aus deck.gl.
}

export interface Basemap {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly tone: Tone
  readonly style: StyleSpecification | string
  /** Braucht diese Karte eine Netzverbindung? */
  readonly online: boolean
}

export const BASEMAPS: readonly Basemap[] = [
  {
    id: 'plain',
    label: 'Schlicht',
    hint: 'Nur Land und Grenzen — das eigene Netz steht im Vordergrund',
    tone: 'dark',
    style: PLAIN_STYLE,
    online: typeof localTiles !== 'string' || localTiles.length === 0,
  },
  {
    id: 'liberty',
    label: 'OSM farbig',
    hint: 'Vollständige OpenStreetMap: Straßen, Bahnstrecken, Wälder, Gewässer, Gebäude',
    tone: 'light',
    style: osmStyle('liberty'),
    online: typeof localOsmStyle !== 'string' || localOsmStyle.length === 0,
  },
  {
    id: 'positron',
    label: 'OSM hell',
    hint: 'OpenStreetMap zurückhaltend in Grau — gute Lesbarkeit für die Netzplanung',
    tone: 'light',
    style: osmStyle('positron'),
    online: true,
  },
  {
    id: 'dark',
    label: 'OSM dunkel',
    hint: 'OpenStreetMap in Dunkel — voller Detailgrad, gedämpfte Farben',
    tone: 'dark',
    style: osmStyle('dark'),
    online: true,
  },
]

export const DEFAULT_BASEMAP = BASEMAPS[0]!.id

export function basemapById(id: string): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]!
}

/** Erlaubt es, den schlichten Stil per Umgebungsvariable komplett zu ersetzen. */
function styleRef(basemap: Basemap): StyleSpecification | string {
  const override = import.meta.env['VITE_MAP_STYLE']
  if (basemap.id === 'plain' && typeof override === 'string' && override.length > 0) return override
  return basemap.style
}

/**
 * Lädt den Stil und macht seine Verweise absolut.
 *
 * MapLibre besteht bei `sprite` auf einer absoluten URL und bricht sonst das
 * Laden des gesamten Stils ab - die Karte bliebe leer. Ein lokal
 * zwischengespeicherter Stil kennt zur Erzeugungszeit aber den späteren Host
 * nicht, deshalb wird hier gegen den aktuellen Ursprung aufgelöst.
 */
export async function loadStyle(basemap: Basemap): Promise<StyleSpecification | string> {
  const ref = styleRef(basemap)
  if (typeof ref !== 'string' || !ref.startsWith('/')) return ref

  const res = await fetch(ref)
  if (!res.ok) throw new Error(`Kartenstil ${ref} nicht ladbar: HTTP ${res.status}`)
  const style = (await res.json()) as StyleSpecification

  const absolute = (url: string): string => (url.startsWith('/') ? `${window.location.origin}${url}` : url)

  if (typeof style.sprite === 'string') style.sprite = absolute(style.sprite)
  if (typeof style.glyphs === 'string') style.glyphs = absolute(style.glyphs)
  for (const source of Object.values(style.sources)) {
    if ('tiles' in source && Array.isArray(source.tiles)) source.tiles = source.tiles.map(absolute)
    if ('url' in source && typeof source.url === 'string') source.url = absolute(source.url)
  }

  return style
}

/**
 * Blendet die Ortsbeschriftung der Basiskarte aus.
 *
 * Sonst steht jeder Stadtname doppelt auf der Karte: einmal von OpenStreetMap,
 * einmal vom Spiel. Die Spielbeschriftung bleibt, weil nur sie zeigt, welche
 * Orte überhaupt bespielbar sind - OSM beschriftet auch jedes Dorf.
 *
 * Der Filter greift am `source-layer` und nicht an Layer-Namen: das OpenMapTiles-
 * Schema ist über alle Stile hinweg gleich, die Layer-Benennung nicht.
 */
export function hidePlaceLabels(map: {
  getStyle: () => StyleSpecification
  setLayoutProperty: (id: string, name: string, value: unknown) => void
}): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue
    if ((layer as { 'source-layer'?: string })['source-layer'] !== 'place') continue
    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none')
    } catch {
      // Ein Stil ohne diesen Layer ist kein Fehler.
    }
  }
}
