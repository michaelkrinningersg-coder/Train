# 04 — Betriebssimulation: Blöcke, Fahrpläne, Verspätungen

Das ist das Herzstück des Spiels. Hier entsteht die Spannung zwischen „mehr Züge = mehr Umsatz"
und „mehr Züge = Chaos".

---

## 1. Fahrzeitrechnung

Für jeden Streckenabschnitt zwischen zwei Halten wird die Fahrzeit aus einem vereinfachten
Fahrdynamikmodell berechnet — nicht aus einer Pauschale, weil sonst Beschleunigungsvermögen
und Halteabstände keine Rolle spielen würden.

```
v_eff = min( zug.topSpeed, strecke.maxSpeed ) · steigungsfaktor(strecke.gradientPermille, zug)

Für jeden Abschnitt:
  t_beschl  = v_eff / a
  s_beschl  = v_eff² / (2a)
  t_brems   = v_eff / b
  s_brems   = v_eff² / (2b)

  wenn s_beschl + s_brems <= s:
      t = t_beschl + t_brems + (s − s_beschl − s_brems) / v_eff
  sonst:                          # Dreiecksfahrt, Vmax wird nie erreicht
      v_peak = sqrt( 2·s·a·b / (a+b) )
      t = v_peak/a + v_peak/b

t_fahrplan = t · 1,07 + haltezeit        # 7 % Fahrzeitreserve wie im echten Fahrplan
```

Die 7 % Reserve sind bewusst eingebaut: Sie geben dem System die Fähigkeit, kleine
Verspätungen wieder abzubauen. Ohne sie würde jede Störung ewig weiterlaufen. Später kann
der Spieler die Reserve pro Linie einstellen — mehr Reserve = robuster, aber langsamer und
damit weniger attraktiv im Logit-Modell. Eine schöne Abwägung.

**Steigungsfaktor**: schwere Züge verlieren am Berg. `f = 1 / (1 + gradient‰ · masseFaktor / 40)`,
gedeckelt bei 0,6. Dadurch werden Alpenstrecken langsam, obwohl die Vmax hoch ist.

---

## 2. Blockabschnitte und Mindestzugfolgezeit

Eine Strecke wird in Blöcke geteilt (`blockLength` aus der Signaltechnik, siehe
[02-DATENMODELL §2](02-DATENMODELL.md#2-netz-knoten-strecken-blöcke)). In einem Block darf
zu jeder Zeit nur **ein** Zug sein.

```
t_block(v)   = blockLength / v
t_räumen     = zugLänge / v
t_reaktion   = 15 s   (klassisch) | 8 s (ETCS L1) | 4 s (ETCS L2)

zugfolgezeit = t_block + t_räumen + t_reaktion
kapazität/h  = 3600 / zugfolgezeit  · gleisFaktor
```

Beispielrechnung, 160 km/h, klassischer Block (6 km), 200 m Zug:

```
t_block = 6 km / 160 km/h = 135 s
t_räumen = 4,5 s
t_reaktion = 15 s
→ zugfolgezeit ≈ 155 s → ~23 Züge/h/Richtung
```

Mit ETCS L2 (2 km Blöcke): `t_block = 45 s` → ~57 Züge/h. **Das ist der Grund, warum
Signaltechnik-Ausbau eine echte, teure, aber transformative Investition ist** — mehr als eine
Verdoppelung der Kapazität ohne einen Meter neues Gleis.

**Eingleisige Strecken** sind der Sonderfall, der das Spiel interessant macht: Zwei Züge in
Gegenrichtung können sich nur an Knoten mit `sidingCapacity > 0` begegnen. Der ganze Abschnitt
zwischen zwei Überholstellen ist für die Gegenrichtung gesperrt. Eine 60-km-Eingleisstrecke
ohne Kreuzungsbahnhof erlaubt bei 120 km/h gerade einen Zug pro Stunde und Richtung — der
Spieler lernt das schnell und baut Kreuzungsstellen.

---

## 3. Fahrplanerstellung und Konfliktprüfung

Wenn der Spieler ein `ServicePattern` anlegt oder ändert:

```
1. Muster für einen Betriebstag expandieren
   → Liste von TrainRuns mit Soll-Ankunft/Abfahrt je Knoten

2. Je Zuglauf die Blockbelegungen berechnen
   → [{ blockId, enter, leave }]  (mit zugfolgezeit als Sicherheitspuffer)

3. Belegungen in Intervallbäume je Block einfügen
   → Überlappung = Konflikt

4. Konflikte klassifizieren:
   - BLOCK_CONFLICT      zwei Züge im selben Block
   - OPPOSING_SINGLE     Gegenzüge auf Eingleisabschnitt ohne Kreuzungsmöglichkeit
   - PLATFORM_CONFLICT   mehr Züge im Bahnhof als Bahnsteiggleise
   - TURNAROUND          Wendezeit zu kurz für dasselbe Fahrzeug
   - VEHICLE_OVERLAP     ein Fahrzeug soll gleichzeitig zwei Läufe fahren
```

Konflikte werden dem Spieler **vor dem Speichern** angezeigt — im Bildfahrplan (siehe unten)
markiert an genau der Stelle, wo sie auftreten, mit Vorschlägen:
„Abfahrt um 4 min verschieben", „Überholstelle bei km 34 bauen", „zweigleisig ausbauen".

Der Spieler darf einen konfliktbehafteten Fahrplan trotzdem aktivieren. Dann greift die
Laufzeitsimulation — und produziert Verspätungen. Das ist Absicht: Man soll den Fehler
*erleben* dürfen, nicht nur davor gewarnt werden.

---

## 4. Der Bildfahrplan (Zeit-Weg-Diagramm)

Das wichtigste UI-Element des Spiels und der Grund, warum wir das Diagramm selbst bauen
statt eine Chart-Library zu nehmen.

```
  km
   ▲
 Y │╲          ╱╲          ╱          ← Gegenrichtung
   │ ╲        ╱  ╲        ╱
 X │  ╲╱────╲╱    ╲──────╱            ← Kreuzung an Überholstelle
   │  ╱╲    ╱╲    ╱╲    ╱╲
 W │ ╱  ╲  ╱  ╲  ╱  ╲  ╱  ╲
   └────────────────────────────────► Zeit
     06:00   07:00   08:00   09:00
```

- Y-Achse: Streckenkilometer mit Bahnhofsmarken
- X-Achse: Betriebstag
- Jede Linie = ein Zuglauf; Steigung = Geschwindigkeit
- Konflikte rot markiert, Blockbelegung als transparentes Band einblendbar
- **Direkt manipulierbar**: Zuglauf greifen und verschieben, Halt verlängern, Takt ändern

Wer schon einmal mit einem echten Bildfahrplan gearbeitet hat, weiß: Sobald man ihn sieht,
versteht man sofort, warum ein Zug nicht fahren kann. Das ist besser als jede Fehlermeldung.

---

## 5. Laufzeitsimulation (Discrete Event)

```ts
while (queue.peek().at <= endOfDay) {
  const e = queue.pop()
  switch (e.kind) {
    case 'depart':
      // Bahnsteig freigeben, ersten Block anfordern
      if (blockFree(nextBlock, now)) { occupy(...); schedule('enter_block', now) }
      else { schedule('depart', freeAt(nextBlock)); addDelay(run, freeAt - now) }
      break

    case 'enter_block':
      schedule('leave_block', now + blockRunTime(block, run))
      break

    case 'leave_block':
      release(block)
      // Wartende Züge auf diesen Block aufwecken
      wakeWaiters(block)
      if (isLastBlockBeforeStop) schedule('arrive', ...)
      else if (blockFree(next)) { ... } else { hold(run) }   // ← Verspätungsentstehung
      break

    case 'arrive':
      boardAndAlight(run, station, now)       // Nachfragezuordnung, siehe 03 §6
      const dwell = max(pattern.dwell, boardingTime(passengers))
      schedule('depart', max(now + dwell, scheduledDeparture))   // ← Reserve wirkt hier
      break

    case 'disruption':
      blockTrack(e.trackId, e.durationSec)
      break
  }
}
```

**Verspätungsausbreitung** entsteht dabei von selbst und an drei Stellen:

1. **Folgeverspätung**: Zug B kann nicht in den Block, weil Zug A noch drin ist.
2. **Anschlussverspätung**: Fahrzeug ist noch nicht zurück für seinen nächsten Umlauf.
3. **Haltezeitverspätung**: Zu viele Fahrgäste, Aussteigen dauert länger als geplant.

Das ist der Kern der Aussage „durch Blockaden bauen sie Verspätungen auf" aus der
Anforderung — modelliert, nicht als Zufallszahl aufgeschlagen.

**Verspätungsabbau** passiert über die 7-%-Reserve und über Haltezeitpuffer: Ein Zug, der
vor Plan ankommt, wartet bis zur planmäßigen Abfahrt.

**Störungen** (`disruption`) sind seedbasierter Zufall, dessen Wahrscheinlichkeit von
Fahrzeugzustand, Streckenalter und Auslastung abhängt. Ein überalterter Fuhrpark auf einer
überlasteten Strecke wird spürbar unzuverlässig.

---

## 6. Kennzahlen, die der Spieler sieht

| Kennzahl | Bedeutung |
|---|---|
| **Pünktlichkeit** (< 6 min) je Linie | die Zahl, an der man sich messen lässt |
| **Ø Verspätung** und **Verspätungsminuten gesamt** | absolute Schadenshöhe |
| **Streckenauslastung** in % der theoretischen Kapazität | zeigt, wo der nächste Ausbau nötig ist |
| **Sitzplatzauslastung** je Zuglauf | zeigt, wo Kapazität fehlt oder verschwendet wird |
| **Stehengebliebene Fahrgäste** | verlorener Umsatz + sinkende Zufriedenheit |
| **Deckungsbeitrag je Linie** | Umsatz − Betriebskosten − anteiliger Infrastrukturunterhalt |

Die Streckenauslastung als Heatmap über die Karte zu legen (rot = am Limit) ist vermutlich
das nützlichste Analysewerkzeug des ganzen Spiels.

---

## 7. Busse: das gleiche Modell, einfacher

Busse fahren auf dem realen Straßennetz, das der Spieler nicht kontrolliert:

- Reisezeit aus der vorberechneten OSRM-Matrix
- × Buszuschlag 1,15 (Beschleunigung, Haltestellen)
- × Stauzeitfaktor je Stunde (1,0 nachts bis 1,45 im Berufsverkehr in Ballungsräumen)
- **keine Blocklogik**, keine Kapazitätsgrenze auf der Straße — Staus sind eine Zeitfunktion,
  kein Konflikt

Dadurch sind Busse der einfache Einstieg: niedrige Investition, sofortiger Cashflow, keine
Fahrplanpuzzle. Aber sie skalieren nicht — ab einer gewissen Nachfrage braucht man die Bahn,
weil ein Bus 50 Sitze hat und ein Doppelstockzug 800. Der Übergang von Bus zu Bahn ist damit
die natürliche Progression der ersten Spielstunden.
