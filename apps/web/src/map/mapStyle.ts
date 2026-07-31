import type { SourceSpecification, StyleSpecification } from 'maplibre-gl'
import { THEME } from '../theme.js'

/**
 * Basiskartenstil. Bewusst extrem reduziert: Landflaechen, Wasser, Grenzen.
 * Die Karte ist Kontext, nicht Inhalt - das Spielnetz muss die visuelle
 * Hauptrolle behalten.
 *
 * Quelle sind die MapLibre-Demokacheln. Fuer Phase 5 wird das gegen ein selbst
 * erzeugtes europe.pmtiles getauscht (siehe docs/05-DATENPIPELINE.md Abschnitt 3);
 * dafuer genuegt es, VITE_MAP_STYLE zu setzen oder hier die Quelle zu ersetzen.
 */
const DEMO_TILES = 'https://demotiles.maplibre.org/tiles/tiles.json'

/**
 * Lokaler Kachelcache aus `pnpm data:basemap`, falls gesetzt. Damit laeuft die
 * Entwicklung ohne Netzwerk - und Phase 5 tauscht hier nur die Quelle gegen
 * das selbst erzeugte europe.pmtiles.
 */
const localTiles = import.meta.env['VITE_BASEMAP_TILES']

const basemapSource: SourceSpecification =
  typeof localTiles === 'string' && localTiles.length > 0
    ? // Nicht ueber new URL() normalisieren - das wuerde die {z}/{x}/{y}-Platzhalter
      // prozentkodieren und MapLibre koennte sie nicht mehr ersetzen.
      { type: 'vector', tiles: [`${window.location.origin}${localTiles}`], maxzoom: 6 }
    : { type: 'vector', url: DEMO_TILES }

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  name: 'rail-and-road-dark',
  sources: {
    basemap: basemapSource,
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': THEME.water },
    },
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
  // kommt aus deck.gl. Ein Glyphen-Endpunkt wuerde nur ins Leere laufen.
}

/**
 * Faellt die Kachelquelle aus, bleibt der Hintergrund in Wasserfarbe stehen und
 * die Spieldaten bleiben lesbar. Bewusst ohne automatischen Stilwechsel: ein
 * einzelner fehlgeschlagener Kachel-Request darf nicht die ganze Basiskarte
 * abschalten.
 */
export function resolveStyle(): StyleSpecification | string {
  const override = import.meta.env['VITE_MAP_STYLE']
  return typeof override === 'string' && override.length > 0 ? override : BASE_STYLE
}
