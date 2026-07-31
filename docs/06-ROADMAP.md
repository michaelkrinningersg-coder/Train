# 06 — Roadmap

Der Plan ist so geschnitten, dass **nach jeder Phase etwas Spielbares existiert**. Keine Phase
baut Infrastruktur auf Vorrat.

---

## Phase 0 — Fundament (1–2 Wochen)

**Ziel**: Monorepo steht, Karte lädt, Städte sind sichtbar.

- pnpm-Workspace, TypeScript strict, Vitest, Lint, CI
- `packages/domain` mit den Typen aus [02-DATENMODELL](02-DATENMODELL.md)
- `apps/web` mit MapLibre + deck.gl, Bayern-PMTiles (klein, schnell)
- Pipeline `01-cities` für Bayern, Städte als Kreise mit Einwohnerzahl auf der Karte
- Docker Compose mit Postgres/PostGIS

**Abnahme**: Ich sehe eine Karte von Bayern mit ~80 Städten, kann klicken und Einwohnerzahlen sehen.

---

## Phase 1 — Busse und Nachfrage (2–3 Wochen)

**Ziel**: Das *Wirtschaftsspiel* funktioniert, ohne dass eine einzige Schiene existiert.

- `packages/demand`: Gravitationsmodell + Logit, Reisezeiten zunächst per Luftlinien-Näherung
- Bushaltestellen platzieren, Buslinien zwischen Städten anlegen
- Busse kaufen, Takt und Preis setzen
- `packages/economy`: Bilanz, Cashflow, Kredite
- Nachfrage-Overlay auf der Karte (welche Relation hat wie viel Potenzial?)

**Abnahme**: Ich kann ein Busnetz in Bayern aufbauen, Preise variieren und sehe, wie sich
Fahrgastzahlen und Gewinn verändern. Zu teuer → keiner fährt. Zu billig → voll, aber Verlust.

> Warum Busse zuerst? Weil sie das komplette Nachfrage- und Wirtschaftsmodell testen, ohne die
> aufwändige Betriebssimulation zu brauchen. Wenn das Balancing hier nicht stimmt, stimmt es
> mit Zügen erst recht nicht.

---

## Phase 2 — Schienennetz bauen (3–4 Wochen)

**Ziel**: Das Bauwerkzeug.

- Zeichenwerkzeug auf der Karte: Knoten setzen, Kanten ziehen, snappen
- Bahnhofsplatzierung mit Einzugsgebiets-Visualisierung
- Streckenparameter (Vmax, Elektrifizierung, Gleiszahl) beim Bau und als Ausbau
- Baukosten aus Länge × Geländefaktor (`06-terrain`)
- Laufende Unterhaltskosten je km
- Netzansicht mit Streckeneigenschaften als Farbcodierung

**Abnahme**: Ich kann München–Nürnberg bauen, elektrifizieren, auf 200 km/h ausbauen — und
sehe, was das kostet und jeden Monat kostet.

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
