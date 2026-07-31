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

## Phase 3 — Züge und Fahrpläne (3–4 Wochen)

**Ziel**: Die Betriebssimulation.

- `packages/sim`: Fahrzeitrechnung, Blockmodell, DES-Kern
- Zugkatalog mit realen Kennwerten, Kauf, Verfügbarkeit nach Jahr
- Linien- und Fahrplaneditor
- **Bildfahrplan** mit Konfliktanzeige — das Schlüssel-UI
- Verspätungssimulation und -ausbreitung
- Kennzahlen: Pünktlichkeit, Auslastung, Deckungsbeitrag je Linie

**Abnahme**: Ich takte München–Nürnberg auf 30 min, sehe im Bildfahrplan einen Konflikt,
baue eine Überholstelle, und der Konflikt verschwindet.

Das ist der Punkt, an dem aus einem Wirtschaftsspiel *dieses* Spiel wird.

---

## Phase 4 — Tiefe (3–4 Wochen)

- Segmente vollständig mit Tages-, Wochen- und Saisonganglinie
- Einrichtungen aus Wikidata mit ihren Boost-Faktoren
- Zufriedenheit je Relation, Folgen von Überfüllung und Unpünktlichkeit
- Störungen, Fahrzeugalterung, Instandhaltung
- Signaltechnik-Ausbau (ETCS)
- Bus-Bahn-Konkurrenz im eigenen Netz (Zubringer statt Wettbewerb)

**Abnahme**: Das Spiel hat einen Schwierigkeitsgrad. Man kann sich verzocken.

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
