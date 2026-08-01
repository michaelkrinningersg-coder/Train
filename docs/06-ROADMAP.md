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

## Phase 5a — Deutschland (erledigt)

**Ziel**: Raus aus Bayern. 65 Städte waren gut zum Bauen der Mechanik, aber ein Netz, in dem
jede Stadt jede andere in zwei Stunden erreicht, stellt keine Netzfragen.

Jetzt: **694 Städte ab 20 000 Einwohnern**, 141 146 Relationen, 49 Mio. Einwohner. Die
Einwohnerschwelle blieb bewusst bei 20 000 — sie anzuheben wäre die einfache Antwort auf die
Rechenzeit, aber gerade die Mittelstädte machen aus Korridoren ein Netz.

Die Pipeline war dafür vorbereitet (`--region=germany`); Arbeit machte die Rechenzeit:

| | vorher | nachher |
|---|---|---|
| Nachfragematrix aufbauen | 4,3 s | 1,0 s |
| Start bis bedienbare Oberfläche | | 2,1–2,4 s |
| Betriebstag, 8 Linien / 29 Halte | | 36 ms |
| Betriebstag, 16 Linien / 50 Halte | | 89 ms |

Beide Optimierungen ändern keine Ziffer am Ergebnis (der Kalibrierlauf gibt dieselben 338 161
Reisen/Tag für Bayern aus). Details in docs/05 Abschnitt 8.

Nebenbei: der Build lieferte den 95-MB-Entwicklungscache für OSM-Kacheln mit aus. Das
Verzeichnis wird jetzt übersprungen — 108 MB → 13 MB.

**Was das offenlegt:** Der Aufwand wächst mit dem **Netz**, nicht mit dem Datensatz. Bei
180 ms Taktung der schnellsten Geschwindigkeit sind 89 ms spielbar, aber sie laufen im
Hauptthread. Ab etwa dreißig Linien ist der Web Worker keine Aufräumarbeit mehr, sondern
Voraussetzung — das ist jetzt gemessen und nicht mehr vermutet.

Ein Versuch, die Nachfragezuordnung durch geteilte Ganglinien zu beschleunigen, brachte
nichts (89 ms vorher, 92 ms nachher) und wurde zurückgenommen.

---

## Phase 5b — Aufträge (erledigt)

**Ziel**: Einen Grund zu spielen. Bis hierher konnte man bauen, und es rechnete — was fehlte,
war die Frage, auf die das eine Antwort ist. Ein Verkehrsbetrieb ohne Auftrag ist eine
Simulation; erst eine Vorgabe mit Frist macht daraus eine Entscheidung, denn eine Entscheidung
braucht etwas, das man verlieren kann.

**Was entstanden ist:**

- **Vier Aufträge** als reine Daten (`domain/scenarios.ts`): „Die erste Linie" (Einstieg),
  „Pendlerland Ruhr", „Die Nord-Süd-Achse", „Freies Spiel".
- **Acht Zielarten**, alle aus dem Spielzustand ablesbar: Fahrgäste, Tagesgewinn, Kasse,
  Linien, Haltestellen, zwei Städte verbinden, Zufriedenheit, Pünktlichkeit.
- **Auswahlbildschirm** beim Start statt des stillen Sprungs mitten nach Deutschland.
- **Auftragsreiter** mit Fortschritt, Frist und — beim Einstieg — den Handgriffen in der
  Reihenfolge, in der sie nützlich sind. Dazu ein Stand in der Kopfzeile.
- **Abschlussmeldung** bei Erfüllung, Fristablauf oder Zahlungsunfähigkeit, mit
  „Weiterspielen" für alle, die es trotzdem wollen.
- **Spielstandformat 3**: der Auftrag steht im Zustand, ältere Stände landen im freien Spiel.

**Zwei Entscheidungen, die die Form prägen:**

- **Ziele sind Fragen an den Zustand, keine mitgeschriebenen Zähler.** Damit übersteht der
  Fortschritt Speichern und Laden von selbst, und ein geladener Stand kann nicht in eine Lage
  geraten, die es im Spiel nicht gibt. Der Preis: Ziele können sich nur auf Zustände beziehen,
  nicht auf Ereignisse — „fahre einmal 10 000 Fahrgäste" geht so nicht, „fahre heute 10 000"
  schon. Für ein Spiel, in dem man einen Betrieb aufbaut statt Kunststücke vorzuführen, ist
  das die richtige Seite des Handels.
- **Ziele statt Punktzahl.** Eine Punktzahl zwänge alles auf eine Achse und ebnete genau die
  Abwägungen ein, die das Spiel ausmachen. Ein Auftrag sagt, *was* am Ende dastehen soll, und
  lässt offen, wie man dorthin kommt.

**Erreichbarkeit** (`connect`-Ziele) läuft bewusst **nicht** über die Reisekettensuche: die
fragt, ob eine Verbindung attraktiv ist, und verwirft Wege, die im Nutzenmodell durchfallen.
Ein Ziel, das sich still ändert, weil ein Umweg knapp zu teuer wird, wäre nicht
nachvollziehbar. Gefragt wird nur: kommt man an.

**Was offen bleibt:**

- **Keine Auftragsketten.** Jeder Auftrag beginnt bei null; ein Feldzug über mehrere Aufträge
  mit übernommenem Netz wäre der nächste Schritt.
- **Keine Startaufstellung.** Ein Auftrag kann kein vorhandenes Netz mitbringen, nur Geld.
- **Keine Bestenliste**, kein Vergleich zweier Lösungen desselben Auftrags.

---

## Phase 5c — Rechenthread (erledigt)

**Ziel**: Die Simulation aus dem Hauptthread nehmen. Gemessen kostete ein
Betriebstag 36 ms bei acht Linien und 89 ms bei sechzehn, bei 180 ms Taktung der
schnellsten Geschwindigkeit — der Hauptthread rechnete also bis zur Hälfte der
Zeit, während die Karte stand.

**Was entstanden ist:**

- `sim.worker.ts` — die Betriebssimulation im Web Worker. `@game/sim` war dafür
  vorbereitet: kein DOM, keine Ein- und Ausgabe, kein `Math.random()`.
- `simClient.ts` — der Draht dorthin, mit **Rückfallweg** in den Hauptthread
  (`VITE_SIM_INLINE=1` erzwingt ihn, damit sich der Nutzen messen statt
  behaupten lässt).
- **Der Worker hält keinen Zustand.** Er bekommt einen und gibt einen zurück,
  dieselbe reine Funktion wie vorher, nur woanders. Zwei Zustände, die
  auseinanderlaufen können, wären der teuerste Fehler an dieser Stelle.
- **Befehle während der Rechnung** werden mitgeschrieben und auf das Ergebnis
  noch einmal angewandt. Der Spieler soll die Wirkung seines Klicks sofort
  sehen, nicht neunzig Millisekunden später — und der Zustand, den der Worker
  zurückgibt, kennt den Klick nicht.

**Zwei Nebenbefunde, die mehr brachten als der Worker selbst:**

- **Die Historie schleppte vierhundert vollständige Tagesergebnisse mit.**
  Gelesen wird daraus nur der Tagesgewinn. Eine Kopie des Zustands kostete
  damit 51 ms, ohne sie 18 — das ist der Unterschied zwischen einer Simulation,
  die sich verschieben lässt, und einer, bei der das Verschieben teurer wäre
  als das Rechnen.
- **Die Kartenschichten bauten bei jedem Spieltag alle 694 Städte neu.**
  `[...state.cities.values()]` ergibt ein frisches Array, und daran erkennt
  deck.gl „alles neu hochladen", samt Schriftsatz für 180 Beschriftungen. Städte
  und Netz sind jetzt getrennte Schichtgruppen mit eigenen Abhängigkeiten.

**Gemessen am Produktionsbau**, zehn Sekunden Spiel bei höchster
Geschwindigkeit, Netz aus acht Linien:

| | |
|---|---|
| JavaScript im Hauptthread | **0,6 %** der Laufzeit |
| Rundlauf zum Rechenthread, inkl. beider Kopien | 9,8 ms je Tag |
| Zustand setzen | 0,1 ms je Tag |

Von der Simulation ist im Profil des Hauptthreads **nichts** mehr zu finden.

**Was die Messung nicht sagt:** Die verbleibenden langen Aufgaben in dieser
Umgebung sind Softwarerasterung — der Prüfrechner hat keine Grafikkarte
(SwiftShader), und 694 halbtransparente Einzugskreise in Software zu füllen
kostet Zeit, die auf einer Maschine mit GPU nicht anfällt. Über das Zeichnen
sagt hier also keine Zahl etwas aus; über die Simulation schon.

---

## Phase 5d — Feldzug und Startaufstellung (erledigt)

**Ziel**: Aus vier Aufgaben eine Vorgeschichte machen. Jeder Auftrag begann bei
null; was man im ersten gebaut hatte, war im zweiten weg.

**Was entstanden ist:**

- **Feldzug** „Vom ersten Bus zur Fernachse": dieselben drei Aufträge, aber
  **nichts wird weggeräumt**. Netz, Fuhrpark, Linien und Kasse gehen mit — samt
  Fahrzeugen, die inzwischen zwei Jahre älter sind, und Schulden, die man
  aufgenommen hat. Dazu ein **Zuschuss** je Auftrag, der das Erwirtschaftete
  ergänzt statt es zu ersetzen.
- **Startaufstellung** je Auftrag: Haltestellen, Bahnhöfe, Strecken und fertige
  Linien, ausgedrückt über dieselben Befehle wie im Spiel — ein Auftrag kann
  also nichts aufstellen, was ein Spieler nicht auch bauen könnte. Städte stehen
  mit Namen darin; was der Datensatz nicht kennt, wird übersprungen.
- `scenarioStartedOnDay` im Zustand: die Frist läuft ab dem Beginn *dieses*
  Auftrags. Ohne diesen Bezug wäre der zweite Auftrag mit vier Jahren Frist nach
  zwei Jahren Spielzeit sofort verloren. Spielstandformat 4.

**Warum eine Aufstellung überhaupt:** Nicht jeder Handgriff ist eine
Entscheidung. Acht Bahnhöfe zwischen Hamburg und München zu setzen ist Arbeit,
aber keine Wahl — wo die Trasse langgeht, mit welcher Höchstgeschwindigkeit und
ob ein- oder zweigleisig, das ist der Auftrag. Im Ruhrgebiet ist es deutlicher:
dort vier Städte in einem Klumpen aus zweihundert Punkten zu treffen, war im
Testlauf schlicht Fummelarbeit.

Die Aufstellung ist **kostenlos** — angewandt, dann Kasse auf das Startkapital.
Sonst hinge das Startvermögen am Gelände unter den Bahnhöfen, und eine Änderung
an den Baukosten machte einen Auftrag still unspielbar.

**Ein bewusster Unterschied:** Im Feldzug greift die Aufstellung **nicht**. Wer
den Ruhrauftrag einzeln spielt, bekommt die vier Haltestellen geschenkt; wer
ihn im Feldzug erreicht, bringt sein eigenes Netz mit und baut dort selbst. Ein
Betrieb, der seit zwei Jahren fährt, bekommt keine Starthilfe mehr.

**Was offen bleibt:** kein zweiter Feldzug, keine Verzweigung, keine
Bestenliste. Und ein verlorener Auftrag beendet den Feldzug — es gibt kein
Wiederholen eines Schritts mit dem Netz von vorher.

---

## Phase 5e — Aufträge nachgerechnet (erledigt)

**Anlass**: Ein Testlauf im Browser. „Die Nord-Süd-Achse" gab 400 Mio. € und
verlangte Hamburg–München mit der Bahn. Der erste Abschnitt, Hamburg nach
Hannover, kostete 215 Mio. — nach dem zweiten war Schluss. Der Auftrag war
**unlösbar**, und niemandem wäre es aufgefallen: die Ziele hatte nie jemand
nachgerechnet.

Daraus wurde `tools/missions.ts` (`pnpm missions`) — was `calibrate` für das
Modell ist, ist das hier für die Aufträge. Gespielt wird nicht optimal, sondern
**plausibel**; kommt eine ordentliche Lösung nicht durch, ist der Auftrag zu
schwer und nicht der Spieler zu ungeschickt. Jeder Auftrag läuft in mehreren
Varianten, denn ein Ziel ist erst dann richtig gesetzt, wenn die knappe Lösung
scheitert und die ordentliche durchkommt.

### Was die Korridore kosten

| Bauweise | Hamburg–München (753 km) | Duisburg–Dortmund (49 km) |
|---|---|---|
| einfach (120, 1 Gleis, Diesel) | 1 765 Mio. € | 90 Mio. € |
| solide (160, 1 Gleis, elektrisch) | 2 534 Mio. € | 132 Mio. € |
| zweigleisig (160, elektrisch) | 4 539 Mio. € | 238 Mio. € |
| Schnellfahrstrecke (250, ETCS) | 7 756 Mio. € | 405 Mio. € |

### Die Nord-Süd-Achse, gemessen

| Lösung | Fahrgäste | Pünktlichkeit | Kasse nach 6 Jahren |
|---|---|---|---|
| eingleisig elektrisch, 60′ | 347 | 0 % | 3 659 Mio. € |
| zweigleisig, 60′ | 4 113 | 100 % | 1 813 Mio. € |
| zweigleisig, 60′ + 7 Zubringer | **5 370** | **100 %** | **1 805 Mio. €** |
| zweigleisig, 30′ + 7 Zubringer | 6 458 | 99 % | 1 275 Mio. € |

Drei Befunde:

- **Eingleisig über 753 km ist unbrauchbar**: 0 % Pünktlichkeit, 347 Fahrgäste.
  Jede Begegnung blockiert. Eine Fernachse *muss* zweigleisig sein — das ist
  keine Balancing-Entscheidung, das fällt aus dem Blockmodell heraus.
- **Die Achse allein trägt nicht.** 4 113 Fahrgäste sind 30 % der angebotenen
  Plätze; erst die Zubringer bringen sie auf 5 370.
- **Mehr Takt ist nicht besser.** Der Halbstundentakt bringt tausend Fahrgäste
  mehr und kostet 530 Mio. € Kasse — der Betrieb wächst schneller als der Erlös.

Die Ziele stehen jetzt so, dass genau die dritte Zeile durchkommt: 5 000
Fahrgäste (schließt „ohne Zubringer" aus), 90 % Pünktlichkeit (schließt
„eingleisig" aus), 1 500 Mio. € auf dem Konto (schließt „Halbstundentakt" aus).
Startkapital 7 000 Mio. statt 400.

### Pendlerland Ruhr

| Lösung | Fahrgäste | Tagesgewinn | Zufriedenheit |
|---|---|---|---|
| eine Achse, 30′ | 2 688 | 8 686 € | 94 % |
| Achse 15′ + Südast | **6 909** | **22 Tsd. €** | **99 %** |

Ziele: 4 000 Fahrgäste und 15 000 € Tagesgewinn — beides trennt. Die Frist ging
von vier auf drei Jahre; erfüllt war der Auftrag ohnehin nach einem Monat.

**Was dabei sonst auffiel:** ein Ziel mit Geldbetrag stand als „2.257.930
Tagesgewinn" im Bericht — der Modellwert in Cent, ungerechnet. Eine Zahl, die
man einmal glaubt und dann falsch entscheidet. Geldbeträge werden jetzt überall
kompakt formatiert, auch in der Auftragsanzeige.

**Was offen bleibt:** Die Fernverkehrsnachfrage ist womöglich zu niedrig
kalibriert. 4 113 Fahrgäste auf der ganzen Achse Hamburg–München sind wenig für
eine Relation, auf der real ein Vielfaches fährt. Das ist eine Frage an das
Nachfragemodell (`decayKm` der Segmente) und nicht an den Auftrag — sie steht
als eigener Punkt aus.

---

## Phase 5f — Streckenbau im Landesmaßstab (erledigt)

**Kettenbau.** Die Nord-Süd-Achse besteht aus sieben Streckenabschnitten. Bisher
musste für jeden einzeln „Strecke bauen" gedrückt und der Bahnhof zweimal
angeklickt werden — 21 Klicks für eine Trasse, die eine einzige Entscheidung
ist. Jetzt wird der Zielbahnhof nach jedem Abschluss zum neuen Startbahnhof.
Im Browser gemessen: Hamburg – München, 753 km, **11 Klicks statt 21**.

**Zwei Dinge, die dabei auffielen** — beide waren keine Kosmetik:

- In den Bauwerkzeugen ging zusätzlich das Stadtpanel auf; deck.gl wertet den
  Klick auf die Städteebene unabhängig vom Kartenklick aus. Das Panel legte sich
  über genau den Ausschnitt, in dem als nächstes gebaut wird, und verschluckte
  den nächsten Klick. Im Test blieb dadurch der letzte Abschnitt der Achse
  ungebaut.
- Beim Zeichnen einer **Linie** wurde auf die nächste *Stadt* gerastet, beim
  Streckenbau auf den nächsten *Bahnhof*. Im Landesmaßstab liegen Städte dicht
  an dicht: ein Klick auf Frankfurt traf Offenbach, wo weit und breit kein
  Bahnhof steht. Beide Werkzeuge rasten jetzt auf Halte.

---

## Phase 5g — Die verbliebenen Modelllücken (erledigt)

### Reihenfolge am Bahnsteig

Bis hierher wurde jeder Abschnitt für sich rationiert, und wer ihn durchfuhr,
wurde am schwächsten Glied anteilig gekürzt — der Fernreisende aus Hamburg
verlor also mitten in Kassel seinen Platz an einen Zusteiger. Real ist es
andersherum. Der Zug fährt die Halte jetzt der Reihe nach ab: erst aussteigen,
dann einsteigen, so weit der frei gewordene Platz reicht. **Wer sitzt, bleibt
sitzen.**

Für eine Fernachse entscheidet das, ob die Überfüllung die langen oder die
kurzen Reisen trifft. Die gemeldete Auslastung bleibt die *Nachfrage* gegen die
Kapazität und darf weiter über 100 % gehen — sonst wäre ein hoffnungslos
überfüllter Zug in der Anzeige nicht von einem gerade eben ausgelasteten zu
unterscheiden.

### Gestrandete Umsteiger

Jede Linie rechnet ihr Teilstück für sich ab — sie kann gar nicht anders, denn
sie kennt die anderen nicht. Bei einer Kette mit Umstieg galt der, der auf dem
zweiten Teilstück hängen blieb, deshalb als *halb bedient*. In Wahrheit ist er
**gestrandet**: er hat den Zubringer besetzt und sein Ziel nie gesehen.

Die Teilstücke tragen jetzt eine Kettenkennung; der Tagesabschluss setzt sie
wieder zu einer Reise zusammen. Angekommen ist der kleinste Anteil über alle
Teilstücke, die Differenz zählt bei der Linie, die sie stehen ließ. Gerechnet
wird auf Tagessummen — die Ganglinie je Kette und Stunde mitzuführen wäre bei
zehntausenden Ketten ein Vielfaches des Speichers, den der ganze Tag braucht.

### Gleisauslastung

Die Heatmap zeigte, wie voll die *Züge* sind. Wie voll die *Trasse* ist, war
nirgends abzulesen — dabei hängt daran die teuerste Investition im Spiel. Volle
Züge auf halbleerer Trasse heißen „dichter fahren", leere Züge auf voller Trasse
heißen „nicht noch eine Fahrt dazu".

Neu ist `trackLoads`: Zugfahrten in der stärksten Stunde je Richtung, gemessen
an der Kapazität, über alle Linien einer Strecke zusammen. Bei Mischverkehr
zählt der langsamste und längste Zug — ein langsamer Zug zwischen zwei schnellen
kostet mehr Trasse, als er selbst braucht.

Dabei fiel auf, dass `capacityPerHour` einer **eingleisigen** Strecke dieselbe
Richtungskapazität gab wie einer zweigleisigen. Eingleisig muss der Gegenzug
aber den ganzen Abschnitt abwarten. Gemessen an der Nord-Süd-Achse:

| Ausbau | Trassenauslastung | Pünktlichkeit | Fahrgäste |
|---|---|---|---|
| eingleisig, 60′ | **149–183 %** | 0 % | 347 |
| zweigleisig, 60′ | 4 % | 100 % | 4 114 |
| zweigleisig, 30′ | 9 % | 99 % | 6 456 |

Die 0 % Pünktlichkeit standen vorher unkommentiert da. Jetzt sagt eine Zahl,
warum.

### Strukturwandel

Die Landkarte war eingefroren: dieselben Hochschulen, dieselben Arbeitgeber im
Jahr 2020 wie 1990. Für ein Spiel über dreißig Jahre war das die größte
verbliebene Unwahrheit im Nachfragemodell — ein Netz sollte nicht einmal richtig
gebaut und dann verwaltet werden, sondern **nachziehen müssen**.

Zwei Kräfte, beide aus der Zeit, in der das Spiel spielt: der große Arbeitgeber,
der abbaut, schließt oder sich anderswo ansiedelt, und der Hochschulausbau in
mittelgroßen Städten. Gerollt wird am 1. Januar aus `(seed, Jahr, Stadt)` — nie
aus `Math.random()`.

**Der Entwurf sah zuerst das Zechensterben über `industrial_cluster` vor.** Beim
Nachzählen im Datensatz hatte keine einzige der 694 deutschen Städte diese
Einrichtung; die Pipeline vergibt sie nicht. Ein Modellzweig, der nie feuert,
ist schlimmer als keiner, weil ihn niemand vermisst. `major_employer` gibt es
93-mal und beschreibt dieselbe Kraft.

Gemessen über 30 Jahre (`pnpm structure`):

```
53 Ereignisse in 30 Jahren (1,8 je Jahr)
13 Schließungen · 25 Ab- und Ansiedlungen · 15 neue Hochschulen

Nachfrage insgesamt: 3.250.852 → 3.250.878 Reisen/Tag
Einpendler nach Fürth: 11.566 → 9.957 je Tag
```

Die Gesamtnachfrage bleibt konstant — das Gravitationsmodell normiert je Quelle,
und das ist so gewollt. Was sich ändert, ist die **Verteilung**: Fürth verliert
ein Siebtel seiner Einpendler, andere Städte gewinnen. Eine Linie, die für
Fürths Pendler gebaut wurde, trägt nach zwanzig Jahren spürbar weniger.

Die Änderungen stehen als **Liste** im Spielstand, nicht als veränderte
Städteliste: die Liste ist winzig, während die Städte ein Drittel des Zustands
ausmachen — und Haupt- und Rechenthread halten ihre Städte getrennt, wenden aber
dieselbe Liste an und kommen damit garantiert auf denselben Stand. Die
Nachfragematrix wird neu gebaut, wenn eine Änderung greift; das kostet für
Deutschland rund eine Sekunde, einmal auf 365 Betriebstage.

Speicherformat **5**.

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
