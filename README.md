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
| `pnpm data:facilities [-- --region=dach]` | Einrichtungen der Städte aus Wikidata ergänzen |
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
| 120′ mit 2 Bussen | 414 | 133 % | 83 % | +2 602 €/Tag |
| 60′ mit 4 Bussen | 941 | 160 % | 80 % | +6 675 €/Tag |
| **30′ mit 8 Bussen** | 1 572 | 131 % | 91 % | **+10 284 €/Tag** |
| 15′ mit 16 Bussen | 2 084 | 89 % | 100 % | +9 440 €/Tag |

Zu knapp verliert Fahrgäste, zu üppig verbrennt Geld.

### Umsteigen — warum sich ein Netz lohnt

Fahrgäste können **bis zu zweimal umsteigen**, und zwar in einer *Stadt*: der Bus kann an der
Bushaltestelle enden, die Bahn am Bahnhof, der Fußweg dazwischen kostet Zeit. Damit lohnt
sich ein Zubringerbus aus einer Stadt ohne eigene Fernverbindung — die Nachfrage dorthin gab
es vorher schlicht nicht.

Jede neue Linie bringt mehr als ihre eigene Relation. In einem Busnetz aus 11 Linien quer
durch Bayern werden 22 Städtepaare direkt bedient, 56 mit einem Umstieg und **84 mit zwei**.

Im Linienpanel steht unter *davon Umsteiger*, wie viele Fahrgäste einer Linie nur ein
Teilstück ihrer Reise auf ihr zurücklegen.

### Anschlüsse — die billigste Stellschraube im Spiel

Wie lange ein Umstieg dauert, hängt davon ab, wie die beiden Fahrpläne **zueinander** liegen.
Im Linienpanel gibt es dafür die **Abfahrtsminute** und direkt darunter die Tabelle
**Anschlüsse**: sie zeigt für jeden Halt und jede dort ebenfalls haltende Linie, wie lange man
in beide Umsteigerichtungen wartet. Die Zahlen ändern sich sofort, wenn man die Abfahrtsminute
verschiebt — und das kostet keinen Cent.

Dieselben zwei Linien, nur die Abfahrtsminute des Zubringers verändert:

| Abfahrt | → auf die Fernlinie | ← zurück | Summe | Umsteiger/Tag |
|---|---|---|---|---|
| **:00** | 23 min | 3 min | 26 min | **51** |
| :20 | 3 min | 23 min | 26 min | 52 |
| :40 | 43 min | 43 min | 86 min | **31** |

Bei gleichem Takt beider Linien ist die **Summe** beider Richtungen weitgehend festgelegt. Man
trifft die gute Hälfte der Phasenlagen — und entscheidet dann, welche Richtung man bevorzugt.
Beide zugleich kurz zu bekommen geht nur, wenn Fahrzeit und Takt zueinander passen. Genau das
ist die Idee hinter einem Integralen Taktfahrplan.

### Bahnhöfe ausbauen

Bahnsteiggleise bestimmen, wie viele Züge gleichzeitig im Bahnhof stehen dürfen — an einem
Umsteigeknoten mit mehreren Linien ist das schnell der Engpass. Sie lassen sich nachträglich
anbauen: Stadt anklicken → **Auf N Gleise ausbauen**.

Zwei Dinge dabei: der Anbau unter laufendem Betrieb kostet ein Drittel mehr als beim Neubau,
und **während der Bauzeit ist ein bestehendes Gleis gesperrt**. Wer erst ausbaut, wenn es eng
ist, macht es für ein halbes Jahr enger.

Bahnbau kostet ein Vielfaches des Busbetriebs; die erste Strecke ist das Ziel mehrerer
Spieljahre. Zum Ausprobieren ohne Vorlauf: `VITE_STARTING_CASH=50000000000 pnpm dev`.

### Spielstände

Oben rechts **Spielstand**. Gespeichert wird in der Datenbank des Browsers, automatisch alle
30 Spieltage und von Hand beliebig oft. Wichtig: was im Browser liegt, überlebt kein Aufräumen
der Websitedaten — wer einen Stand behalten will, **exportiert ihn als Datei**.

Ein Spielstand mit einem Jahr Spielzeit und acht Linien ist rund 750 kB groß.

### Einrichtungen

Städte unterscheiden sich nicht nur durch ihre Einwohnerzahl. Hochschulen, Sehenswürdigkeiten,
Naturziele, Freizeitparks, Flughäfen und große Arbeitgeber kommen aus Wikidata und stehen im
Stadtpanel. Sie machen eine Stadt als **Ziel** attraktiver, nicht als Quelle: eine Hochschule
zieht Studenten an, sie bringt keine hervor.

Der Effekt ist deutlich — Erlangen zieht mit 102 000 Einwohnern mehr Studenten an als
Ingolstadt mit 123 000, und Ingolstadts Großarbeitgeber macht aus einem Verlustkorridor einen
tragfähigen.

### Störungen und Instandhaltung

Züge fallen aus. Wie oft, hängt an drei Dingen: **Fahrzeugzustand**, **Streckenalter** und
**Auslastung**. Eine Störung ist kein Aufschlag auf die Statistik, sondern Standzeit auf der
Strecke — der Zug hält an, und die folgenden warten.

Zwei Gegenmittel:

| Mittel | Wo | Wirkung |
|---|---|---|
| **Hauptuntersuchung** | Fuhrpark → Spalte *HU* | Fahrzeugzustand zurück auf 92 % |
| **Oberbau erneuern** | Streckendetail → *Zustand* | Streckenalter zurück auf null |

Beides kostet, und beides ist teurer, je länger man wartet. Ein heruntergefahrener Fuhrpark
wird über ein Jahr rund viermal so oft gestört wie ein gepflegter.

### Ersatzfahrzeuge

Die Hauptuntersuchung **nimmt das Fahrzeug aus dem Umlauf** — zwei Wochen beim Durchsehen,
mehrere Monate bei einer Grundinstandsetzung. Es bleibt der Linie zugeteilt, fährt aber nicht
mit, und die Linie fährt so lange dünneren Takt.

Das ist die eigentliche Entscheidung an der Instandhaltung:

| | kostet | bringt |
|---|---|---|
| **Reserve vorhalten** | Unterhalt für ein Fahrzeug, das meist steht | Takt bleibt, wenn eines ins Werk geht |
| **keine Reserve** | nichts | wochenlang dünnerer Takt, also Fahrgäste |

Und die Werkstatt kommt nicht nur, wenn man sie ruft: eine schwere Störung am Fahrzeug lässt
es **liegenbleiben**. Zwei bis vierundzwanzig Tage, je schlechter der Zustand, desto länger.
Im Fuhrpark steht dann „Schaden" statt „HU" — das eine hat man bestellt, das andere ist einem
passiert.

Wie sehr sich Pflege lohnt, misst man in Ausfalltagen und nicht in Reparaturrechnungen. Sechs
Züge im Halbstundentakt, ein Jahr:

| Zustand | Schäden | Ausfalltage |
|---|---|---|
| 95 % | 1 | 9 |
| 60 % | 7 | 81 |
| 30 % | 23 | 357 |
| 15 % | 32 | 548 |

Bei 30 % fehlt dauerhaft ein Zug von sechs. Ohne Reserve heißt das: das ganze Jahr über
dünnerer Takt.

Im Linienpanel steht neben jedem zugeteilten Fahrzeug **ersetzen**. Damit tauscht man es gegen
ein freies — für die Werkstattzeit, oder um einen alten Bus gegen einen neuen zu wechseln, ohne
die Linie erst leerzuräumen.

Bei Bahnlinien zählt dabei die **Reihenfolge**: das erste verfügbare Fahrzeug bestimmt die
Zugklasse und damit Fahrzeit und Sitzplätze der ganzen Linie.

## Anschlüsse: warten oder pünktlich weiterfahren

Ein Umstieg dauert so lange, wie die Fahrpläne zueinander liegen — die Abfahrtsminute im
Linienpanel ist der Hebel dafür. Was aber, wenn der Zubringer zu spät kommt?

Jede Linie hat dafür eine **Höchstwartezeit**: nie, drei, fünf oder zehn Minuten. Es gibt
keine Einstellung, die beides gewinnt:

| | kostet | bringt |
|---|---|---|
| **nie warten** | Umsteiger verpassen den Anschluss und warten einen vollen Takt | Linie bleibt pünktlich |
| **warten** | *alle* an Bord fahren die Wartezeit als Verspätung mit | die Umsteiger kommen mit |
| **mehr Puffer legen** | jeder Umsteiger wartet planmäßig länger | beides sinkt zugleich |

In der Anschlussliste steht neben jeder Umsteigezeit, wie viel Prozent der Umsteiger sie
verpassen. Ab 15 % ist der Anschluss rot — auch wenn er auf dem Papier nur drei Minuten
dauert. Ein Anschluss, den ein Teil der Fahrgäste nicht erreicht, ist keiner.

## Wo ist der Engpass?

Der Schalter **Auslastung** in der Kopfzeile legt die Sitzplatzauslastung des letzten
Betriebstags über die Karte — je Abschnitt zwischen zwei Halten, nicht je Linie. Hell heißt
leer, dunkel heißt voll, und über 100 Prozent wird der Strich zusätzlich dicker. Ein Klick
öffnet die Linie, der Zeiger nennt die Zahl.

Dieselbe Zahl steht auch im Linienpanel. Auf der Karte beantwortet sie eine andere Frage:
nicht *wie voll ist meine Linie*, sondern *welcher Korridor ist voll und was liegt daneben*.

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

## Region

Gespielt wird **Deutschland**: 694 Städte ab 20 000 Einwohnern, echte Einwohnerzahlen aus
GeoNames, echte Einrichtungen aus Wikidata, echtes Gelände. Bayern bleibt als kleiner
Datensatz für die Entwicklung erhalten:

```bash
VITE_REGION=bavaria pnpm dev
```

Die Einwohnerschwelle bleibt bei 20 000, obwohl das aus 65 Städten 694 macht. Sie anzuheben
wäre die einfache Antwort auf die Rechenzeit, aber die falsche: gerade die Mittelstädte sind
es, die ein Netz von einer Sammlung von Korridoren unterscheiden.

## Prüfen

```bash
pnpm check     # Typen, Werkzeugtypen, Lint, Tests, Build — dasselbe wie in der CI
```

Einzeln: `pnpm typecheck`, `pnpm typecheck:tools`, `pnpm lint`, `pnpm test`, `pnpm build`.
Der Lauf steht als GitHub-Action in `.github/workflows/ci.yml` und läuft bei jedem Push.

Gelintet wird nur, was der Typprüfer **nicht** sieht — vergessenes `await`, toter Code, `any`,
Abhängigkeiten von React-Hooks. Ein Formatierer ist bewusst nicht eingerichtet: die
Formatierung ist im Bestand einheitlich, und ein Werkzeug, das jede Datei anfasst, macht jede
spätere Änderung schwerer zu lesen.

## Status

**Phase 4c abgeschlossen** — spielbar: Busnetz aufbauen und betreiben, Bahnhöfe platzieren,
Strecken über echtes Gelände trassieren und ausbauen, Züge kaufen, Bahnlinien takten und im
Bildfahrplan Konflikte durch Überholstellen oder Ausbau auflösen. Fahrgäste steigen zwischen
eigenen Linien um, und Überfüllung kostet Stammkunden und Fahrplanstabilität.

Spielstände lassen sich speichern und exportieren, Städte haben echte Einrichtungen aus
Wikidata, und Fahrzeuge wie Strecken wollen instand gehalten werden. Anschlüsse sind eine
Entscheidung: warten und die eigene Verspätung weitertragen, oder pünktlich losfahren und
Umsteiger stehen lassen.

Als Nächstes: Saisonganglinien — oder Phase 5, Europa. Der Phasenplan steht in
[docs/06-ROADMAP.md](docs/06-ROADMAP.md).
