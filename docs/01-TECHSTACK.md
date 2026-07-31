# 01 — Tech Stack und Architektur

## 1. Leitprinzipien

1. **Eine Sprache.** TypeScript für Frontend, Backend, Simulation und Datenpipeline. Ein
   Zwei-Sprachen-Stack (z. B. Python-Backend) kostet uns geteilte Domänentypen — und die
   Domänentypen sind bei diesem Spiel das Wertvollste, was wir haben.
2. **Die Simulation ist eine reine Bibliothek.** Kein I/O, keine Zeit aus `Date.now()`, kein
   `Math.random()` ohne Seed. Sie bekommt einen Zustand und Befehle und liefert einen neuen
   Zustand. Dadurch: testbar, deterministisch, wiederholbar — und sie läuft unverändert im
   Browser *oder* auf dem Server.
3. **Schweres Rechnen passiert offline.** Routing-Matrix, Nachfragepotenziale, Kartenkacheln
   werden einmal in der Datenpipeline erzeugt. Zur Laufzeit gibt es keinen OSRM- und keinen
   Tile-Server-Betrieb.
4. **Keine Karten-API mit Nutzungsgebühr.** Alles selbst gehostet, statisch ausliefertbar.

---

## 2. Entscheidungen

### Frontend

| Bereich | Wahl | Warum |
|---|---|---|
| Sprache | **TypeScript** (strict) | siehe oben |
| Build | **Vite** | schnell, gutes Worker-Handling |
| UI | **React 19** | größtes Ökosystem für komplexe Panels/Tabellen |
| Karte | **MapLibre GL JS** | Open Source, Vektorkacheln, WebGL, keine Lizenzkosten (Mapbox GL ist seit v2 proprietär) |
| Karten-Overlay | **deck.gl** (`MapboxOverlay`) | Tausende animierte Zug-/Bussymbole und Linien performant im selben WebGL-Kontext |
| Kachelformat | **PMTiles** | *Ein* Archiv-File, per HTTP-Range-Request direkt aus dem Browser lesbar — **kein Tile-Server nötig**. Europa-Basiskarte als statisches Objekt im Bucket. |
| State | **Zustand** + **Immer** | schlank, kein Boilerplate; der große Spielzustand liegt ohnehin im Worker |
| Server-State | **TanStack Query** | Speicherstände, Rankings, Stammdaten |
| Diagramme | **visx** / **D3** direkt | Der Bildfahrplan (Zeit-Weg-Diagramm) ist eine Eigenentwicklung; fertige Chart-Libs helfen da nicht |
| Geo-Helfer | **Turf.js** | Länge, Vereinfachung, Punkt-auf-Linie |
| Tests | **Vitest** + **Playwright** | |

### Simulation

| Bereich | Wahl | Warum |
|---|---|---|
| Paket | **`@game/sim`** — reines TS, keine Abhängigkeiten außer Turf | isomorph, deterministisch |
| Ausführung | **Web Worker** (Comlink) | UI bleibt bei 60 fps, während der Betriebstag durchgerechnet wird |
| Zeitmodell | **Discrete Event Simulation** mit binärer Priority Queue | Bei 2000 Zügen ist tickbasiertes Simulieren im Minutentakt Verschwendung. Ereignisse: Abfahrt, Ankunft, Blockeinfahrt, Blockausfahrt. |
| Zufall | **seeded PRNG** (`sfc32`/PCG) im Zustand | Wiederholbare Störungen, reproduzierbare Bugs, Replay |

> **Warum nicht Rust/WASM?** Erst wenn es weh tut. Ein Betriebstag mit ~50 000 Ereignissen
> läuft in TypeScript in wenigen hundert Millisekunden. Der Übergang ist später schmerzfrei,
> weil `@game/sim` bereits eine reine Funktion ohne I/O ist — genau die Grenze, an der man
> nach WASM schneidet.

### Backend

| Bereich | Wahl | Warum |
|---|---|---|
| Runtime | **Node.js 22** | |
| Framework | **Fastify** | schnell, gutes TS-Typing, JSON-Schema-Validierung eingebaut |
| API | **tRPC** | End-to-End-Typsicherheit ohne Codegen; Client und Server teilen die Domänentypen |
| DB | **PostgreSQL 16 + PostGIS** | Städte, Geometrien, Routing-Matrix, Speicherstände. PostGIS für „welche Städte liegen im Umkreis von X" und Bahnhofs-Einzugsgebiete. |
| ORM | **Drizzle** | SQL-nah, gutes Typing, leichtgewichtige Migrationen |
| Speicherstände | JSONB (Spielzustand) + normalisierte Tabellen für Auswertung | Der Spielzustand ist ein Baum, keine Relation. JSONB + Snapshot alle *n* Spieltage. |

### Datenpipeline (offline, nicht im Produktivbetrieb)

| Aufgabe | Werkzeug |
|---|---|
| OSM-Rohdaten | **Geofabrik**-Europa-Extrakt (`.osm.pbf`) |
| Vektorkacheln erzeugen | **Planetiler** → `europe.pmtiles` |
| Straßenrouting-Matrix | **OSRM** (car profile, MLD) — einmalig, Ergebnis wird als Matrix persistiert |
| Bahn-Korridor-Graph (optional, für „an reale Trasse anlegen") | **osmium** Filter auf `railway=rail` + eigenes Vereinfachungsskript |
| Städte & Einwohner | **GeoNames** (`cities500`, CC-BY 4.0) |
| Einrichtungen | **Wikidata** SPARQL (Universitäten, UNESCO-Stätten, Unternehmenssitze) + OSM-Tags |
| Höhenmodell (Geländefaktor) | **Copernicus DEM GLO-90** → Steigungsprofil je gezeichneter Trasse |

### Infrastruktur

- **Docker Compose** für lokale Entwicklung (Postgres/PostGIS, MinIO für PMTiles).
- Deployment: Frontend statisch (CDN), Backend als Container, PMTiles im Objektspeicher
  mit Range-Request-Unterstützung.
- **Monorepo mit pnpm workspaces** + **Turborepo**.

---

## 3. Repository-Struktur

```
Train/
├── apps/
│   ├── web/                    # React + Vite + MapLibre + deck.gl
│   │   ├── src/map/            # Kartenlayer, Zeichenwerkzeuge, Interaktion
│   │   ├── src/panels/         # Linien-Editor, Fahrplan, Finanzen, Zugdepot
│   │   ├── src/graph/          # Bildfahrplan (Zeit-Weg-Diagramm)
│   │   └── src/worker/         # Comlink-Bridge zum Sim-Worker
│   └── api/                    # Fastify + tRPC + Drizzle
├── packages/
│   ├── domain/                 # Reine Typen + Konstanten, ohne Logik (siehe 02)
│   ├── sim/                    # @game/sim — Betriebssimulation, DES, Blocklogik
│   ├── demand/                 # Gravitationsmodell + Logit-Modeswahl
│   ├── economy/                # Kosten, Preise, Bilanz, Abschreibung
│   └── geo/                    # Längen, Geländefaktor, Einzugsgebiete
├── data/
│   ├── pipeline/               # Skripte: OSM → Städte, Matrix, Kacheln
│   └── seed/                   # Erzeugte Artefakte (cities.json, matrix.parquet)
└── docs/
```

**Warum `demand` und `economy` getrennt von `sim`?** Weil sie unterschiedlich oft laufen.
Die Nachfrage wird pro Spieltag einmal neu bewertet, die Betriebssimulation läuft
ereignisweise. Trennung hält beide schnell und einzeln testbar.

---

## 4. Datenfluss

```
 OFFLINE (einmalig, in data/pipeline)
 ────────────────────────────────────
   Geofabrik europe.osm.pbf ──► Planetiler ──► europe.pmtiles ──► Objektspeicher
                            └─► OSRM ────────► Reisezeit-Matrix ─┐
   GeoNames cities500 ──────────────────────► Städte ───────────┼──► PostGIS
   Wikidata SPARQL ─────────────────────────► Einrichtungen ────┘
   Copernicus DEM ──────────────────────────► Höhenkacheln ─────► Objektspeicher


 LAUFZEIT
 ────────
   Browser
   ├── MapLibre  ◄── europe.pmtiles (HTTP Range)
   ├── deck.gl   ◄── Spielzustand (Netz, Züge)
   └── Sim-Worker
         │  @game/sim + @game/demand + @game/economy
         │  hält den Spielzustand, rechnet Betriebstage
         ▼
       tRPC ──► Fastify ──► PostGIS
                            (Speicherstand, Stammdaten, Reisezeit-Matrix)
```

**Wo läuft die Simulation — Client oder Server?**
Phase 1: **im Browser-Worker**, der Server speichert nur. Das ist billig, offline-fähig und
schnell zu bauen. Weil `@game/sim` eine reine Bibliothek ohne I/O ist, lässt sie sich später
für Multiplayer oder Anti-Cheat **unverändert** serverseitig ausführen — dann wird der Client
zum reinen Renderer, der Befehle schickt. Diese Migration ist genau deshalb billig, weil wir
Regel 2 aus Abschnitt 1 einhalten.

---

## 5. Schlüssel-Performanceentscheidungen

| Problem | Lösung |
|---|---|
| Europa-Karte im Browser | Vektorkacheln als PMTiles, GPU-gerendert. Kein Raster, kein Tile-Server. |
| Tausende bewegte Fahrzeuge | deck.gl `ScatterplotLayer`/`IconLayer` mit typisierten Arrays; Position wird **interpoliert**, nicht simuliert — die Simulation liefert nur Stützpunkte (Ankunft/Abfahrt je Knoten). |
| Stadt-zu-Stadt-Reisezeiten Straße | Vorberechnete Matrix, auf Paare < 800 km beschränkt → statt ~4 Mio. nur ~500 k Zeilen. |
| Nachfrage über alle Stadtpaare | Nur Paare mit relevanter Nachfrage speichern (Schwellwert), das ist dünn besetzt. Vorberechnung des Quell-/Zielpotenzials je Stadt und Segment. |
| Fahrplan-Konfliktprüfung | Intervallbäume je Block; Prüfung nur für geänderte Linien, nicht global. |

---

## 6. Lizenzen und Attribution

| Quelle | Lizenz | Pflicht |
|---|---|---|
| OpenStreetMap | ODbL 1.0 | „© OpenStreetMap-Mitwirkende" sichtbar auf der Karte; abgeleitete Datenbanken müssen unter ODbL geteilt werden |
| GeoNames | CC BY 4.0 | Namensnennung |
| Wikidata | CC0 | keine |
| Copernicus DEM | Copernicus-Lizenz | Namensnennung |
| OSRM / Planetiler / MapLibre | BSD / Apache 2.0 / BSD | Lizenztexte beilegen |

**Wichtig zur ODbL**: Die erzeugte Reisezeit-Matrix ist eine abgeleitete Datenbank. Wenn wir
sie veröffentlichen, muss sie unter ODbL stehen. Der Spielcode selbst bleibt davon unberührt.
