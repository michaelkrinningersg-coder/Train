# 00 — Spielkonzept

## 1. Die zentrale Entscheidung: Wie modellieren wir das Schienennetz?

Das ist die Weichenstellung, die alles andere bestimmt. Drei Optionen standen zur Wahl:

### Option A — Reales OSM-Schienennetz als festes Routing (analog zur Straße)

Man nimmt `railway=rail` aus OSM, baut daraus einen Routing-Graphen und lässt den Spieler
Strecken „pachten" oder freischalten.

- ➕ Kein Zeichnen nötig, sofort realistische Geometrie und Entfernungen.
- ➖ **Das Kern-Gameplay verschwindet.** Netzbau, Ausbau, Elektrifizierung, mehrgleisiger
  Ausbau — all das ist bereits vorgegeben. Der Spieler verwaltet nur noch.
- ➖ OSM-Bahndaten sind topologisch unangenehm: Abstellgruppen, Industriegleise,
  Anschlussbahnen, Straßenbahnen, uneinheitliche `maxspeed`- und `electrified`-Tags,
  fehlende Weichenlogik. Für Europa reden wir über Millionen Wege, von denen die meisten
  spielerisch irrelevant sind.
- ➖ „Was ist ein Streckenabschnitt?" wird beliebig. Blockabschnitte und Fahrplanlogik
  brauchen aber einen *sauberen, von uns kontrollierten* Graphen.

### Option B — Freies Zeichnen mit voller Geometrie (à la Transport Fever)

- ➕ Maximale Freiheit.
- ➖ Erfordert Gelände, Steigungen, Kurvenradien, Kollisionsprüfung, Brücken- und Tunnelbau.
  Das ist ein 3D-Bauspiel, kein Kartenspiel — im Browser auf Europa-Maßstab unrealistisch.

### Option C — **Empfehlung: Abstrakter, selbst gebauter Graph mit optionalem Trassen-Snapping**

Der Spieler zeichnet Strecken zwischen **Knoten** (Bahnhöfe, Abzweige, Überholstellen).
Eine Strecke ist eine Kante mit einer Polylinie als Geometrie. Beim Zeichnen gibt es zwei Modi:

1. **Luftlinie / freie Stützpunkte** — der Spieler klickt Zwischenpunkte, wir glätten die Linie.
2. **„An reale Trasse anlegen"** — optionaler Komfortmodus: wir routen über einen
   vorbereiteten, stark vereinfachten Bahn-Korridor-Graphen aus OSM. Das Ergebnis ist eine
   realistisch gekrümmte Trasse mit plausibler Länge — aber sie ist trotzdem **unsere**
   Kante mit **unseren** Eigenschaften (Vmax, Elektrifizierung, Gleiszahl).

**Warum das die richtige Wahl ist:**

- Das Bau-Gameplay bleibt vollständig erhalten (Ausbau, Elektrifizierung, zweigleisiger Ausbau).
- Die Betriebssimulation braucht einen Graphen mit klar definierten Blockabschnitten. Den
  bekommen wir hier geschenkt: eine Kante → *n* Blöcke, fertig.
- **Erweiterbarkeit**: Eine neue Stadt einzubinden heißt genau *einen Knoten hinzufügen*.
  Keine Neuberechnung eines Europa-Routinggraphen, keine Datenmigration. Genau das, was du
  in deiner Frage als Anforderung genannt hast.
- Die Baukosten ergeben sich aus der Geometrie (Länge × Geländefaktor aus einem Höhenraster),
  nicht aus willkürlichen Pauschalen.
- Direktverbindungen zwischen Städten sind dabei nur der Spezialfall „Kante ohne Zwischenpunkte".

> **Fazit:** Straße = reales Routing (fest, unveränderlich, „gehört dem Staat").
> Schiene = eigener Graph, den der Spieler baut und besitzt. Die Asymmetrie ist kein Kompromiss,
> sie ist thematisch richtig: Straßen sind da, Schienen muss man bauen.

### Konsequenz für die Straße

Busse fahren auf dem realen Netz. Wir brauchen dort aber **kein Live-Routing im Spiel** —
nur Reisezeiten zwischen Städten. Die berechnen wir **einmal offline** mit OSRM und legen
sie als Matrix ab (siehe [05-DATENPIPELINE](05-DATENPIPELINE.md)). Zur Laufzeit ist das ein
Datenbank-Lookup, kein Routing-Server. Das spart uns eine 100-GB-RAM-Preprocessing-Maschine
im Produktivbetrieb.

---

## 2. Gameplay-Loop

```
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        ▼                                                  │
  Nachfrage analysieren  ──►  Bahnhof platzieren           │
  (Wo will wer hin?)          (Lage = Einzugsgebiet)       │
        │                            │                     │
        │                            ▼                     │
        │                     Strecke bauen / ausbauen      │
        │                     (Vmax, Elektrifizierung,      │
        │                      Gleiszahl, Überholstellen)   │
        │                            │                     │
        │                            ▼                     │
        │                     Züge kaufen (reale Baureihen) │
        │                            │                     │
        │                            ▼                     │
        │                     Linie + Fahrplan erstellen    │
        │                     (Bildfahrplan, Taktwahl)      │
        │                            │                     │
        │                            ▼                     │
        │                     ► Konflikte prüfen ◄──────────┤
        │                            │              Ausbau  │
        │                            ▼              nötig   │
        └───── Betrieb beobachten: Auslastung, Verspätung, ─┘
               Deckungsbeitrag, Konkurrenz zur Straße
```

Der Spannungsbogen: **Verdichten bis es klemmt, dann ausbauen.** Der Spieler will den Takt
erhöhen, weil das mehr Fahrgäste bringt — bis zwei Züge sich im selben Block treffen und
Verspätung entsteht, die sich über die ganze Linie fortpflanzt. Dann muss investiert werden:
zweites Gleis, Überholstellen, bessere Signaltechnik (kürzere Blöcke), höhere Vmax.

---

## 3. Reisendensegmente

Sechs Segmente, jedes mit eigener Distanzvorliebe, Zahlungsbereitschaft, Zeitwert und
Tagesganglinie. Details und Zahlen in [03-NACHFRAGEMODELL](03-NACHFRAGEMODELL.md).

| Segment | Typische Distanz | Zahlungsbereitschaft | Zeitwert | Peak |
|---|---|---|---|---|
| **Berufspendler** | 10–80 km | mittel | hoch | Mo–Fr 6–9 / 16–19 Uhr |
| **Schüler** | 5–40 km | sehr niedrig | niedrig | Mo–Fr 7–8 / 13–16 Uhr |
| **Studenten** | 50–400 km | niedrig | niedrig | Fr nachmittags / So abends |
| **Geschäftsreisende** | 100–800 km | sehr hoch | sehr hoch | Di–Do, früh & abends |
| **Touristen** | 150–1200 km | mittel | niedrig | saisonal, Wochenende |
| **Besuchsreisende (VFR)** | 80–600 km | niedrig-mittel | mittel | Wochenende, Feiertage |

Jedes Segment wählt sein Verkehrsmittel über ein **Logit-Modell** aus Preis, Reisezeit,
Umsteigehäufigkeit und Taktdichte — mit „Auto/nicht reisen" als Nullalternative. Damit
konkurrieren Bus und Bahn nicht künstlich, sondern über ihre echten Eigenschaften: Der Bus
ist billig und langsam, die Bahn schnell und teuer. Geschäftsreisende ignorieren den Bus
fast vollständig, Studenten nehmen ihn gern.

---

## 4. Städte und Einrichtungen

Eine Stadt hat:

- reale Einwohnerzahl (GeoNames), Zentrumskoordinate, Landesgrenze
- eine Liste von **Einrichtungen**, die Segmente verstärken

| Einrichtung | Wirkt auf | Faktor (Größe 1–3) |
|---|---|---|
| Universität | Studenten (Ziel) | ×1,6 / ×2,6 / ×4,0 |
| Schulzentrum | Schüler (Ziel) | ×1,3 / ×1,8 / ×2,4 |
| Touristisches Wahrzeichen | Touristen (Ziel) | ×1,5 / ×2,5 / ×4,5 |
| Naturziel (Küste, Alpen) | Touristen (Ziel) | ×1,4 / ×2,2 / ×3,5 |
| Freizeitpark | Touristen (Ziel) | ×1,5 / ×2,0 / ×3,0 |
| Großarbeitgeber | Berufspendler (Ziel) | ×1,3 / ×1,8 / ×2,5 |
| Industriecluster | Berufspendler (Ziel) | ×1,4 / ×2,0 / ×2,8 |
| Finanzplatz | Geschäftsreisende (Ziel) | ×1,8 / ×2,8 / ×4,0 |
| Messestandort | Geschäftsreisende (Ziel, saisonal) | ×1,4 / ×2,2 / ×3,2 |
| Hauptstadt/Verwaltung | Geschäftsreisende (Ziel) | ×1,5 |
| Flughafen-Drehkreuz | Touristen + Geschäft (Ziel) | ×1,3 / ×1,6 |

Wichtig: Einrichtungen wirken auf die **Zielattraktivität**, nicht auf das Quellpotenzial.
Heidelberg zieht Studenten an, es produziert sie nicht. Das Quellpotenzial hängt an der
Einwohnerzahl und der Alterstruktur (näherungsweise per Land).

---

## 5. Bahnhöfe: Lage zählt

Der Spieler platziert den Bahnhof frei innerhalb (oder außerhalb) der Stadt. Daraus ergibt sich:

- **Einzugsgrad** `catchment ∈ [0,1]`: Anteil der Stadtnachfrage, den der Bahnhof erreicht.
  Fällt mit der Entfernung zum Stadtzentrum, skaliert mit dem Stadtradius (aus der
  Einwohnerzahl abgeleitet).
- **Grundstückskosten**: steigen stark zum Zentrum hin.
- **Bahnsteiggleise**: bestimmen, wie viele Züge gleichzeitig halten können — eine eigene
  Kapazitätsgrenze neben den Streckenblöcken.

Das erzeugt eine schöne Entscheidung: Zentralbahnhof (teuer, hohe Nachfrage, aber die
Zulaufstrecke muss ins Stadtgebiet gebaut werden) vs. „Parkway"-Bahnhof am Stadtrand
(billig, schnell angebunden, aber nur ~55 % Einzugsgrad).

---

## 6. Infrastruktur-Eigenschaften

Eine Strecke (`TrackSegment`) hat:

| Eigenschaft | Werte | Wirkung |
|---|---|---|
| Höchstgeschwindigkeit | 80 / 120 / 160 / 200 / 250 / 300 km/h | Fahrzeit, Baukosten, Unterhalt |
| Elektrifizierung | ja / nein | E-Züge fahren nur elektrifiziert; Diesel darf überall, ist aber teurer im Betrieb |
| Gleiszahl | 1 / 2 / 4 | Kapazität, Richtungstrennung |
| Signaltechnik | klassisch / ETCS L1 / ETCS L2 | Blocklänge 6 km → 4 km → 2 km, also Mindestzugfolgezeit |
| Geländefaktor | 1,0 – 3,5 (aus Höhenmodell) | nur Baukosten |

Alle vier sind **nachträglich ausbaubar** — mit Bauzeit, während der die Strecke reduziert
oder gar nicht befahrbar ist. Das ist ein wichtiger Druckpunkt: Ausbau kostet nicht nur Geld,
sondern auch Betrieb.

**Laufende Kosten** je Strecke pro Tag:

```
unterhalt = laenge_km
          × basis(40 €/km/Tag)
          × speedFaktor  (120:1,0 | 160:1,25 | 200:1,6 | 250:2,1 | 300:2,8)
          × gleisFaktor  (1:1,0 | 2:1,8 | 4:3,4)
          × (elektrifiziert ? 1,25 : 1,0)
```

Das ist der Kern der Wirtschaftssimulation: Eine 300-km/h-Vierspur-Strecke frisst dich
auf, wenn nur vier Züge am Tag fahren.

---

## 7. Züge

Reale Baureihen mit realen Kennwerten (Vmax, Sitzplätze, Beschleunigung, Baujahr):
Regionaltriebwagen, Doppelstockzüge, lokbespannte Züge, Hochgeschwindigkeitszüge.
Verfügbarkeit gebunden an das Spieljahr — wer 1975 startet, hat keine ICE-Garnituren.

Jeder Zug hat Kaufpreis, Tagesunterhalt, Energiekosten pro km und Komfortwert (geht ins
Logit-Modell ein: Geschäftsreisende zahlen für Komfort).

> **Rechtlicher Hinweis**: Baureihenbezeichnungen und technische Daten sind Fakten und
> unproblematisch. Marken-, Logo- und Lackierungsrechte (ICE®, TGV®, Railjet®) sind es nicht.
> Empfehlung: reale technische Daten, aber generische Anzeigenamen
> („Hochgeschwindigkeitstriebzug Klasse 403") und eigene Farbgebung.

---

## 8. Zeitmodell

- **Betriebstag**: Der Fahrplan ist ein sich täglich wiederholendes Muster (wie ein echter
  Kursbuchfahrplan), mit Tagesgruppen (Mo–Fr / Sa / So).
- **Simulationstakt**: ereignisgesteuert, nicht tickbasiert. Ein Spieltag wird in Sekunden
  abgearbeitet; Geschwindigkeit vom Spieler regelbar (1×, 10×, 100×, Pause).
- **Kalender**: Spieljahre laufen weiter (Zugverfügbarkeit, Bevölkerungsentwicklung,
  Inflation, Saisonalität des Tourismus).

---

## 9. Was das Spiel *nicht* ist

Explizit ausgeklammert, um das Projekt endlich zu halten:

- Kein Güterverkehr in Phase 1 (später gut andockbar — gleicher Graph, andere Nachfrage).
- Keine 3D-Ansicht, keine Fahrzeug-Innenräume.
- Keine Geländeverformung, keine explizite Brücken-/Tunnelplatzierung (nur Kostenfaktor).
- Keine Konkurrenz-KI in Phase 1 (Konkurrenz kommt vom Auto/Bestandsverkehr im Logit-Modell).
- Kein Multiplayer in Phase 1 — die Architektur hält ihn aber offen.
