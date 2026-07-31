import { createReadStream, existsSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/**
 * Liefert data/seed unter /seed aus - im Dev-Server als Middleware, im Build als Kopie.
 *
 * Warum kein statischer JSON-Import: der Europa-Datensatz wird mehrere Megabyte gross
 * und hat im JS-Bundle nichts zu suchen. Als Fetch-Ressource ist er zusaetzlich
 * zur Laufzeit austauschbar, was den Regionswechsel (Bayern -> DACH -> Europa)
 * ohne Rebuild ermoeglicht.
 */

/**
 * Verzeichnisse, die nur die Entwicklung offline-faehig machen und im Build
 * nichts verloren haben.
 *
 * Der OSM-Kachelcache allein ist 95 MB — er lag bis hierher vollstaendig im
 * ausgelieferten Verzeichnis, obwohl das Spiel seine Kacheln im Betrieb von
 * OpenFreeMap holt. Beide Verzeichnisse sind ausserdem in `.gitignore` und
 * jederzeit aus der Pipeline reproduzierbar.
 */
const DEV_ONLY = ['osm', 'basemap']

export function seedData(seedDir: string): Plugin {
  let config: ResolvedConfig

  return {
    name: 'game:seed-data',

    configResolved(resolved) {
      config = resolved
    },

    configureServer(server) {
      server.middlewares.use('/seed', (req, res, next) => {
        const requested = normalize(decodeURIComponent((req.url ?? '').split('?')[0] ?? ''))
        const filePath = resolve(seedDir, `.${requested}`)

        // Pfadausbruch verhindern - resolve() alleine reicht dafuer nicht.
        if (!filePath.startsWith(resolve(seedDir)) || !existsSync(filePath)) {
          next()
          return
        }

        const contentType = filePath.endsWith('.pbf')
          ? 'application/x-protobuf'
          : filePath.endsWith('.png')
            ? 'image/png'
            : filePath.endsWith('.bin')
              ? 'application/octet-stream'
              : 'application/json; charset=utf-8'
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(filePath).pipe(res)
      })
    },

    async closeBundle() {
      if (config.command !== 'build' || !existsSync(seedDir)) return
      await cp(seedDir, join(config.build.outDir, 'seed'), {
        recursive: true,
        filter: (source) => !DEV_ONLY.some((dir) => source.includes(`${sep}${dir}`)),
      })
    },
  }
}
