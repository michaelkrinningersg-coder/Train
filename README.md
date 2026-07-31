# Rail & Road — Europäisches Transportimperium

Ein browserbasiertes Transport-Wirtschaftsspiel auf Basis einer OpenStreetMap-Karte von Europa.
Der Spieler baut Bahnstrecken, kauft reale Zugtypen, platziert Bahnhöfe, erstellt Fahrpläne und
konkurriert mit Buslinien auf der Straße um Passagiere.

## Kernideen

- **Echte Geografie**: Europa-Karte aus OSM, Städte mit realen Einwohnerzahlen und Einrichtungen.
- **Zwei Verkehrsträger**: Straße (Busse, Reisezeit aus echtem Straßenrouting) und Schiene
  (selbst gebautes Netz, das der Spieler ausbaut).
- **Nachfragemodell**: Gravitationsmodell je Reisendensegment (Pendler, Touristen,
  Geschäftsreisende, Schüler, Studenten …) mit unterschiedlicher Zahlungsbereitschaft.
- **Betriebssimulation**: Blockabschnitte, Fahrplan, Konflikterkennung, Verspätungsausbreitung.
  Wer zu dicht taktet, produziert Verspätungen — und muss ausbauen.

## Schnellstart

```bash
pnpm install
pnpm data:cities      # GeoNames -> data/seed/cities.bavaria.json (65 Staedte)
pnpm data:basemap     # optional: lokaler Kachelcache, macht die Entwicklung offline-faehig
pnpm dev              # http://localhost:5173
```

Mit lokalem Kachelcache:

```bash
VITE_BASEMAP_TILES='/seed/basemap/{z}/{x}/{y}.pbf' pnpm dev
```

Hinter einem Proxy braucht Node's `fetch` ein Flag: `NODE_USE_ENV_PROXY=1 pnpm data:cities`.

| Befehl | Wirkung |
|---|---|
| `pnpm dev` | Vite-Dev-Server |
| `pnpm typecheck` | TypeScript über alle Pakete |
| `pnpm test` | Vitest über alle Pakete |
| `pnpm build` | Produktionsbuild |
| `pnpm data:cities [-- --region=dach]` | Städtedatensatz erzeugen |
| `pnpm data:basemap [-- --region=dach]` | Basiskacheln der Region cachen |

## Struktur

```
apps/web/          React + Vite + MapLibre + deck.gl
packages/domain/   Reine Typen und Konstanten des Spiels
packages/geo/      Distanzen, Polylinienlängen, Bounding-Boxen
data/pipeline/     Offline-Aufbereitung (GeoNames, Kacheln)
data/seed/         Erzeugte Artefakte, zur Laufzeit unter /seed/… geladen
docs/              Konzept, Tech-Stack, Modelle, Roadmap
```

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/00-KONZEPT.md](docs/00-KONZEPT.md) | Spielkonzept, Kernentscheidungen, Gameplay-Loop |
| [docs/01-TECHSTACK.md](docs/01-TECHSTACK.md) | Technologie-Entscheidungen und Architektur |
| [docs/02-DATENMODELL.md](docs/02-DATENMODELL.md) | Domänenmodell als TypeScript-Typen |
| [docs/03-NACHFRAGEMODELL.md](docs/03-NACHFRAGEMODELL.md) | Gravitationsmodell, Segmente, Preisbildung |
| [docs/04-BETRIEBSSIMULATION.md](docs/04-BETRIEBSSIMULATION.md) | Blöcke, Fahrplan, Verspätungen, Kapazität |
| [docs/05-DATENPIPELINE.md](docs/05-DATENPIPELINE.md) | OSM/GeoNames/Routing-Aufbereitung |
| [docs/06-ROADMAP.md](docs/06-ROADMAP.md) | Phasenplan bis zum spielbaren Prototyp |

## Status

**Phase 0 abgeschlossen** — Monorepo, Domänenmodell, Städtepipeline und Kartenansicht
stehen. Als Nächstes Phase 1: Busse und das Nachfragemodell.
