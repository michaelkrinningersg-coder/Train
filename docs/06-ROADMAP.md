# 06 — Roadmap

Der Plan ist so geschnitten, dass **nach jeder Phase etwas Spielbares existiert**. Keine Phase
baut Infrastruktur auf Vorrat.

---

## Phase 0 — Fundament ✅ abgeschlossen

**Ziel**: Monorepo steht, Karte lädt, Städte sind sichtbar.

- [x] pnpm-Workspace, TypeScript strict, Vitest
- [x] `packages/domain` mit den Typen aus [02-DATENMODELL](02-DATENMODELL.md)
- [x] `packages/geo` mit Distanz-, Längen- und Bounding-Box-Rechnung
- [x] `apps/web` mit MapLibre + deck.gl
- [x] Pipeline `01-cities`: GeoNames → Bayern, mit Agglomerations-Clustering
      und Endonymen (München statt „Munich")
- [x] Pipeline `03-basemap`: lokaler Kachelcache, macht die Entwicklung offline-fähig
- [x] Docker Compose mit Postgres/PostGIS

**Abnahme erreicht**: Karte von Bayern mit **65 Städten**, Hover-Tooltip, Klick öffnet
ein Detailpanel mit Einwohnerzahl, Stadtradius und einer Vorschau der erzeugten Reisen
je Segment.

> Zur Zahl: die Roadmap hatte ~80 Städte geschätzt. GeoNames führt in Bayern 65 Orte
> ab 20 000 Einwohnern — die Schätzung war zu hoch, nicht der Datensatz zu klein.
> Die Schwelle ist über `REGIONS` in `data/pipeline/src/regions.ts` einstellbar.

**Was aus Phase 0 offen blieb** (bewusst, kein Blocker):

- ~~Kein Lint-Setup und keine CI.~~ Nachgeholt in Phase 4c: ESLint mit typbewussten
  Regeln und ein GitHub-Actions-Lauf über Typen, Lint, Tests und Build.
- Basiskarte hängt noch an den MapLibre-Demokacheln (Zoom ≤ 6, nur Ländergrenzen).
  Der Austausch gegen eigene PMTiles ist ein Einzeiler und steht in Phase 5.

---

## Phase 1 — Busse und Nachfrage ✅ abgeschlossen

**Ziel**: Das *Wirtschaftsspiel* funktioniert, ohne dass eine einzige Schiene existiert.

- [x] `packages/demand`: Verkehrserzeugung, Gravitationsverteilung, Logit-Verkehrsmittelwahl,
      Tages-/Wochen-/Jahresganglinien. Reisezeiten per Luftlinien-Näherung.
- [x] `packages/economy`: Bau- und Betriebskosten, Journal, Kredite, Fahrzeugalterung
- [x] `packages/sim`: Befehle als reine Funktionen, Liniengeometrie, Betriebstag mit
      stundenweiser Kapazitätsprüfung, Tagesabrechnung
- [x] Bushaltestellen platzieren, Linien auf der Karte zeichnen, Busse kaufen und zuteilen
- [x] Takt, Betriebszeit, Verkehrstage und Tarif einstellbar
- [x] Nachfrage-Overlay auf der Karte
- [x] Spieluhr mit Pause / Normal / Schnell / Einzelschritt
- [x] `pnpm calibrate` als Balancing-Werkzeug

**Abnahme erreicht**: Ein Busnetz in Bayern lässt sich aufbauen; Preis, Takt und Fahrzeugzahl
verändern Fahrgastzahlen und Gewinn in die erwartete Richtung. Der Bericht in
[03-NACHFRAGEMODELL §8](03-NACHFRAGEMODELL.md#8-kalibrierung) zeigt: nur dichte Korridore
tragen sich, Überangebot wird bestraft.

**Was aus Phase 1 offen blieb:**

- Die Kapazitätsprüfung skaliert stundenweise über den **stärkst belasteten Abschnitt** der
  ganzen Linie, nicht abschnittsweise. Bei langen Linien mit sehr ungleicher Belastung ist das
  etwas zu streng. Für zwei- bis vierpunktige Buslinien ist der Unterschied vernachlässigbar;
  spätestens bei der Bahn wird es abschnittsweise gerechnet.
- Ein Umlauf darf gemischt besetzt sein; Sitzplätze, Komfort und Kosten werden dann gemittelt.
  Etwas großzügig, aber ehrlicher als den Spieler zu einheitlichen Fahrzeugtypen zu zwingen.
- Kein Umsteigen zwischen eigenen Linien — jede Relation wird nur direkt bedient. Das kommt
  mit dem Netzrouting in Phase 3.
- Die Simulation läuft im Hauptthread. Ein Betriebstag rechnet in wenigen Millisekunden;
  der Web Worker wäre hier noch verfrüht. `@game/sim` ist bereits I/O-frei, der Umzug ist
  später ein Verschieben, kein Umschreiben.

> Warum Busse zuerst? Weil sie das komplette Nachfrage- und Wirtschaftsmodell testen, ohne die
> aufwändige Betriebssimulation zu brauchen. Das hat sich ausgezahlt: das Balancing war beim
> ersten Wurf um den Faktor 5 daneben, und das ließ sich hier in Stunden statt Wochen finden.

---

## Phase 2 — Schienennetz bauen ✅ abgeschlossen

**Ziel**: Das Bauwerkzeug.

- [x] Pipeline `06-terrain`: Höhenraster der Region aus freien AWS-Terrain-Kacheln
- [x] `packages/geo`: Höhenabfrage, Höhenprofil, Geländebewertung einer Trasse
- [x] Bahnhofsplatzierung mit Livevorschau von Einzugsgrad, Grundstückspreis und Kosten
- [x] Zeichenwerkzeug: Startbahnhof anklicken, Stützpunkte setzen, an einem Bahnhof
      abschließen. Rücktaste nimmt einen Stützpunkt zurück, Escape bricht ab.
- [x] Streckenparameter (Vmax, Gleiszahl, Elektrifizierung, Signaltechnik) beim Bau
      und als nachträglicher Ausbau, jeweils mit Bauzeit
- [x] Baukosten aus Länge × Geländefaktor, laufender Unterhalt je km
- [x] Umschaltbare OSM-Basiskarte — ohne Gelände, Gewässer und bestehende Bahnstrecken
      lässt sich keine Trasse planen

**Abnahme erreicht**: München–Augsburg ist baubar (62 km über einen Stützpunkt,
Gelände ×1,49, 111 Tage Bauzeit, 111 Mio. €), erscheint im Netz mit Unterhalt
2 488 €/Tag, und lässt sich anschließend elektrifizieren oder auf 200 km/h ausbauen.

### Zur Kostenhöhe

`pnpm calibrate` weist die Infrastrukturkosten jetzt mit aus:

| Korridor | Gelände | einfach, 120 km/h | Vollausbau 200 km/h zweigleisig elektrisch |
|---|---|---|---|
| München–Augsburg (56 km) | ×1,36 | 93 Mio. € | 316 Mio. € |
| Nürnberg–München (151 km) | ×1,85 | 334 Mio. € | 1 108 Mio. € |
| Bayreuth–Hof (47 km) | ×2,16 | 122 Mio. € | 398 Mio. € |

Reale Neubaustrecken kosten 3 bis 15 Mio. € je Kilometer; im Spiel sind es rund
1,2 Mio. € — **eine bewusste Abweichung**. Mit realen Zahlen wäre die erste Strecke aus
Fahrgelderlösen nie zu finanzieren, denn reale Bahnen baut der Staat und nicht der
Fahrkartenverkauf. Die *Verhältnisse* zwischen den Ausbaustufen bleiben realistisch.
Der Maßstab hängt an einer einzigen Konstante (`TRACK_BASE_COST_PER_KM`).

Damit ist die erste Bahnstrecke das Ziel mehrerer Spieljahre Busbetrieb — genau die
gedachte Progression. Zum Ausprobieren ohne Vorlauf gibt es die Entwicklungsoption
`VITE_STARTING_CASH`.

**Was aus Phase 2 offen blieb:**

- **Keine Abzweige.** Strecken verbinden ausschließlich Bahnhöfe; ein Knoten mitten auf
  einer Strecke lässt sich nicht setzen. Für ein Netz aus Punkt-zu-Punkt-Strecken reicht
  das, für echte Verzweigungen kommt der Knotentyp `junction` in Phase 3 dazu.
- **Keine Überholstellen.** Der Knotentyp existiert im Modell, gebaut werden kann er noch
  nicht — er wird erst mit der Betriebssimulation sinnvoll.
- **Keine Gewässerprüfung.** Der Geländefaktor kommt aus der Steigung; eine Trasse quer
  über den Bodensee kostet noch keinen Brückenzuschlag. Dafür braucht es die
  Landpolygone aus OSM.
- Der Ausbau gilt im Datenmodell sofort, befahrbar wird die Strecke erst nach der
  Bauzeit. Solange keine Züge fahren, ist das nicht spürbar — ab Phase 3 schon.

---

## Phase 3 — Züge und Fahrpläne ✅ abgeschlossen

**Ziel**: Die Betriebssimulation.

- [x] Fahrzeitrechnung aus Beschleunigung, Bremsverzögerung, Vmax und Steigung —
      Vorwärtslauf für die Beschleunigung, Rückwärtslauf für die Bremskurve, daraus die
      Zeit-Weg-Funktion des Zuges
- [x] Wegsuche im Schienennetz (Dijkstra über die Fahrzeit des konkreten Zuges);
      ein Elektrozug findet keinen Weg über eine nicht elektrifizierte Strecke
- [x] Blockmodell mit vier Betriebsmitteln: Block (richtungsbezogen), Abschnitt
      (eingleisige Gegenrichtung), Bahnsteig, Fahrzeug
- [x] Zugkatalog: 8 reale Klassen von der Schienenbusgarnitur (1955) bis zum
      300-km/h-Hochgeschwindigkeitszug (2000), Verfügbarkeit nach Baujahr
- [x] Linien- und Fahrplaneditor: Halte wählen, Takt, Betriebszeit, Verkehrstage, Tarif
- [x] **Bildfahrplan** mit Konfliktmarken am Kreuzungspunkt — das Schlüssel-UI
- [x] Ereignisgesteuerte Verspätungssimulation über Belegungen in zeitlicher Reihenfolge
- [x] **Überholstellen** bauen (`place_passing_loop`) — der Knotentyp aus Phase 2 wird nutzbar
- [x] Abschnittsweise Fahrgastzuordnung: der Zug wird unterwegs geleert und neu gefüllt
- [x] Kennzahlen: Pünktlichkeit, Ø-Verspätung, Auslastung je Abschnitt, Deckungsbeitrag

**Abnahme erreicht** — am Korridor München–Augsburg statt München–Nürnberg, weil die
kürzere Strecke denselben Konflikt bei kleinerem Bauaufwand zeigt:

| | eingleisig, 60′ Takt | + eine Überholstelle in Streckenmitte |
|---|---|---|
| Konflikte im Bildfahrplan | 17 | 0 |
| Pünktlichkeit | 18 % | **100 %** |
| Ø Verspätung | 26,5 min | **0,2 min** |
| Erlös/Tag | 45 732 € | 48 084 € |

Im Bildfahrplan ist der Unterschied ohne jede Kennzahl zu sehen: vorher ein Sägezahnmuster
aus Zügen, die einander den Abschnitt wegnehmen, nachher gleichmäßig versetzte Geraden, die
sich sauber an der Überholstelle kreuzen.

**Was aus Phase 3 offen blieb** (erledigt in Phase 4a, wo vermerkt):

- ~~**Kein Umsteigen zwischen eigenen Linien.**~~ → Phase 4a
- ~~**Keine Haltezeitverlängerung durch Andrang.**~~ → Phase 4a
- **Keine Störungen.** Verspätung entsteht ausschließlich aus dem Fahrplan. Ein
  überalterter Fuhrpark auf einer maroden Strecke fährt bislang genauso pünktlich wie ein
  neuer. Die Ereignisschleife nimmt Störungen ohne Umbau auf.
- **Die Reihenfolge am Bahnsteig fehlt.** Bei Überfüllung werden alle Gruppen eines
  Abschnitts gleich behandelt; real bekommt der den Platz, der zuerst da war.
- ~~Keine Streckenauslastungs-Heatmap.~~ Erledigt in Phase 4c. Was bleibt: sie zeigt die
  Auslastung der *Züge*, nicht die der *Gleise*.
- **Ein Fahrzeugtyp je Linie.** Gemischte Umläufe rechnen mit dem ersten zugeteilten Zug.
- Die Simulation läuft weiterhin im Hauptthread. Ein Betriebstag einer Bahnlinie mit 34
  Zugläufen rechnet in wenigen Millisekunden; der Web Worker bleibt aufgeschoben.

> Die teuerste Lektion der Phase steckt in `resolveDelays`: Wer die Züge in
> Abfahrtsreihenfolge abarbeitet statt die Belegungen in zeitlicher Reihenfolge, lässt den
> bereits eingefahrenen Zug auf den noch nicht abgefahrenen warten. Die Überholstelle hatte
> dadurch messbar *keine* Wirkung — und genau das war die Abnahmebedingung. Siehe
> [04-BETRIEBSSIMULATION §5](04-BETRIEBSSIMULATION.md#5-laufzeitsimulation-ereignisgesteuert-über-belegungen).

Das ist der Punkt, an dem aus einem Wirtschaftsspiel *dieses* Spiel wird.

---

## Phase 4a — Umsteigen und Überlastung ✅ abgeschlossen

**Ziel**: Aus Einzellinien wird ein Netz, und Überfüllung bekommt Folgen.

- [x] **Zentrale Nachfrageverteilung**: das Angebot aller Linien wird einmal je Betriebstag
      zusammen bewertet, statt dass jede Linie ihren Anteil selbst aus der Matrix zieht
- [x] **Reiseketten mit bis zu zwei Umstiegen**, gefunden über eine rundenweise Suche in der
      Bauart von RAPTOR. Umgestiegen wird in einer *Stadt* — damit ist der Zubringerbus zum
      Bahnhof möglich, obwohl Bushaltestelle und Bahnhof getrennte Objekte an verschiedenen
      Orten sind. Die Zahl der Umstiege ist ein Parameter, kein Strukturmerkmal.
- [x] **Bahnhofsausbau**: Bahnsteiggleise lassen sich nachträglich anbauen, mit Bauzeit — und
      währenddessen ist ein bestehendes Gleis gesperrt
- [x] Austauschbare Verbindungen werden zu einer Alternative mit gemeinsamem Takt
      zusammengefasst (gegen das *red bus / blue bus*-Problem des Logit-Modells)
- [x] **Zufriedenheit je Relation**: fällt bei Stehenbleiben und Unpünktlichkeit, erholt sich
      rund fünfzehnmal langsamer, wirkt als Abschlag im Logit
- [x] **Haltezeit aus Andrang**: Ein- und Aussteigende verlängern den Aufenthalt und damit
      die Umlaufzeit, bemessen an den Fahrgastzahlen des Vortags
- [x] **Anschlüsse als Spielmechanik**: die Umsteigezeit entsteht aus der Phasenlage der
      beiden Fahrpläne, nicht mehr pauschal aus dem halben Takt. Der Spieler stellt die
      Abfahrtsminute ein und sieht die Anschlusszeiten unmittelbar daneben.
- [x] Alles im Linienpanel sichtbar, mit Erklärung, was zu tun ist

**Abnahme erreicht** — dieselbe Relation, ein halbes Jahr, verschieden viel Kapazität:

| Angebot München–Augsburg | Fahrgäste/Tag | Spitze | Zufriedenheit | Ergebnis |
|---|---|---|---|---|
| 120′ mit 2 Bussen | 414 | 133 % | 83 % | +2 602 €/Tag |
| 60′ mit 4 Bussen | 941 | 160 % | 80 % | +6 675 €/Tag |
| 30′ mit 8 Bussen | 1 572 | 131 % | 91 % | **+10 284 €/Tag** |
| 15′ mit 16 Bussen | 2 084 | 89 % | 100 % | +9 440 €/Tag |

**Es gibt jetzt ein Optimum, und es liegt nicht am Rand.** Wer zu knapp fährt, verliert über
Monate Fahrgäste ans Auto; wer zu üppig fährt, verbrennt Geld. Damit kann man sich verzocken —
und der Fehler zeigt sich erst Wochen später, was ihn erst gefährlich macht.

Und das Umsteigen trägt: ein Zubringer Landsberg–Augsburg bringt der Bahnlinie
München–Augsburg 80 Umsteiger am Tag, die es vorher schlicht nicht gab.

Und das Umsteigen skaliert: in einem bayerischen Busnetz aus 11 Linien werden 22 Relationen
direkt bedient, 56 mit einem Umstieg, **84 mit zwei**. Die Suche kostet dafür 1,3 ms; ein
ganzer Betriebstag rechnet in 5 ms.

Die Anschlüsse sind die dritte Stellschraube und die billigste — die Abfahrtsminute zu
verschieben kostet keinen Cent. Dieselben zwei Linien, nur die Phasenlage verändert:

| Abfahrtsminute des Zubringers | Umstieg hin | zurück | Summe | Umsteiger/Tag |
|---|---|---|---|---|
| :00 | 23 min | 3 min | 26 min | **51** |
| :20 | 3 min | 23 min | 26 min | 52 |
| :40 | 43 min | 43 min | 86 min | **31** |

Über alle Phasenlagen gemittelt kommt wieder der halbe Takt heraus — die Mechanik verschiebt
das Balancing nicht, sie gibt dem Spieler die Wahl innerhalb davon. Bei gleichem Takt beider
Linien ist die *Summe* beider Umsteigerichtungen weitgehend festgelegt: man trifft die gute
Hälfte der Phasenlagen und entscheidet dann, welche Richtung man bevorzugt. Das ist die
Rechnung hinter einem Integralen Taktfahrplan.

**Was aus Phase 4a offen blieb:**

- ~~Keine Anschlusssicherung.~~ Erledigt in Phase 4c: jede Linie hat eine Höchstwartezeit,
  und ein verpasster Anschluss kostet einen vollen Takt. Siehe docs/03 Abschnitt 6.
- **Gestrandete Umsteiger.** Wer auf einem späteren Teilstück keinen *Platz* mehr bekommt,
  gilt als anteilig bedient statt als gestrandet. (Wer den Anschluss wegen Verspätung
  verpasst, wird seit Phase 4c richtig gezählt — es geht hier nur noch um Kapazität.) Die
  Wahrheit bräuchte einen zweiten Zuordnungsdurchgang.
- **Die Reihenfolge am Bahnsteig** fehlt weiterhin: bei Überfüllung werden alle gleich
  behandelt.
- **Die Zufriedenheitsparameter sind gesetzt, nicht gemessen.** Es gibt keine Erhebung dazu,
  wie lange jemand einem verpassten Bus nachträgt. Verteidigen lässt sich die Richtung und
  das Verhältnis von Verfall zu Erholung, nicht die absoluten Zahlen.

---

## Phase 4b — Spielstände, Einrichtungen, Störungen ✅ abgeschlossen

**Ziel**: Das Spiel lässt sich zu Ende spielen, die Städte unterscheiden sich, und der
Fuhrpark will gepflegt werden.

- [x] **Spielstände** in IndexedDB, mit Autosave alle 30 Spieltage sowie Export und Import
      als Datei. Ausgeschriebene Serialisierung mit Versionsfeld und Migrationsstelle.
- [x] **Einrichtungen aus Wikidata**: Hochschulen, Sehenswürdigkeiten, Naturziele,
      Freizeitparks, Flughäfen und große Arbeitgeber, je Stadt zugeordnet und nach ihrer
      Bedeutung eingestuft
- [x] **Störungen** aus Fahrzeugzustand, Streckenalter und Auslastung — deterministisch
      gewürfelt, damit ein Spielstand ein Spielstand bleibt
- [x] **Instandhaltung**: Hauptuntersuchung für Fahrzeuge, Oberbauerneuerung für Strecken
- [x] **Ersatzfahrzeuge**: die Hauptuntersuchung nimmt das Fahrzeug wochenlang aus dem Umlauf,
      und `replace_vehicle` setzt an derselben Stelle ein anderes ein — damit wird das
      Vorhalten einer Reserve zur Entscheidung

**Abnahme erreicht**: Eine Sitzung lässt sich speichern und am nächsten Tag fortsetzen.
Erlangen zieht mit 102 000 Einwohnern mehr Studenten an als Ingolstadt mit 123 000, weil es
eine Universität hat. Und ein heruntergefahrener Fuhrpark wird über ein Jahr **viermal so oft**
gestört wie ein gepflegter.

### Was die Einrichtungen mit der Nachfrage machen

Die Gesamtzahl der Reisen bleibt bei 338 000/Tag — Einrichtungen **verteilen** um, sie
erfinden nichts. Verschoben wird dafür deutlich:

| Stärkste Studentenziele | ohne | mit Einrichtungen |
|---|---|---|
| Erlangen (102 Tsd. Ew) | 218 | **491** |
| Regensburg (151 Tsd. Ew) | 200 | 302 |
| Ingolstadt (123 Tsd. Ew) | 232 | 219 |
| Dachau (36 Tsd. Ew) | 183 | *aus den Top 8* |

Und das schlägt bis in die Wirtschaftlichkeit durch: **München–Ingolstadt kippt von Verlust
auf Gewinn** (−474 → +1 249 €/Tag), weil Ingolstadt einen realen Großarbeitgeber hat und
damit Pendler anzieht, die vorher nur der Stadtgröße folgten.

**Was aus Phase 4b offen blieb:**

- ~~Keine Migration im Ernstfall erprobt.~~ Format 2 (Anschlusssicherung) hat der Stelle in
  Phase 4c ihre erste echte Aufgabe gegeben; ein Test lädt einen Stand aus Format 1.
- ~~Kein unplanmäßiger Werkstattaufenthalt.~~ Erledigt in Phase 4c: eine schwere Störung am
  Fahrzeug schickt es für 2 bis 24 Tage ins Werk. Erst damit hat die Reserve einen Zweck.
  Gemessen an einem Umlauf von sechs Zügen im Halbstundentakt über ein Jahr
  (`pnpm calibrate`, Abschnitt 7): 1 Schaden bei 95 % Zustand, 7 bei 60 %, 23 bei 30 %, 32 bei
  15 % — und 357 Ausfalltage bei 30 % Zustand, also dauerhaft ein Zug weniger im Umlauf.
- **Einrichtungen sind statisch.** Eine Universität wird nicht gegründet, ein Werk nicht
  geschlossen. Für eine Kampagne über Jahrzehnte wäre das der nächste Schritt.
- **Die Größeneinstufung hängt an lückenhaften Daten.** Besucherzahlen stehen bei den
  wenigsten Museen; ersatzweise zählt die Anzahl der Ziele einer Stadt. Beim Wechsel der
  Region gehört die Verteilung, die der Pipelinelauf ausgibt, noch einmal gelesen.
- Segmente mit vollständiger Saisonganglinie und abgestimmte Zubringertarife stehen
  weiterhin aus.

---

## Phase 4c — Anschlusssicherung (erledigt)

**Ziel**: Aus einem Anschluss eine Entscheidung machen. Bis hierher fuhr die Anschlusslinie
immer nach Plan; ein Anschluss mit null Puffer war deshalb genauso zuverlässig wie einer mit
zehn Minuten, und die Frage, die jeder Betrieb wirklich beantworten muss — halten oder
pünktlich weiterfahren —, kam im Spiel nicht vor.

**Was entstanden ist:**

- **Höchstwartezeit je Linie** (nie / 3′ / 5′ / 10′) als eigener Befehl und als Regler direkt
  über der Anschlussliste, wo auch die Abfahrtsminute steht. Die beiden gehören zusammen: die
  eine legt den Puffer fest, die andere, was passiert, wenn er nicht reicht.
- **Geschlossene Rechnung** statt Würfeln: Verspätung des Zubringers als Exponentialverteilung,
  daraus erwartete Haltezeit und Anteil verpasster Anschlüsse. Formeln in docs/03 Abschnitt 6.
- **Verpasste Anschlüsse kosten einen vollen Takt** — sie gehen in Reisezeit *und*
  Pünktlichkeit der Reisekette ein und damit in die Zufriedenheit der Relation.
- **Risiko im Anschlusspanel**: ab 15 % verpasster Umsteiger ist ein Anschluss als riskant
  markiert, egal wie kurz er auf dem Papier ist.
- **Spielstandformat 2** mit dem ersten echten Migrationsschritt.
- **Auslastungs-Heatmap über der Karte** (Schalter „Auslastung"): Farbe und Strichstärke je
  Abschnitt aus dem letzten Betriebstag, mit Zeigerhinweis und Klick auf die Linie.
- **Zwei Kanten im Nachfragemodell beseitigt**, beide von der Anschlusssicherung aufgedeckt:
  die Grundneigung einer Reisekette kam bis dahin vom längsten Teilstück, und der
  Bestandsverkehr fiel nur weg, wenn das längste Teilstück auf der Schiene lag. Zwei Minuten
  mehr auf dem Zubringerbus konnten damit die Fahrgastzahl einer Kette um den Faktor sieben
  ändern. Beides rechnet jetzt mit dem nach Fahrzeit gewichteten Verkehrsmittelgemisch.
- **Lint und CI**, seit Phase 0 offen. ESLint mit typbewussten Regeln — gemeldet wird nur, was
  ein Typsystem *nicht* sieht: vergessenes `await`, toter Code, `any`, Hook-Abhängigkeiten.
  `tools/` bekam dabei sein erstes tsconfig und war prompt kaputt: `calibrate.ts` benutzte
  noch die Anschluss-API von vor drei Stunden. Genau dafür ist ein CI-Lauf da.
- **Unplanmäßiger Werkstattaufenthalt**: eine schwere Störung am Fahrzeug nimmt es für 2 bis
  24 Tage aus dem Verkehr. Störungen werden dafür je Zuglauf mit *seinem* Fahrzeug gewürfelt,
  nicht mehr pauschal mit dem ersten der Linie. Im Fuhrpark steht, ob ein Fahrzeug wegen HU
  oder wegen eines Schadens steht.

**Was der Spieler davon hat:** Ein Fahrplan ist nicht mehr beliebig eng zu legen. Wer knappe
Anschlüsse baut, muss entweder Puffer legen (kostet alle Umsteiger Zeit) oder warten lassen
(kostet alle an Bord Pünktlichkeit). Es gibt keine Einstellung, die beides gewinnt.

Gemessen an einem knappen Anschluss hinter einem Zubringer mit 13 min mittlerer Verspätung
(`pnpm calibrate`, Abschnitt 7):

| warten bis | Pünktlichkeit der Anschlusslinie | Anschlusswarten | verpasste Anschlüsse |
|---|---|---|---|
| nie | 100 % | 0,0 min | 8 von 44 |
| 3′ | 100 % | 2,4 min | 8 von 46 |
| 5′ | 100 % | 3,7 min | 7 von 48 |
| 10′ | 44 % | 6,2 min | 5 von 45 |

Bis fünf Minuten trägt sich der Tausch: weniger verpasste Anschlüsse, mehr Umsteiger, und die
Pünktlichkeit bleibt, weil ein Halt unter der Pünktlichkeitsschwelle keiner ist. Bei zehn
Minuten kippt es. Wo genau der Umschlagpunkt liegt, hängt am Verhältnis von Puffer zur
Verspätung des Zubringers — eine überall richtige Voreinstellung gibt die Mechanik nicht her,
und genau deshalb ist es eine Entscheidung.

**Was offen bleibt:**

- **Die Anschlusssicherung wirkt in einer Runde.** Wer wartet, gibt seine Verspätung nicht an
  eine dritte Linie weiter, die auf ihn wartet. Der Fixpunkt wäre nicht nur teuer, er
  konvergiert bei gegenseitigem Warten gar nicht.
- **Gewartet wird auf jeden Zubringer**, nicht nur auf einen mit tatsächlichen Umsteigern —
  deren Zahl steht erst nach dem Fahrplan fest.
- **Keine Ansage im Bildfahrplan.** Der gehaltene Anschluss steht als Verspätungsminute in den
  Kennzahlen, ist aber im Zeit-Weg-Diagramm nicht als solcher zu erkennen.
- **Ein Schaden streicht keine Fahrt.** Er wirkt ab dem nächsten Betriebstag; die restlichen
  Läufe des Tages fahren noch.
- **Die Werkstattschwelle ist gesetzt, nicht gemessen.** Eine halbe Stunde Störung als Grenze
  zwischen „sitzt es aus" und „bleibt liegen", und ein Anteil von 12 %, kalibriert auf
  Betriebsjahre statt auf eine Quelle.

---

## Phase 5 — Europa (2–3 Wochen)

- Pipeline auf Mitteleuropa, dann Europa hochziehen
- OSRM-Lauf für die echte Straßenmatrix
- Länderparameter (Baukosten, Lohnniveau, Motorisierung)
- Performance-Arbeit: Kachel-Streaming, Sim-Profiling, ggf. WASM für den DES-Kern
- Kalibrierung gegen Referenzrelationen

**Abnahme**: Ganz Europa spielbar bei flüssigen 60 fps.

---

## Phase 6 — Rundung

- Kampagnen/Szenarien mit Startjahr und Zielvorgaben („Baue bis 1985 eine Verbindung
  Hamburg–München unter 6 Stunden")
- Speicherstände serverseitig, Ranglisten
- Tutorial, das über die Busphase führt
- Optional: Güterverkehr, Nachtzüge, Konkurrenz-KI, Multiplayer

---

## Reihenfolge-Begründung

Die Phasen sind nach **Risiko** sortiert, nicht nach Sichtbarkeit:

1. Das größte offene Risiko ist das **Balancing des Nachfragemodells** — deshalb Phase 1.
2. Das zweitgrößte ist die **Bedienbarkeit des Fahrplaneditors** — deshalb Phase 3 mit dem
   Bildfahrplan als Kernstück, nicht als Nachtrag.
3. Das kleinste Risiko ist die **Datenmenge Europa** — das ist Fleißarbeit mit bekannter
   Lösung und kommt deshalb spät.

Ein Prototyp, der Europa rendert, aber kein funktionierendes Nachfragemodell hat, sieht
beeindruckend aus und beweist nichts. Umgekehrt ist es besser.
