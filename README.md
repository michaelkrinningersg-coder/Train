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

Mit lokalem Kachelcache (macht die Entwicklung netzunabhängig):

```bash
VITE_BASEMAP_TILES='/seed/basemap/{z}/{x}/{y}.pbf' \
VITE_OSM_STYLE='/seed/osm/liberty/style.json' pnpm dev
```

## Basiskarte

Oben rechts lässt sich die Karte umschalten:

| Stil | Wofür |
|---|---|
| **Schlicht** | Nur Land und Grenzen — das eigene Netz steht im Vordergrund |
| **OSM farbig** | Vollständige OpenStreetMap: Straßen, Bahnstrecken, Wälder, Gewässer, Gebäude |
| **OSM hell** | Zurückhaltend in Grau — gute Lesbarkeit für die Netzplanung |
| **OSM dunkel** | Voller Detailgrad, gedämpfte Farben |

Die OSM-Stile kommen von [OpenFreeMap](https://openfreemap.org) — vollständige
OpenStreetMap-Vektorkacheln ohne API-Schlüssel und ohne Nutzungslimit. Die Kachelserver der
OpenStreetMap Foundation selbst dürfen für so etwas ausdrücklich nicht verwendet werden.

Auf hellen Karten schaltet das Spiel auf eine eigene, für helle Flächen geprüfte
Markenpalette um; Linien bekommen zusätzlich eine Umrandung, weil auf einer detaillierten
Karte keine einzelne Farbe garantierten Kontrast hat.

Hinter einem Proxy braucht Node's `fetch` ein Flag: `NODE_USE_ENV_PROXY=1 pnpm data:cities`.

| Befehl | Wirkung |
|---|---|
| `pnpm dev` | Vite-Dev-Server |
| `pnpm typecheck` | TypeScript über alle Pakete |
| `pnpm test` | Vitest über alle Pakete |
| `pnpm build` | Produktionsbuild |
| `pnpm data:cities [-- --region=dach]` | Städtedatensatz erzeugen |
| `pnpm data:basemap [-- --region=dach]` | Schlichte Basiskacheln cachen |
| `pnpm data:terrain [-- --region=dach]` | Höhenraster für Baukosten erzeugen |
| `pnpm data:osm [-- --style=liberty]` | OSM-Basiskarte lokal cachen (offline-fähig) |
| `pnpm calibrate` | Kalibrierungsbericht für Nachfrage und Wirtschaftlichkeit |

## Struktur

```
apps/web/          React + Vite + MapLibre + deck.gl
packages/domain/   Reine Typen und Konstanten des Spiels
packages/geo/      Distanzen, Polylinienlängen, Bounding-Boxen
packages/demand/   Verkehrserzeugung, Gravitationsmodell, Verkehrsmittelwahl
packages/economy/  Kosten, Journal, Kredite, Fahrzeugalterung
packages/sim/      Befehle, Wegsuche, Fahrzeit, Blockmodell, Betriebstag, Tagesabrechnung
data/pipeline/     Offline-Aufbereitung (GeoNames, Kacheln)
data/seed/         Erzeugte Artefakte, zur Laufzeit unter /seed/… geladen
tools/             Kalibrierungswerkzeug
docs/              Konzept, Tech-Stack, Modelle, Roadmap
```

## So spielt man

**Busse — der Einstieg:**

1. Eine Stadt auf der Karte anklicken → **Haltestelle bauen**
2. Dasselbe in einer zweiten Stadt
3. Reiter **Fuhrpark** → Busse kaufen
4. Reiter **Linien** → **Neue Linie** → die Haltestellen der Reihe nach anklicken → anlegen
5. In der Linie Fahrzeuge zuteilen, Takt und Tarif einstellen
6. Oben rechts **▶** — und zusehen, ob es sich trägt

Der Knopf **Nachfrage** blendet die stärksten Reiserelationen ein. Wo dort dicke Linien
verlaufen, lohnt sich eine Buslinie.

**Schiene — das Fernziel:**

1. Stadt anklicken → **Bahnhof bauen …**, dann den Standort auf der Karte wählen.
   Zentral heißt viele Fahrgäste und teures Grundstück, am Stadtrand billig und nur ein
   Teil der Nachfrage.
2. Reiter **Schiene** → **Strecke bauen** → Startbahnhof anklicken, Stützpunkte setzen,
   an einem zweiten Bahnhof abschließen. Rücktaste nimmt einen Stützpunkt zurück,
   Escape bricht ab.
3. Fertige Strecken lassen sich elektrifizieren, auf höhere Geschwindigkeit, mehr Gleise
   oder bessere Signaltechnik ausbauen — jeweils mit Bauzeit.
4. Reiter **Fuhrpark** → **Züge** → einen Zugtyp kaufen. Elektrische Züge brauchen
   Fahrdraht auf der *ganzen* Route, sonst findet die Wegsuche keinen Weg.
5. Reiter **Schiene** → **Neue Bahnlinie** → Bahnhöfe der Reihe nach anklicken.
6. In der Linie Züge zuteilen, Takt und Tarif setzen. Reicht die Zahl der Züge für den
   gewünschten Takt nicht, sagt die Linie, wie viele fehlen, und fährt weiter auseinander.
7. **Bildfahrplan einblenden** — das eigentliche Werkzeug.

### Bildfahrplan lesen

Y-Achse Streckenkilometer, X-Achse der Betriebstag. Jede Linie ist ein Zuglauf, ihre
Steigung die Geschwindigkeit; blau die Hin-, orange die Gegenrichtung. **Rote Punkte sind
Konflikte** — dort brauchen zwei Züge dieselbe Stelle zur selben Zeit. Der Tooltip nennt
Uhrzeit, Art und Dauer der Überschneidung.

Auf einer eingleisigen Strecke können sich Gegenzüge nur an einer Betriebsstelle begegnen.
Gegen das Sägezahnmuster aus wartenden Zügen helfen drei Dinge:

| Mittel | Wirkung | Kosten |
|---|---|---|
| **Takt strecken** (60′ statt 30′) | sofort, kostenlos | weniger Fahrgäste |
| **Überholstelle** setzen (Streckendetail → *Überholstelle bauen*) | teilt den Abschnitt, Kreuzung wird möglich | mittel |
| **Zweigleisiger Ausbau** | Gegenrichtung stört gar nicht mehr | hoch, mit Bauzeit |

Die Überholstelle ist fast immer die richtige Antwort: München–Augsburg eingleisig im
60-Minuten-Takt kommt auf 18 % Pünktlichkeit und 26,5 min Ø-Verspätung — mit **einer**
Überholstelle in Streckenmitte auf 100 % und 0,2 min.

### Zufriedenheit — warum die Fahrgäste weniger werden

Jede Relation hat einen Ruf. Wer keinen Platz bekommt oder ständig zu spät ankommt, nimmt
beim nächsten Mal das Auto — und er kommt **deutlich langsamer zurück, als er gegangen ist**.
Der Wert steht im Linienpanel unter *Gestern*.

Das macht Unterkapazität zu einem Fehler mit Nachwirkung: eine Linie, die einen Sommer lang
überfüllt fährt, ist danach nicht mit einem zusätzlichen Bus repariert. Und es gibt ein
Optimum, das nicht am Rand liegt — dieselbe Relation über ein halbes Jahr:

| Angebot München–Augsburg | Fahrgäste/Tag | Spitze | Zufriedenheit | Ergebnis |
|---|---|---|---|---|
| 120′ mit 2 Bussen | 372 | 129 % | 87 % | +2 144 €/Tag |
| 60′ mit 4 Bussen | 851 | 153 % | 83 % | +5 710 €/Tag |
| **30′ mit 8 Bussen** | 1 381 | 124 % | 94 % | **+8 232 €/Tag** |
| 15′ mit 16 Bussen | 1 704 | 80 % | 100 % | +5 365 €/Tag |

Zu knapp verliert Fahrgäste, zu üppig verbrennt Geld.

### Umsteigen — warum sich ein Netz lohnt

Fahrgäste können **einmal umsteigen**, und zwar in einer *Stadt*: der Bus kann an der
Bushaltestelle enden, die Bahn am Bahnhof, der Fußweg dazwischen kostet Zeit. Damit lohnt
sich ein Zubringerbus aus einer Stadt ohne eigene Fernverbindung — die Nachfrage dorthin gab
es vorher schlicht nicht.

Im Linienpanel steht unter *davon Umsteiger*, wie viele Fahrgäste einer Linie nur ein
Teilstück ihrer Reise auf ihr zurücklegen.

Bahnbau kostet ein Vielfaches des Busbetriebs; die erste Strecke ist das Ziel mehrerer
Spieljahre. Zum Ausprobieren ohne Vorlauf: `VITE_STARTING_CASH=50000000000 pnpm dev`.

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

**Phase 4a abgeschlossen** — spielbar: Busnetz aufbauen und betreiben, Bahnhöfe platzieren,
Strecken über echtes Gelände trassieren und ausbauen, Züge kaufen, Bahnlinien takten und im
Bildfahrplan Konflikte durch Überholstellen oder Ausbau auflösen. Fahrgäste steigen zwischen
eigenen Linien um, und Überfüllung kostet Stammkunden und Fahrplanstabilität.

Als Nächstes Phase 4b: Störungen, Einrichtungen aus Wikidata, Auslastungs-Heatmap. Der
Phasenplan steht in [docs/06-ROADMAP.md](docs/06-ROADMAP.md).
