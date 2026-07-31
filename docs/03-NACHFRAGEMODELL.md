# 03 — Nachfragemodell

Das Modell hat drei Stufen, wie in der echten Verkehrsplanung:

1. **Verkehrserzeugung** — wie viele Reisen entstehen in Stadt *i* je Segment?
2. **Verkehrsverteilung** — wohin gehen sie? (Gravitationsmodell)
3. **Verkehrsmittelwahl** — Bahn, Bus, Auto oder gar nicht? (Logit-Modell)

Stufe 1 und 2 sind statisch und werden **einmal in der Datenpipeline** berechnet — sie hängen
nur von Städten und Einrichtungen ab, nicht vom Spielernetz. Stufe 3 läuft im Spiel und
reagiert auf Preis, Fahrzeit und Takt. Das ist der Grund für die Aufteilung: die teure
Rechnung passiert offline, die spielrelevante online.

---

## 1. Segmente und ihre Parameter

| Segment | Anteil an Bevölkerung `s` | Reisen/Person/Tag `r` | Distanzabkling. `d₀` (km) | Untergrenze `dₘᵢₙ` | Zeitwert €/h | Preis-β |
|---|---|---|---|---|---|---|
| `commuter` (Berufspendler) | 0,48 | 0,085 | 35 | 5 | 12,00 | −0,055 |
| `pupil` (Schüler) | 0,11 | 0,060 | 18 | 3 | 3,00 | −0,140 |
| `student` (Studenten) | 0,035 | 0,045 | 160 | 20 | 5,00 | −0,110 |
| `business` (Geschäftsreisende) | 0,05 | 0,030 | 420 | 40 | 45,00 | −0,012 |
| `tourist` (Touristen) | 1,00 | 0,006 | 600 | 60 | 8,00 | −0,048 |
| `vfr` (Besuchsreisende) | 1,00 | 0,012 | 260 | 25 | 9,00 | −0,060 |

*Die Zahlen sind Startwerte für die Kalibrierung, keine Messwerte.* Sie sind so gewählt, dass
sich für bekannte Relationen (München–Nürnberg, Paris–Lyon, Köln–Düsseldorf) plausible
Größenordnungen ergeben. Kalibriert wird gegen echte Fahrgastzahlen einiger Referenzstrecken —
siehe Abschnitt 6.

`s` = Anteil der Bevölkerung, der überhaupt zu diesem Segment gehört. Bei `tourist` und `vfr`
steht 1,00, weil jeder gelegentlich Tourist ist; die Seltenheit steckt in `r`.

---

## 2. Stufe 1 — Verkehrserzeugung

**Quellpotenzial** von Stadt *i* für Segment *k*:

```
O_i,k = P_i · s_k · r_k · c_land(i,k)
```

- `P_i` = Einwohnerzahl
- `c_land` = Länderkorrektur (Studierendenquote, Motorisierungsgrad, Urlaubstage). Startwert 1,0,
  später aus Eurostat-Kennzahlen.

**Zielattraktivität** von Stadt *j* für Segment *k*:

```
A_j,k = P_i^ω_k · Π(Einrichtungsfaktoren für k) · saison(monat)
```

mit `ω_k` als Größendegression:

| Segment | `ω` | Interpretation |
|---|---|---|
| commuter | 1,15 | Große Städte ziehen überproportional Pendler (Arbeitsplatzdichte) |
| pupil | 0,80 | Schulen skalieren unterproportional |
| student | 0,60 | Universität zählt mehr als Stadtgröße |
| business | 1,25 | Wirtschaftszentren dominieren stark |
| tourist | 0,55 | Ein Bergdorf kann mehr Touristen ziehen als eine Großstadt |
| vfr | 1,00 | folgt der Bevölkerung |

Einrichtungsfaktoren siehe [00-KONZEPT §4](00-KONZEPT.md#4-städte-und-einrichtungen). Sie wirken
**nur auf `A`**, nie auf `O`.

---

## 3. Stufe 2 — Verteilung (Gravitationsmodell)

```
T_ij,k = O_i,k · A_j,k · f_k(d_ij) / Σ_m ( A_m,k · f_k(d_im) )
```

Die Normierung über alle Ziele *m* sorgt dafür, dass jede Stadt exakt ihr Quellpotenzial
verteilt — die Gesamtzahl der Reisen ist damit konsistent, egal wie viele Städte im Datensatz
sind. Das ist wichtig für die spätere Erweiterbarkeit: Neue Städte hinzuzufügen verwässert die
Verteilung korrekt, statt Nachfrage aus dem Nichts zu erzeugen.

**Abklingfunktion** — kombiniert Potenz und Exponential:

```
f_k(d) = (max(d, dₘᵢₙ,k))^(−0,6) · exp( −d / d₀,k )
```

Der Potenzterm bildet den steilen Nahbereichsabfall ab, der Exponentialterm kappt die
Fernbereichsausläufer. `dₘᵢₙ` verhindert die Singularität bei `d → 0`.
`d` ist die **Luftliniendistanz** — bewusst, denn die Nachfrage existiert unabhängig davon,
wie gut die Verbindung ist. Die Verbindungsqualität wirkt erst in Stufe 3.

**Speicherung**: Nur Paare mit `T_ij,k > 5` Reisen/Tag werden gespeichert. Bei ~4 000 Städten
über 20 000 Einwohnern ist die Matrix damit sehr dünn besetzt (Schätzung: < 2 Mio. Einträge
über alle Segmente).

---

## 4. Stufe 3 — Verkehrsmittelwahl (Logit)

Für jede Relation *(i, j)* und jedes Segment *k* stehen zur Wahl:
**Bahn**, **Bus**, **Auto** (immer verfügbar, Referenzalternative), **nicht reisen**.

**Generalisierte Kosten** einer Alternative *m*:

```
GK_m = preis_m
     + zeitwert_k · ( fahrzeit_m + 2,0 · umsteigezeit_m + 1,8 · wartezeit_m )
     + umsteigestrafe_k · anzahl_umstiege_m
     − komfortbonus_k · komfort_m
```

- **Wartezeit** = halber Takt, gedeckelt bei 45 min. Das macht Taktverdichtung direkt
  spürbar: 2-Stunden-Takt → 45 min Strafe, Stundentakt → 30 min, Halbstundentakt → 15 min.
  Genau der Hebel, den der Spieler ziehen soll.
- **Umsteigestrafe**: 8 min für `student`/`tourist`, 25 min für `business`, 15 min sonst.
- **Komfortbonus**: nur `business` (stark) und `tourist` (schwach) reagieren darauf.

**Nutzen und Anteile:**

```
U_m   = ASC_m,k − β_k · GK_m
P(m)  = exp(U_m) / Σ_n exp(U_n)
```

**Alternativspezifische Konstanten** `ASC` (Grundneigung, unabhängig von Kosten):

| Segment | Bahn | Bus | Auto | nicht reisen |
|---|---|---|---|---|
| commuter | +0,30 | −0,60 | 0 | −2,20 |
| pupil | +0,90 | +0,40 | −2,50 | −1,80 |
| student | +0,60 | +0,25 | −0,90 | −1,20 |
| business | +0,70 | −1,80 | 0 | −0,60 |
| tourist | +0,45 | −0,30 | 0 | −0,40 |
| vfr | +0,10 | −0,40 | 0 | −0,90 |

Diese Tabelle ist der eigentliche Charaktergeber des Spiels. Sie sagt: Schüler haben kein Auto,
Geschäftsreisende steigen nicht in den Bus, Touristen sind flexibel. Sie ist bewusst als
**reine Datentabelle** modelliert, damit man sie beim Balancing anfassen kann, ohne Code zu ändern.

**Auto-Referenz**: Fahrzeit aus der OSRM-Matrix, Kosten mit 0,32 €/km angesetzt (Kraftstoff +
Verschleiß, ohne Fixkosten — so entscheiden Menschen tatsächlich). Damit hat die Bahn auf
Kurzstrecken einen strukturellen Nachteil und muss über Takt und Preis gewinnen.

---

## 5. Tages- und Wochenganglinie

Die Tagesnachfrage wird auf 24 Stundenscheiben verteilt. Jedes Segment hat ein eigenes Profil
(Anteile, Summe = 1):

```
commuter : zwei scharfe Spitzen 6–9 und 16–19 Uhr, dazwischen fast nichts
pupil    : Spitze 7–8 Uhr, Rückweg 13–16 Uhr, sonst null
student   : breit über den Tag, Wochenspitzen Fr 14–19 und So 15–21 Uhr
business : 6–9 Uhr hin, 16–20 Uhr zurück, aber deutlich flacher als commuter
tourist  : breit 9–18 Uhr, Wochenendspitze, Sommerfaktor bis 2,2
vfr      : Fr nachmittag / So abend
```

Die Wochentagsfaktoren sind je Segment eine 7er-Tabelle. Ein Zug, der um 3 Uhr nachts fährt,
findet praktisch keine Nachfrage — der Spieler muss also den Fahrplan an die Ganglinien
anpassen, nicht einfach im starren Takt durchfahren. Das ist ein zweiter, subtiler
Optimierungshebel neben der Kapazität.

**Saisonalität**: Monatsfaktor je Segment; `tourist` schwankt zwischen 0,45 (November) und
2,20 (August), `pupil` fällt in den Sommerferien auf 0,15.

---

## 6. Zuordnung auf konkrete Züge

Wenn ein Zug einen Bahnhof erreicht:

```
1. Nachfragepool der Relation (i,j,k,stunde) bestimmen
2. Anteil der Bahn aus dem Logit-Modell
3. × catchment(Quellbahnhof) × catchment(Zielbahnhof)
4. Auf konkurrierende Zugläufe im Zeitfenster ±30 min aufteilen
   (proportional zum Nutzen — ein schnellerer Zug bekommt mehr)
5. Kapazität prüfen: passt nicht alles rein, bleiben Fahrgäste stehen
   → Unzufriedenheit, die die ASC der Relation temporär senkt
```

Punkt 5 ist wichtig: Überfüllung darf nicht folgenlos bleiben. Ein „Zufriedenheitswert" je
Relation, der bei Stehenbleiben und Verspätung sinkt und sich langsam erholt, modelliert
Kundenbindung und bestraft Unterkapazität nachhaltig.

---

## 7. Preisbildung

Der Spieler setzt je Linie einen Grundpreis pro km und einen `priceIndex`. Der Erlös:

```
fahrpreis = baseFare + perKm · entfernung_km · priceIndex
```

Über `β_k` reagiert jedes Segment unterschiedlich auf Preisänderungen. Das erzeugt die
zentrale wirtschaftliche Entscheidung: Eine Hochpreis-Fernverkehrslinie lebt von
Geschäftsreisenden bei geringer Auslastung; eine Billiglinie füllt sich mit Studenten, braucht
aber mehr Züge für denselben Umsatz — und Züge kosten Unterhalt und Trassenkapazität.

Optional später: **Klassen** (1./2.) mit getrennter Preissetzung, und Zeitkarten für Pendler
(Rabatt gegen garantierte Nachfrage).

---

## 8. Kalibrierung

`pnpm calibrate` (Skript in `tools/calibrate.ts`) erzeugt einen Bericht über alle drei
Stufen plus die Wirtschaftlichkeit. Er ist zum Lesen gedacht, nicht zum Bestehen: es gibt
keine Sollgröße, sondern Größenordnungen, die man gegen die Wirklichkeit hält.

### Stand nach Phase 1

**Was gegenüber den Startwerten geändert wurde und warum:**

1. **Bestandsverkehr ergänzt.** Ohne ihn hätte die erste Buslinie ein Monopol auf den
   gesamten öffentlichen Verkehr eines Korridors gehabt — München–Augsburg amortisierte
   sich in 96 Tagen. Der Bestandsverkehr ist ein durchschnittliches Regionalbahnangebot,
   dessen Qualität von der **kleineren** der beiden Städte abhängt: Großstädte liegen an
   Hauptstrecken (Stundentakt, 95 km/h), Kleinstädte an Nebenbahnen (3-Stunden-Takt,
   60 km/h, ein Umstieg). Ohne diese Staffelung wäre zwischen Bayreuth und Hof dasselbe
   Angebot unterstellt wie zwischen München und Augsburg.

2. **`ASC` für den Bus deutlich gesenkt** (Berufspendler −0,6 → −1,8; Geschäftsreisende
   −1,8 → −2,6). Die Startwerte ergaben 25 % Busanteil bei Pendlern auf einer 70-km-Relation
   — real liegt der Interregio-Busanteil bei wenigen Prozent.

3. **Betriebskosten realistisch angehoben.** `fuelCostPerKm` deckt jetzt auch Reifen und
   Verschleiß, `crewCostPerHour` ist Arbeitgeberaufwand statt Bruttolohn (22 → 38 €/h).
   Neu ist ein Verwaltungs- und Vertriebsanteil von 18 % des Fahrgelderlöses plus 80 €/Tag
   je betriebener Linie. Ohne diesen Posten war jede Linie absurd profitabel: Kraftstoff
   und Personal decken den Fahrbetrieb ab, nicht den Apparat drumherum.

**Ergebnis** (Wochenmittel, Bayern-Datensatz):

| Korridor | Angebot | Fahrgäste/Tag | Ergebnis | Amortisation |
|---|---|---|---|---|
| München–Augsburg (71 km) | 4 Überlandbusse, 60′ | 919 | +6 454 €/Tag | 0,4 Jahre |
| München–Augsburg | 8 Reisebusse, 30′ | 1 335 | +7 167 €/Tag | 0,8 Jahre |
| Nürnberg–Fürth–Erlangen (25 km) | 4 Überlandbusse, 60′ | 985 | +2 163 €/Tag | 1,3 Jahre |
| München–Ingolstadt (88 km) | 4 Überlandbusse, 60′ | 282 | −474 €/Tag | Verlust |
| Bayreuth–Hof (59 km) | 3 Überlandbusse, 60′ | 64 | −2 217 €/Tag | Verlust |
| Bayreuth–Hof | 1 Kleinbus, 180′ | 15 | −604 €/Tag | Verlust |
| München–Augsburg | 24 Überlandbusse, 10′ | 1 592 | −2 074 €/Tag | Verlust |

Das ist die gewünschte Form: **nur dichte Korridore tragen sich, Überangebot wird bestraft,
und Skalierung senkt die Rendite** — die erste Linie ist ein Glücksfall, jede weitere harte
Arbeit. Dass München–Augsburg sich in unter einem Jahr amortisiert, ist die Belohnung dafür,
den stärksten Korridor Bayerns gefunden zu haben.

**Ehrliche Einschränkung:** Kalibriert ist gegen Plausibilität, nicht gegen Messwerte.
Der Abgleich mit echten Fahrgastzahlen von Referenzstrecken steht noch aus — dafür braucht es
Zahlen, die frei verfügbar und vergleichbar sind. Bis dahin gilt: die *Verhältnisse* zwischen
Korridoren sind belastbarer als die absoluten Zahlen.

### Vorgehen für die nächste Runde

1. Referenzrelationen mit bekannten Fahrgastzahlen zusammenstellen (10–15 Stück, gemischt
   nach Distanz und Land).
2. Verhältnis Modell/Realität je Relation ermitteln, globale Skalierung am Median setzen.
3. `d₀` je Segment anpassen, bis die Distanzverteilung stimmt.
4. `ASC` anpassen, bis die Modal-Split-Anteile passen.
5. Ergebnis als Regressionstest festhalten, damit spätere Parameteränderungen das Balancing
   nicht unbemerkt zerstören.
