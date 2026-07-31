# Seed-Daten

Erzeugte Artefakte der Datenpipeline. Die App laedt sie zur Laufzeit unter `/seed/…`
(siehe `apps/web/vite-plugin-seed.ts`) — sie landen bewusst **nicht** im JS-Bundle.

| Datei | Erzeugt durch | Im Repo? |
|---|---|---|
| `cities.<region>.json` | `pnpm data:cities` | ja — klein und die Grundlage jedes Spielstarts |
| `basemap/{z}/{x}/{y}.pbf` | `pnpm data:basemap` | nein — reproduzierbar und zu gross |
| `*.parquet` (spaeter: Reisezeit- und Nachfragematrix) | Phase 1 / Phase 5 | nein |

## Neu erzeugen

```bash
pnpm data:cities                    # Bayern (Standard)
pnpm data:cities -- --region=dach   # groessere Ausbaustufe
pnpm data:basemap                   # lokaler Kachelcache, macht die Entwicklung offline-faehig
```

Hinter einem Proxy liest Node's `fetch` `HTTPS_PROXY` nicht von selbst:

```bash
NODE_USE_ENV_PROXY=1 pnpm data:cities
```

Rohdownloads werden in `data/pipeline/.cache/` zwischengespeichert. Ein zweiter Lauf
geht damit ohne Netzwerk.

## Herkunft und Lizenzen

- Einwohnerzahlen, Koordinaten, Ortsnamen: [GeoNames](https://www.geonames.org/), CC BY 4.0
- Basiskacheln: MapLibre-Demokacheln (Natural Earth). In Phase 5 ersetzt durch selbst
  erzeugte PMTiles aus OpenStreetMap (ODbL) — siehe `docs/05-DATENPIPELINE.md`.

## Bekannte Datenschwaechen

GeoNames fuehrt Einwohnerzahlen der Kernstadt, teils auf aelterem Stand (Ingolstadt
erscheint mit rund 123 000 statt heute rund 143 000). Fuer das Spiel sind die
Groessenverhaeltnisse entscheidend, nicht die letzte Stelle — eine Aktualisierung
gegen Eurostat oder die statistischen Landesaemter ist als spaeterer Pipeline-Schritt
vorgesehen.
