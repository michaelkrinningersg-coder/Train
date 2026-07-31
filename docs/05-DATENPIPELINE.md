# 05 — Datenpipeline

Alles hier läuft **einmal offline** und erzeugt Artefakte, die das Spiel nur noch liest.
Kein OSRM, kein Planetiler, kein SPARQL im Produktivbetrieb.

```
data/pipeline/
├── 01-cities.ts        GeoNames → Städte mit Einwohnerzahlen
├── 02-facilities.ts    Wikidata + OSM → Einrichtungen je Stadt
├── 03-tiles.sh         Geofabrik → Planetiler → europe.pmtiles
├── 04-road-matrix.ts   OSRM → Stadt-zu-Stadt-Reisezeiten (Auto)
├── 05-rail-corridors.ts OSM railway=rail → vereinfachter Korridorgraph (optional)
├── 06-terrain.ts       Copernicus DEM → Höhenkacheln für Geländefaktor
├── 07-potentials.ts    Nachfragepotenziale + Gravitationsmatrix
└── calibrate.ts        Parameterabgleich gegen Referenzrelationen
```

---

## 1. Städte (`01-cities.ts`)

**Quelle**: GeoNames `cities500.zip` (CC BY 4.0), gefiltert auf Europa und
`population >= 20000`. Ergibt grob 4 000–4 500 Städte — eine gute Größe: dicht genug für
ein realistisches Netz, klein genug für schnelle Matrizen.

Problem und Lösung: GeoNames listet Verwaltungseinheiten, keine Agglomerationen. Berlin,
Potsdam und Bernau erscheinen getrennt; London zerfällt in Boroughs. Deshalb:

```
1. Städte < 25 km Abstand und mit deutlichem Größenverhältnis zusammenfassen
   (Clusterbildung mit dem größten Ort als Zentrum)
2. Einwohnerzahl der Nebenorte zu 60 % dem Zentrum zuschlagen,
   Nebenort bleibt als eigener Ort mit reduzierter Zahl bestehen
3. Ergebnis manuell für die 50 größten Agglomerationen prüfen — das ist überschaubar
   und verhindert die peinlichsten Fehler
```

`radiusKm` wird abgeleitet: `radiusKm = 1,2 · sqrt(population / 3000)`
(≈ 7 km bei 100 k Einwohnern, ≈ 22 km bei 1 Mio.).

## 2. Einrichtungen (`02-facilities.ts`)

**Wikidata SPARQL** liefert präzise, strukturierte Treffer:

| Einrichtung | Abfrage |
|---|---|
| Universitäten | `wdt:P31/wdt:P279* wd:Q3918` + Studierendenzahl `wdt:P2196` → Größe 1/2/3 bei <10 k / <30 k / ≥30 k |
| UNESCO-Welterbe | `wdt:P1435 wd:Q9259` |
| Freizeitparks | `wdt:P31/wdt:P279* wd:Q194195` + Besucherzahl |
| Unternehmenssitze | `wdt:P159` + Mitarbeiterzahl `wdt:P1128` → Großarbeitgeber ab 5 000 |
| Flughäfen | `wdt:P31 wd:Q1248784` + Passagierzahl → Hub ab 15 Mio./Jahr |
| Hauptstädte | `wdt:P36` |

**OSM ergänzt**, wo Wikidata dünn ist: `tourism=attraction` mit hoher
`wikipedia`-Verlinkungsdichte, `natural=beach`, `place=alpine_hut`-Dichte für Naturziele.

Jede Einrichtung wird der nächstgelegenen Stadt innerhalb von `2 · radiusKm` zugeordnet.
Naturziele ohne Stadt in Reichweite werden zu eigenen Kleinstorten („Zermatt-Effekt") — das
sind genau die Ziele, die interessante Nebenstrecken rechtfertigen.

## 3. Kartenkacheln (`03-tiles.sh`)

```bash
# ~30 GB Download, ~1–2 h Verarbeitung, Ergebnis ~35 GB PMTiles
wget https://download.geofabrik.de/europe-latest.osm.pbf

java -Xmx32g -jar planetiler.jar \
  --download --area=europe \
  --output=europe.pmtiles \
  --minzoom=0 --maxzoom=12
```

**Zoom 12 reicht**, weil das Spiel auf Städte- und Streckenebene spielt, nicht auf Hausnummern.
Das drückt die Dateigröße erheblich (Zoom 14 wäre 4× so groß). Der Client liest per
HTTP-Range-Request direkt aus dem Archiv — kein Tile-Server, keine laufenden Kosten außer
Speicher und Transfer.

Ein eigenes, reduziertes Kartenstil-JSON (nur Landflächen, Gewässer, Grenzen, Städtelabels,
dezente Straßen) hält die Karte lesbar — das Spielnetz muss die visuelle Hauptrolle spielen.

## 4. Straßen-Reisezeitmatrix (`04-road-matrix.ts`)

Der einzige wirklich schwere Rechenschritt.

```bash
osrm-extract -p car.lua europe-latest.osm.pbf     # ~2-3 h, viel RAM
osrm-partition europe-latest.osrm
osrm-customize europe-latest.osrm
osrm-routed --algorithm=MLD europe-latest.osrm
```

> **Ressourcenwarnung, ehrlich**: `osrm-extract` auf ganz Europa braucht in der Größenordnung
> 100+ GB RAM. Das ist eine einmalige Cloud-Instanz für ein paar Stunden (Kosten im
> zweistelligen Euro-Bereich), keine Dauerinfrastruktur. **Für die Entwicklung reicht ein
> DACH-Extrakt** (~4 GB, läuft auf einem normalen Rechner). Der Europa-Lauf passiert einmal,
> kurz bevor die Karte auf Europa erweitert wird.

Anschließend die Matrix per `/table`-Service in Blöcken von 100×100 Städten abfragen und
persistieren:

```
Speichern nur für Paare mit Luftlinie <= 800 km
→ statt ~20 Mio. Paaren (4500²/2) etwa 400–600 k Zeilen
→ als Parquet (~10 MB) und in PostGIS
```

800 km ist die Grenze, ab der landgebundener Personenverkehr gegen das Flugzeug ohnehin
verliert — dort brauchen wir keine Präzision.

**Fallback ohne OSRM**: `t = luftlinie · 1,25 / 85 km/h` als Näherung. Das ist überraschend
brauchbar und erlaubt, den ganzen Rest des Spiels zu bauen, bevor die Routingdaten fertig
sind. Empfehlung: **genau so anfangen** und OSRM später nachziehen.

## 5. Bahn-Korridore (`05-rail-corridors.ts`, optional)

Nur für den Komfortmodus „an reale Trasse anlegen":

```bash
osmium tags-filter europe-latest.osm.pbf \
  w/railway=rail -o rail.osm.pbf
```

Dann aggressiv vereinfachen: Nur Wege mit `usage=main|branch`, ohne `service=*`,
Douglas-Peucker mit 200 m Toleranz, Kreuzungen zu Knoten verschmelzen. Aus Millionen Wegen
werden so einige zehntausend Korridorkanten — ein Graph, über den man schnell routen kann,
der aber **nur die Geometrie liefert**. Eigenschaften (Vmax, Elektrifizierung) kommen
weiterhin vom Spieler.

Dieser Schritt ist bewusst als *optional* markiert: Das Spiel funktioniert ohne ihn
vollständig, er ist reiner Bedienkomfort.

## 6. Gelände (`06-terrain.ts`)

Copernicus DEM GLO-90 auf ein grobes Raster (~1 km) herunterrechnen, als Terrarium-kodierte
PNG-Kacheln oder als kompaktes Binärraster ausliefern. Beim Zeichnen einer Strecke:

```
1. Höhenprofil entlang der Polylinie abtasten (alle 500 m)
2. mittlere absolute Steigung → terrainFactor 1,0 … 3,5
3. Wasserquerung erkennen (Landpolygone aus OSM) → Pauschale pro km Brücke
```

Erst danach steht der Baupreis fest — der Spieler sieht ihn live beim Ziehen der Linie.

## 7. Potenziale und Gravitationsmatrix (`07-potentials.ts`)

Setzt [03-NACHFRAGEMODELL](03-NACHFRAGEMODELL.md) Stufe 1 und 2 um. Ausgabe:

```
cities.json          ~4500 Städte mit Potenzialen je Segment      ~3 MB
demand.parquet       dünn besetzte Relationsmatrix (i, j, segment, reisen/tag)
road-matrix.parquet  Auto-Reisezeiten
```

Diese drei Dateien sind der komplette „Weltzustand". Eine neue Stadt hinzuzufügen heißt:
Zeile in `cities.json`, Neuberechnung von `07` (Minuten), fertig. Genau die Erweiterbarkeit,
die in der Anforderung gefordert war.

---

## 8. Entwicklungsstrategie: klein anfangen

**Nicht** mit Europa starten. Empfohlene Ausbaustufen des Datensatzes:

| Stufe | Gebiet | Städte | Relationen | Wozu |
|---|---|---|---|---|
| 0 | Bayern | 65 | 3 857 | alles lokal, Iteration in Sekunden |
| **1** | **Deutschland** | **694** | **141 146** | **gespielt wird das** |
| 2 | DACH | ~900 | | Grenzüberschreitung, Ländereffekte |
| 3 | Mitteleuropa | ~1800 | | |
| 4 | Europa | ~4500 | | Release |

Die Pipeline ist identisch, nur der Ausschnitt wächst. Das kostet nichts extra, spart aber
in der Entwicklung sehr viel Wartezeit — Bayern bleibt deshalb erhalten und ist über
`VITE_REGION=bavaria` erreichbar.

### Was der Sprung auf Deutschland gekostet hat

Elf Mal so viele Städte heißt **hundertzwanzig Mal so viele Relationen** — die Gravitation ist
quadratisch. Zwei Stellen mussten dafür angefasst werden, beide ohne eine Ziffer am Ergebnis
zu ändern:

- **Der Matrixaufbau** (`gravity.ts`) dauerte 4,3 s und dauert jetzt 1,0 s. Die Abklingwerte
  einer Zeile werden einmal statt zweimal gerechnet, der Potenzterm einmal je Städtepaar statt
  einmal je Segment, und die Segmentparameter stehen als Zahlenfelder statt als Objektzugriff
  in der innersten Schleife.
- **Die Kartenschichten** rechneten die Nachfragebögen bei jedem simulierten Tag neu. Über
  Bayerns 3 857 Relationen fiel das nicht auf, über 141 146 schon. Die Bögen hängen an der
  Matrix, und die ändert sich während eines Spiels nie.

**Was das Spiel jetzt kostet**, gemessen an einem Busnetz über deutsche Fernkorridore:

| Netz | Relationen | Betriebstag |
|---|---|---|
| 8 Linien, 29 Halte | 726 | 36 ms |
| 16 Linien, 50 Halte | 1 802 | 89 ms |

Der Aufwand wächst mit dem **Netz**, nicht mit dem Datensatz — die Reisekettensuche läuft nur
über bediente Städte. Bei 180 ms Taktung der schnellsten Spielgeschwindigkeit ist das
spielbar, aber es läuft im Hauptthread. Ab etwa dreißig Linien ist der Web Worker keine
Aufräumarbeit mehr, sondern Voraussetzung.

Der Startaufwand liegt bei 2,1 bis 2,4 s bis zur bedienbaren Oberfläche, davon rund eine
Sekunde Nachfragematrix.


---

## Einrichtungen aus Wikidata

`pnpm data:facilities` ergänzt den Städtedatensatz um Hochschulen, Sehenswürdigkeiten,
Naturziele, Freizeitparks, Flughäfen und große Arbeitgeber. Der Mechanismus im
Nachfragemodell war seit Phase 0 fertig und bekam bis dahin keine Daten — in jeder Stadt
stand `facilities: []`.

Zwei Eigenheiten des Wikidata Query Service haben die Form bestimmt:

1. **Der Geo-Box-Dienst ist langsamer als eine Länderabfrage.** Die naheliegende Lösung —
   `SERVICE wikibase:box` mit der Bounding-Box der Region — läuft zuverlässig in den Timeout.
   Abgefragt wird deshalb je Land (`wdt:P17`), und der Ausschnitt wird lokal gefiltert.
   Nebeneffekt: derselbe Abruf trägt später auch größere Regionen.
2. **Der Dienst antwortet unregelmäßig.** Zeitüberschreitungen und 502er sind Normalbetrieb.
   Deshalb Wiederholungen mit wachsendem Abstand — und ein Abbruch, der die Pipeline nicht
   scheitern lässt: ohne Einrichtungen ist der Datensatz ärmer, aber brauchbar.

Ebenso vermieden: `wdt:P31/wdt:P279*` über tiefe Klassenbäume. Einige wenige konkrete Klassen
(`VALUES ?class { … }`) liefern fast dieselbe Ausbeute und antworten.

### Größeneinstufung

Jede Einrichtung bekommt eine Stufe von 1 bis 3. Sie ist das Größere aus zwei Quellen:

- **Kennzahl der Sache selbst** — Studierende (P2196), Beschäftigte (P1128), Besucher (P1174).
- **Anzahl gleichartiger Einrichtungen der Stadt.**

Die zweite Quelle ist nicht Notbehelf, sondern bei dieser Datenlage oft das bessere Maß:
Besucherzahlen stehen bei den wenigsten Museen, wie viele Ziele eine Stadt hat, weiß der
Datensatz dagegen zuverlässig. München ist nicht wegen eines Hauses ein Reiseziel, sondern
wegen dreihundert.

Die Schwellen sind aus der tatsächlichen Verteilung gesetzt, die der Lauf selbst ausgibt — bei
den Sehenswürdigkeiten liegt der Median bayerischer Städte bei 10 und München bei 292; eine
Schwelle bei 30 wäre fast überall erreicht gewesen. **Beim Wechsel der Region gehört diese
Zeile noch einmal gelesen.**

### Zuordnung

Jede Einrichtung geht an die nächste Stadt, in deren 1,6-fachem Stadtradius sie liegt.
Der Zuschlag gegenüber dem Radius selbst ist Absicht: Flughäfen und Universitätscampus liegen
regelmäßig am Rand oder knapp davor. Je Stadt und Typ bleibt eine Einrichtung übrig.
