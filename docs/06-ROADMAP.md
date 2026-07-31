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

- Kein Lint-Setup und keine CI — kommt mit dem ersten echten Team-Workflow.
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
- **Keine Streckenauslastungs-Heatmap.** Die Auslastung je Abschnitt wird berechnet und im
  Linienpanel gezeigt, aber noch nicht über die Karte gelegt.
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
- [x] **Reiseketten mit einem Umstieg**, umgestiegen wird in einer *Stadt* — damit ist der
      Zubringerbus zum Bahnhof möglich, obwohl Bushaltestelle und Bahnhof getrennte Objekte
      an verschiedenen Orten sind
- [x] Austauschbare Verbindungen werden zu einer Alternative mit gemeinsamem Takt
      zusammengefasst (gegen das *red bus / blue bus*-Problem des Logit-Modells)
- [x] **Zufriedenheit je Relation**: fällt bei Stehenbleiben und Unpünktlichkeit, erholt sich
      rund fünfzehnmal langsamer, wirkt als Abschlag im Logit
- [x] **Haltezeit aus Andrang**: Ein- und Aussteigende verlängern den Aufenthalt und damit
      die Umlaufzeit, bemessen an den Fahrgastzahlen des Vortags
- [x] Beides im Linienpanel sichtbar, mit Erklärung, was zu tun ist

**Abnahme erreicht** — dieselbe Relation, ein halbes Jahr, verschieden viel Kapazität:

| Angebot München–Augsburg | Fahrgäste/Tag | Spitze | Zufriedenheit | Ergebnis |
|---|---|---|---|---|
| 120′ mit 2 Bussen | 372 | 129 % | 87 % | +2 144 €/Tag |
| 60′ mit 4 Bussen | 851 | 153 % | 83 % | +5 710 €/Tag |
| 30′ mit 8 Bussen | 1 381 | 124 % | 94 % | **+8 232 €/Tag** |
| 15′ mit 16 Bussen | 1 704 | 80 % | 100 % | +5 365 €/Tag |

**Es gibt jetzt ein Optimum, und es liegt nicht am Rand.** Wer zu knapp fährt, verliert über
Monate Fahrgäste ans Auto; wer zu üppig fährt, verbrennt Geld. Damit kann man sich verzocken —
und der Fehler zeigt sich erst Wochen später, was ihn erst gefährlich macht.

Und das Umsteigen trägt: ein Zubringer Landsberg–Augsburg bringt der Bahnlinie
München–Augsburg 80 Umsteiger am Tag, die es vorher schlicht nicht gab.

**Was aus Phase 4a offen blieb:**

- **Zwei und mehr Umstiege.** Die Aufzählung wächst kubisch; dafür bräuchte es eine echte
  Verbindungssuche (RAPTOR). In einem Netz dieser Größe frisst die zweite Umsteigestrafe
  den Gewinn ohnehin meist auf.
- **Gestrandete Umsteiger.** Wer auf dem zweiten Teilstück keinen Platz mehr bekommt, gilt
  als halb bedient statt als gestrandet. Die Wahrheit bräuchte einen zweiten
  Zuordnungsdurchgang.
- **Die Reihenfolge am Bahnsteig** fehlt weiterhin: bei Überfüllung werden alle gleich
  behandelt.
- **Die Zufriedenheitsparameter sind gesetzt, nicht gemessen.** Es gibt keine Erhebung dazu,
  wie lange jemand einem verpassten Bus nachträgt. Verteidigen lässt sich die Richtung und
  das Verhältnis von Verfall zu Erholung, nicht die absoluten Zahlen.

---

## Phase 4b — Tiefe (2–3 Wochen)

- Segmente vollständig mit Tages-, Wochen- und Saisonganglinie
- Einrichtungen aus Wikidata mit ihren Boost-Faktoren
- Störungen und ihre Ausbreitung; Instandhaltung als Gegenmittel
- Streckenauslastung als Heatmap über die Karte
- Bus-Bahn-Konkurrenz im eigenen Netz bewusst gestalten (Zubringertarife, abgestimmte
  Anschlüsse statt zufälliger Wartezeit)

**Abnahme**: Ein überalterter Fuhrpark auf einer überlasteten Strecke wird spürbar
unzuverlässig, und man sieht auf der Karte, wo es klemmt.

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
