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

### Block und Abschnitt sind zwei verschiedene Betriebsmittel

Das ist die Unterscheidung, an der die Umsetzung zunächst gescheitert ist, und sie ist es wert,
ausgeschrieben zu werden (`packages/sim/src/blocks.ts`):

| Betriebsmittel | Was es regelt | Kapazität |
|---|---|---|
| **Block** `block:<strecke>:<richtung>:<i>` | Zugfolge in *derselben* Richtung | 1 Zug |
| **Abschnitt** `section:<strecke>` | Begegnung von *Gegen*zügen, nur eingleisig | richtungsrein |
| **Bahnsteig** `platform:<bahnhof>` | gleichzeitige Züge im Bahnhof | `platformTracks` |
| **Fahrzeug** `vehicle:<id>` | ein Zug fährt einen Umlauf | 1 |

Blöcke sind **immer richtungsbezogen**, auch auf eingleisigen Strecken. Der erste Entwurf hatte
sie dort richtungslos gemacht — mit der Folge, dass jede Kreuzung doppelt gemeldet wurde, einmal
als Blockkonflikt und einmal als Gegenzug, und der Spieler eine Strecke reparieren sollte, die
nur ein Problem hatte. Seit die Zuständigkeiten getrennt sind, ist die Meldung eindeutig: der
Abschnitt allein verantwortet die Gegenrichtung.

Kreuzungen an einer Überholstelle überschneiden sich zwangsläufig um ein paar Sekunden. Unter
`MINOR_CONFLICT_SEC = 90` gilt das als Betriebstoleranz und wird nicht gemeldet — sonst zeigte
ein einwandfreier Fahrplan Dutzende roter Punkte.

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
   - block             zwei Züge im selben Block, gleiche Richtung
   - opposing_single   Gegenzüge auf Eingleisabschnitt ohne Kreuzungsmöglichkeit
   - platform          mehr Züge im Bahnhof als Bahnsteiggleise
   - vehicle           ein Fahrzeug soll gleichzeitig zwei Läufe fahren
```

Die Wendezeit ist kein eigener Konflikttyp geworden: `RAIL_TURNAROUND_SEC` geht in die Umlaufzeit
ein, und aus der Umlaufzeit folgt, wie viele Züge ein Takt braucht. Eine zu kurze Wendezeit kann
also gar nicht erst entstehen — statt einer Fehlermeldung bekommt der Spieler die Aussage
„für einen 30-Minuten-Takt fehlen 2 Züge; gefahren wird ein 60-Minuten-Takt". Das ist die
nützlichere Hälfte derselben Information.

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
- Jede Linie = ein Zuglauf; Steigung = Geschwindigkeit; Hin- und Gegenrichtung farblich getrennt
- Konflikte rot markiert — **am Kreuzungspunkt der beiden Zugläufe**, nicht am Startpunkt eines
  Zuges. Der Startpunkt wäre zeitlich richtig, aber örtlich nichtssagend; die Marke soll genau
  dort sitzen, wo man die Kreuzung sieht. Der Tooltip nennt Uhrzeit, Art und Überschneidungsdauer.
- Darunter Pünktlichkeit, Ø-Verspätung, Zugzahl je Richtung und gefahrener Takt

Noch nicht umgesetzt: direkte Manipulation (Zuglauf greifen und verschieben) und die
Blockbelegung als transparentes Band. Beides ist Komfort — die Diagnose funktioniert ohne.

Wer schon einmal mit einem echten Bildfahrplan gearbeitet hat, weiß: Sobald man ihn sieht,
versteht man sofort, warum ein Zug nicht fahren kann. Das ist besser als jede Fehlermeldung.

---

## 5. Laufzeitsimulation: ereignisgesteuert über Belegungen

Umgesetzt in `resolveDelays` (`packages/sim/src/railDay.ts`). Verarbeitet werden nicht die
Züge, sondern die **Belegungen aller Züge in zeitlicher Reihenfolge**:

```ts
solange es unbearbeitete Belegungen gibt:
  i ← Zug, dessen naechste Belegung am fruehesten beginnt   (inkl. bisheriger Verspaetung)
  b ← seine naechste Belegung, um delay[i] verschoben

  frei ← freeFrom(bereitsBelegt[b.betriebsmittel], b.von, b.bis,
                  b.kapazitaet, b.richtung, b.istAbschnitt)

  wenn frei > b.von:  delay[i] += frei − b.von        // ← hier entsteht Verspaetung
  bereitsBelegt[b.betriebsmittel].push(verschoben(b))
```

Dass nach **Belegungszeit** und nicht nach Abfahrtszeit sortiert wird, ist kein Detail, sondern
der Unterschied zwischen einer brauchbaren und einer unbrauchbaren Simulation. Der erste Entwurf
arbeitete die Züge in Abfahrtsreihenfolge ab. Kreuzen sich zwei Züge an einer Überholstelle,
erreicht der eine den Abschnitt Sekunden vor dem anderen — bei Sortierung nach Abfahrt wartete
aber der Zug, der schon *drin* war, auf den, der noch gar nicht losgefahren war. Aus zwanzig
Sekunden Kreuzungstoleranz wurde eine halbe Stunde Verspätung, und eine gebaute Überholstelle
änderte nichts. Nach dem Umbau: München–Augsburg eingleisig, 60-Minuten-Takt — 26,5 min
Ø-Verspätung ohne, **0,2 min mit** Überholstelle.

`freeFrom` iteriert bis zur Ruhe, weil das Verschieben einer Belegung eine neue Überschneidung
auslösen kann; ein Zähler bricht nach 64 Runden ab.

**Verspätungsausbreitung** entsteht dabei von selbst:

1. **Folgeverspätung**: Zug B kann nicht in den Block, weil Zug A noch drin ist.
2. **Kreuzungsverspätung**: Gegenzug hält den eingleisigen Abschnitt besetzt.
3. **Anschlussverspätung**: das Fahrzeug ist noch nicht zurück für seinen nächsten Umlauf —
   dieselbe Mechanik, nur mit dem Betriebsmittel „Fahrzeug".

Das ist der Kern der Aussage „durch Blockaden bauen sie Verspätungen auf" aus der
Anforderung — modelliert, nicht als Zufallszahl aufgeschlagen.

**Verspätungsabbau** passiert über die 7-%-Fahrzeitreserve: je Abschnitt wird
`runSeconds · (reserve − 1)` von der mitgeschleppten Verspätung abgezogen. Eine kurze Störung
verschwindet dadurch nach ein paar Halten von selbst; eine strukturelle bleibt.

**Rückkopplung auf die Nachfrage**: die mittlere Verspätung wird der Reisezeit in der
Logit-Rechnung aufgeschlagen. Eine unpünktliche Linie verliert Fahrgäste an Auto und Bus — das
ist der wirtschaftliche Grund, eine Überholstelle zu bauen, statt die roten Punkte zu ignorieren.

**Haltezeit aus Andrang** (Phase 4a, `packages/domain/src/dwell.ts`): Fahrgäste strömen mit
einer festen Rate durch die Türen — 4/s beim Zug, 0,6/s beim Bus, wo sich beim Einstieg alles
an einer Tür staut. Was über die geplante Haltezeit hinausgeht, verspätet den Zug, gedeckelt
bei vier Minuten. Damit kostet Überfüllung nicht nur Umsatz, sondern auch Fahrplanstabilität.

Die Zahlen dafür stammen aus den Fahrgastzahlen des **Vortags**, und das ist Absicht: die
Haltezeit hängt vom Andrang ab, der Andrang über die Reisezeit von der Haltezeit. Statt diesen
Fixpunkt zu iterieren, plant das Spiel mit den Zahlen von gestern — genau wie ein echter
Betrieb seinen Fahrplan schreibt. Der Zustand hält sie in `GameState.crowding`.

**Noch nicht umgesetzt**: Störungen als seedbasierter Zufall (Fahrzeugzustand, Streckenalter).
Die Ereignisschleife nimmt sie ohne Umbau auf, weil eine Störung nur zusätzliche
Belegungszeit ist.

---

## 5a. Fahrgastzuordnung: der Zug wird unterwegs geleert und neu gefüllt

Die naheliegende Umsetzung — „Sitzplätze der Linie gegen Nachfrage der Linie" — ist falsch,
sobald eine Linie mehr als zwei Halte hat. Ein Fahrgast von Halt 2 nach Halt 4 besetzt nur die
Abschnitte 2→3 und 3→4; an Halt 4 steigt er aus, und der Platz wird weiterverkauft.

Deshalb rechnet `assignPassengers` (`packages/sim/src/assignment.ts`) **je Abschnitt und
Stunde**:

```
je Stunde h und Fahrtrichtung:
    belegung[abschnitt] = Σ nachfrage aller Gruppen, die diesen Abschnitt durchfahren
    faktor[abschnitt]   = min(1, sitze[h] / belegung[abschnitt])

    je Gruppe:  mitgenommen = nachfrage · min über alle durchfahrenen faktor[…]
```

Zwei Eigenschaften folgen daraus, und beide entsprechen dem Betrieb:

- **Getrennte Abschnitte teilen sich keine Plätze.** Ein 100-Sitzer schafft 100 Fahrgäste von
  A nach B *und* 100 von B nach C — 200 insgesamt, nicht 100.
- **Rationiert wird nur, wo es eng ist.** Eine Gruppe wird von dem schlechtesten Abschnitt
  begrenzt, den sie durchfährt. Wer eine Station auf freier Strecke fährt, kommt mit, auch
  wenn zwei Abschnitte weiter niemand mehr zusteigt.

Was daraus im UI wird: `linkLoadFactors` zeigt die Spitzenauslastung je Abschnitt. Genau dort
sieht der Spieler, ob ihm ein längerer Zug hilft (ein Abschnitt über 100 %) oder eine geteilte
Linie (nur die Mitte voll, die Enden leer).

Nachfrage außerhalb der Betriebszeit zählt als **stehen geblieben**, nicht als Überlastung —
sonst wäre jede Linie nachts unendlich überfüllt. Sie zählt auch nicht gegen die Zufriedenheit
(siehe [03 §6a](03-NACHFRAGEMODELL.md#6a-zufriedenheit-das-gedächtnis-der-nachfrage)). Nicht
modelliert ist die Reihenfolge am Bahnsteig: real entscheidet, wer zuerst da ist, ob ein
Fernreisender oder ein Kurzstreckenfahrer den letzten Platz bekommt.

Seit Phase 4a hat Überfüllung zwei Nachwirkungen: sie **verlängert die Haltezeit** (siehe
Abschnitt 5) und sie **kostet Stammkunden**. Wer wiederholt keinen Platz bekommt, weicht aufs
Auto aus, und er kommt deutlich langsamer zurück, als er gegangen ist.

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

Umgesetzt sind Pünktlichkeit, Ø-Verspätung, Konfliktzahl, stehen gebliebene Fahrgäste,
Sitzplatzauslastung **je Abschnitt** und der Deckungsbeitrag je Linie. Die Streckenauslastung
in Prozent der theoretischen Kapazität und ihre Heatmap über die Karte fehlen noch — das ist
vermutlich das nützlichste Analysewerkzeug des ganzen Spiels und steht deshalb weit oben in
Phase 4.

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
