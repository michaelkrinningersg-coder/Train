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
| commuter | +0,30 | −1,80 | 0 | −2,20 |
| pupil | +0,90 | +0,20 | −2,50 | −1,80 |
| student | +0,60 | −0,40 | −0,90 | −1,20 |
| business | +0,70 | −2,60 | 0 | −0,60 |
| tourist | +0,45 | −1,00 | 0 | −0,40 |
| vfr | +0,10 | −1,10 | 0 | −0,90 |

Diese Tabelle ist der eigentliche Charaktergeber des Spiels. Sie sagt: Schüler haben kein Auto,
Geschäftsreisende steigen nicht in den Bus, Touristen sind flexibel. Sie ist bewusst als
**reine Datentabelle** modelliert, damit man sie beim Balancing anfassen kann, ohne Code zu ändern.

**Und was ist die Konstante einer Reisekette aus Bus und Bahn?** Die naheliegende Antwort —
die des längsten Teilstücks — ist falsch, und zwar sichtbar falsch. Zwischen `rail` (+0,30) und
`bus` (−1,80) liegen bei Berufspendlern gut zwei Nutzenpunkte, also Faktor acht in den
Fahrgastzahlen. Eine Kette, deren Busabschnitt zwei Minuten länger wird als der Bahnabschnitt,
verlöre in einem Schritt sieben Achtel ihrer Fahrgäste. Das ist keine Modellaussage, sondern
ein Artefakt der Maximumsbildung — aufgefallen ist es, als die Anschlusssicherung dem
Zubringerbus ein paar Minuten Wartezeit eintrug und die Umsteigerzahl um den Faktor sieben
einbrach.

Deshalb trägt jede Alternative optional ein **Verkehrsmittelgemisch** (`modeMix`): den nach
Fahrzeit gewichteten Anteil jedes Verkehrsmittels. Die Konstante wird daraus anteilig gebildet.
Eine Kette aus 60 % Bahnfahrt und 40 % Busfahrt liegt zwischen beiden Konstanten und bewegt
sich stetig, wenn sich die Anteile verschieben. Für eine Direktverbindung ändert sich nichts —
dort ist das Gemisch die eine Konstante selbst.

Dieselbe Kante gab es beim **Bestandsverkehr**: er fällt weg, wo der Spieler die Relation mit
der Bahn übernimmt. Maßgeblich ist jetzt, ob *irgendeine* Teilstrecke auf der Schiene liegt,
nicht ob die längste es tut — sonst kehrte die Konkurrenz zurück, weil der Zubringerbus zwei
Minuten länger braucht, während der Spieler dieselbe Bahnfahrt anbietet wie zuvor.

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

Der Ablauf steht in `packages/sim/src/day.ts`; die Rechenschritte verteilen sich
auf `itineraries.ts`, `demandAssignment.ts` und `assignment.ts`. Er ist für Bus und
Bahn derselbe:

```
Einmal je Betriebstag für das ganze Netz:
  1. Angebot jeder Linie bestimmen (Fahrzeiten, Takt, Plätze, Pünktlichkeit)
  2. Verbindungen bilden: direkt und mit einem Umstieg (siehe unten)

Je Relation (i,j) und Segment k:
  3. Nachfragepool aus der Gravitationsmatrix × Wochentag- und Monatsfaktor
  4. Logit über: alle Verbindungen des eigenen Netzes, Auto,
     Bestandsverkehr (nur ohne eigene Bahn), Zuhausebleiben
     — die Zufriedenheit der Relation als Abschlag auf die eigenen Alternativen
  5. × catchment(Quellhalt) × catchment(Zielhalt) der gewählten Verbindung
  6. auf die 24 Stunden verteilt über die Tagesganglinie des Segments
  7. auf jedes Teilstück der Verbindung gebucht

Je Linie, Stunde und Fahrtrichtung:
  8. belegung[abschnitt] = Σ aller Gruppen, die diesen Abschnitt durchfahren
  9. faktor[abschnitt]   = min(1, sitzeInDieserStunde / belegung[abschnitt])
 10. mitgenommen         = nachfrage · min über alle durchfahrenen Abschnitte
```

Schritt 1 bis 4 sind neu in Phase 4. Vorher zog **jede Linie ihren Anteil selbst**
aus der Matrix. Das ging, solange jede Relation von höchstens einer Linie bedient
wurde — und genau deshalb konnte niemand umsteigen, und zwei Linien auf demselben
Korridor bedienten beide die volle Nachfrage.

Die Schritte 6–8 sind der Punkt, an dem sich das Modell von einer Pauschale unterscheidet:
**ein Fahrgast besetzt nur die Abschnitte, die er wirklich fährt.** Am Zielhalt steigt er aus,
der Platz wird frei und weiterverkauft. Ein Zug fährt also nicht mit fester Füllung durch,
sondern wird unterwegs geleert und neu gefüllt — zwischen zwei Ballungsräumen überfüllt und
auf dem Land halb leer. Rationiert wird nur dort, wo es eng ist; wer eine Station auf freier
Strecke fährt, kommt mit, auch wenn zwei Abschnitte weiter niemand mehr zusteigt.

Ausführlich mit Beispielen in
[04-BETRIEBSSIMULATION §5a](04-BETRIEBSSIMULATION.md#5a-fahrgastzuordnung-der-zug-wird-unterwegs-geleert-und-neu-gefüllt).

### Verbindungen und Umsteigen

Umgesetzt in `packages/sim/src/itineraries.ts`. Zwei Entscheidungen prägen es:

**Umgestiegen wird in einer Stadt, nicht an einer Haltestelle.** Bushaltestelle und Bahnhof
derselben Stadt sind im Datenmodell getrennte Objekte an verschiedenen Orten. Wer den Umstieg
an die Haltestellen-Identität knüpft, schließt genau den Fall aus, um den es geht — den
Zubringerbus zum Bahnhof. Liegen die Halte auseinander, kostet der Fußweg Zeit
(`MIN_INTERCHANGE_SEC` plus 4,5 km/h Gehgeschwindigkeit).

**Rundenweise Suche statt Aufzählung.** Die erste Fassung zählte Ketten mit *genau einem*
Umstieg über alle Linienpaare auf. Das war kurz und richtig, ließ sich aber nicht erweitern:
jeder weitere Umstieg hätte eine Schleifenebene mehr gekostet. Die Suche arbeitet jetzt in
Runden nach der Bauart von **RAPTOR** — Runde 0 sind die Direktverbindungen, Runde *r* alles
mit *r* Umstiegen. Ein weiterer Umstieg ist damit eine Runde mehr, keine Umschreibung.

Standard sind **zwei Umstiege** (`MAX_TRANSFERS`); `buildOptions` nimmt die Zahl als Parameter.
Gemessen an einem bayerischen Busnetz mit 11 Linien:

| maxTransfers | bediente Relationen | davon mit Umstieg | Rechenzeit |
|---|---|---|---|
| 0 | 22 | 0 | 0,3 ms |
| 1 | 56 | 34 | 0,8 ms |
| **2** | **84** | **62** | **1,3 ms** |
| 3 | 100 | 78 | 2,8 ms |

Der zweite Umstieg erschließt 28 weitere Relationen für eine halbe Millisekunde. Der dritte
bringt noch 16 dazu — die schwächsten, weil drei Umsteigestrafen (je Segment 8 bis 25 Minuten,
doppelt gewichtet) den Nutzen weitgehend auffressen. Deshalb steht der Standard auf 2, nicht
weil mehr nicht ginge. Ein ganzer Betriebstag dieses Netzes rechnet in 5 ms.

**Was die Suche nicht tut:** einzelne Fahrten betrachten. Sie rechnet mit Takt und Fahrzeit,
nicht mit konkreten Abfahrtszeiten, und kennt deshalb keine knappen oder verpassten
Anschlüsse. Für ein Spiel, in dem der Spieler Takte plant und keine Einzelfahrten, ist das
die richtige Auflösung.

**Verdrängt wird zwischen Wegen, nicht zwischen Linien.** Die Suche behält je Stadt die vier
besten *Wege* (Städtefolge und Verkehrsmittel) und je Weg bis zu vier austauschbare
Linienkombinationen. Diese Unterscheidung ist nicht kosmetisch: eine Pareto-Verdrängung über
alle Ketten würde die zweite Linie eines Korridors wegwerfen, obwohl sie genau die ist, die
den gemeinsamen Takt verdichtet (siehe nächster Abschnitt).

### Warum austauschbare Linien zusammengefasst werden

Ein multinomiales Logit hat eine bekannte Schwäche, die in der Literatur *red bus / blue bus*
heißt: stellt man zwei praktisch gleiche Alternativen nebeneinander zur Wahl, bekommen sie
zusammen fast doppelt so viel Zuspruch wie eine allein. Im Spiel hieße das: eine zweite,
identische Buslinie auf denselben Korridor zu legen verdoppelt die Fahrgastzahlen — nicht
weil das Angebot besser wäre, sondern weil das Modell zweimal zählt.

Deshalb werden Verbindungen mit **derselben Städtefolge und denselben Verkehrsmitteln** zu
einer Alternative zusammengefasst, deren Takte sich addieren. Gerechnet wird **je
Teilstrecke**: an jedem Umsteigepunkt addieren sich die Takte der dort verfügbaren Linien zu
einem gemeinsamen, und die Wartezeit der Verbindung ist die Summe dieser Teilwartezeiten. Ein
einziger gemeinsamer Takt für die ganze Kette wäre falsch — wer zweimal umsteigt, wartet auch
zweimal.

Der Anteil einer einzelnen Linienkombination ist das Produkt ihrer Anteile an jedem
Umsteigepunkt: wer am Bahnsteig steht, nimmt was zuerst kommt, und das an jedem Punkt der
Reise neu.

Der Test dazu ist scharf formuliert: *zwei parallele Linien im Stundentakt müssen genau so
viele Fahrgäste bringen wie eine einzige im Halbstundentakt.*

### Anschlüsse: die Umsteigezeit entsteht aus der Phasenlage

Umgesetzt in `packages/sim/src/connections.ts`. Bis dahin kostete jeder Umstieg den halben
Takt der Anschlusslinie — eine Stundentaktlinie also im Mittel dreißig Minuten, ganz gleich wie
die beiden Fahrpläne zueinander lagen. Ein abgestimmter Anschluss war damit im Modell genauso
gut wie ein zufälliger.

Jetzt wird gerechnet, was tatsächlich passiert:

```
ankunft   = ersteAbfahrt(A) + fahrzeitBis(halt, richtung) + k · takt(A)
bereit    = ankunft + umsteigezeit          (Mindestzeit + Fußweg zwischen den Halten)
abfahrt   = ersteAbfahrt(B) + fahrzeitBis(halt, richtung) + j · takt(B)

wartezeit = umsteigezeit + ((abfahrt − bereit) mod takt(B))
```

Bei gleichem Takt ist die Wartezeit für jede Fahrt dieselbe — das ist der Normalfall eines
Taktfahrplans und der Grund, warum sich ein Anschluss überhaupt planen lässt. Bei ungleichen
Takten verschiebt sich die Lage von Fahrt zu Fahrt; dann wird über eine volle Periode
(kgV der beiden Takte) gemittelt.

Die Gegenrichtung wird aus der Hinrichtung abgeleitet, weil der Fahrplan symmetrisch ist:
gleiche Fahrzeit, gleiche Aufenthalte, gleiches Abfahrtsraster. Ein Gegenzug, der am anderen
Ende zur selben Zeit losfährt, erreicht Halt *i* genau `Umlaufzeit − Ankunft(i)` später.

**Was das für das Balancing bedeutet:** über alle Phasenlagen gemittelt ergibt sich wieder der
halbe Takt plus Umsteigezeit. Gemessen an einem 60-Minuten-Takt: 32,0 min gegenüber 32 min
nach der alten Pauschale. Die Mechanik verschiebt also nichts — sie gibt dem Spieler die Wahl
*innerhalb* dieser Verteilung. Genau das macht aus einer Rechengröße eine Spielmechanik.

**Und sie hat eine eingebaute Härte.** Dieselben zwei Linien, nur die Abfahrtsminute des
Zubringers verschoben:

| Abfahrt | Umstieg hin | zurück | **Summe** | Umsteiger/Tag |
|---|---|---|---|---|
| :00 | 23 min | 3 min | **26 min** | 51 |
| :10 | 13 min | 13 min | **26 min** | 51 |
| :20 | 3 min | 23 min | **26 min** | 52 |
| :30 | 53 min | 33 min | **86 min** | 31 |
| :40 | 43 min | 43 min | **86 min** | 31 |
| :50 | 33 min | 53 min | **86 min** | 31 |

Bei gleichem Takt beider Linien ist die **Summe** beider Umsteigerichtungen weitgehend
festgelegt; die Fahrgastzahlen folgen ihr und nicht der einzelnen Richtung. Man kann die gute
Hälfte der Phasenlagen treffen — und innerhalb davon wählen, welche Richtung man bevorzugt.
Beide Richtungen zugleich kurz zu bekommen geht nur, wenn Fahrzeit und Takt zueinander passen.
Das ist genau die Rechnung hinter einem Integralen Taktfahrplan.

### Anschlusssicherung: warten oder pünktlich weiterfahren

Die Phasenlage entscheidet, wie *lange* man umsteigt. Sie entscheidet noch nicht, ob man den
Anschluss überhaupt erreicht — dafür braucht es die Verspätung des Zubringers. Ohne die wäre
ein Anschluss mit null Minuten Puffer genauso zuverlässig wie einer mit zehn, und ein
Fahrplan ließe sich beliebig eng legen.

Deshalb bekommt jede Linie eine **Höchstwartezeit**: null, drei, fünf oder zehn Minuten.

Gerechnet wird nicht mit einzelnen Zügen — das Modell kennt Takte und mittlere Verspätungen,
keine Einzelfahrten. Die Frage „kommt der Zubringer heute rechtzeitig?" hat deshalb keine
Ja-Nein-Antwort, sondern eine Wahrscheinlichkeit. Angenommen ist eine **Exponentialverteilung**
mit der beobachteten mittleren Verspätung `m`: die meisten Fahrten fast pünktlich, wenige sehr
spät. Das ist die übliche erste Näherung und die einzige Verteilung, die aus einem einzigen
Mittelwert folgt, ohne weitere Annahmen hineinzuschmuggeln.

Mit `s` als Puffer (der geplanten Wartezeit am Bahnsteig) und `c` als Höchstwartezeit:

| Größe | Formel |
|---|---|
| erwartete Haltezeit der Anschlusslinie | `m · e^(−s/m) · (1 − e^(−c/m))` |
| Anteil verpasster Anschlüsse | `e^(−(s+c)/m)` |
| Anteil der Fahrten, die überhaupt warten | `e^(−s/m)` |

Beides geschlossen — kein Würfeln, kein Iterieren, kein Fixpunkt.

**Was der Spieler davon merkt.** Wer nicht wartet, hält seine Linie pünktlich und lässt
Umsteiger stehen; wer wartet, holt sie ab und verspätet dafür *alle* an Bord, nicht nur die
Umsteiger. Der verpasste Anschluss kostet den Reisenden einen vollen Takt zusätzliche
Wartezeit — er geht als solcher in die Nutzenrechnung der Reisekette ein und außerdem in ihre
Pünktlichkeit, und über die in die Zufriedenheit der Relation. Ein knapper Anschluss hinter
einem unpünktlichen Zubringer ist ab 15 % verpasster Umsteiger im Anschlusspanel als
*riskant* markiert, unabhängig davon, wie kurz er auf dem Papier ist.

**Eine Runde, kein Fixpunkt.** Die durch Warten entstandene Verspätung löst keine zweite Runde
Anschlusssicherungen aus. Sonst müsste über das ganze Netz iteriert werden, und zwei Linien,
die gegenseitig aufeinander warten, würden dabei nicht konvergieren, sondern sich
hochschaukeln. Die Verspätung aus dem Betrieb wird weitergereicht; die aus dem Warten bleibt
bei der wartenden Linie.

**Gewartet wird auf jeden möglichen Zubringer**, nicht nur auf einen mit tatsächlichen
Umsteigern. Wie viele Fahrgäste an einem einzelnen Anschluss hängen, weiß das Modell erst nach
der Nachfrageverteilung — also nach dem Fahrplan. Praktisch ist der Unterschied klein: nur
verspätete Linien lösen überhaupt einen Halt aus, und eine Buslinie mit null Verspätung gar
keinen.

**Noch nicht umgesetzt** und bewusst aufgeschoben:

- Die Aufteilung auf konkurrierende Zugläufe im Zeitfenster ±30 min proportional zum Nutzen.
  Aktuell zählt die Summe der Sitzplätze einer Stunde. Bei einem Taktfahrplan mit gleichen
  Zügen ist das dasselbe Ergebnis; interessant wird es erst, wenn Eil- und Nahverkehrszüge
  auf derselben Linie fahren.
- Die Reihenfolge am Bahnsteig: alle Gruppen eines Abschnitts werden gleich behandelt.
- Ein Umsteiger, der auf einem späteren Teilstück keinen Platz mehr bekommt, gilt als *anteilig*
  bedient statt als gestrandet. Die Wahrheit bräuchte einen zweiten Zuordnungsdurchgang;
  der Fahrschein für das erste Teilstück wäre in beiden Fällen verkauft.

---

## 6a. Zufriedenheit: das Gedächtnis der Nachfrage

Umgesetzt in `packages/sim/src/satisfaction.ts`. Jede Relation trägt einen Wert zwischen 0
und 1, Startwert 1. Nach jedem Betriebstag:

```
bedient  = mitgenommen / gewollt          (nur Stunden mit Betrieb)
qualität = bedient^2,5 · (0,6 + 0,4 · pünktlichkeit)

neu = alt + (qualität − alt) · rate       rate = 0,22 abwärts, 0,015 aufwärts
```

Der Wert wirkt als Abschlag auf die alternativspezifische Konstante der eigenen Angebote:
`ascOffset = (zufriedenheit − 1) · 2,2`. Bei 0,7 sind das −0,66 Nutzenpunkte — spürbar, aber
nicht vernichtend.

Drei Entscheidungen dahinter:

1. **Der Exponent 2,5.** Ohne ihn misst die Zufriedenheit den Tagesdurchschnitt: wer in der
   Hauptverkehrszeit die Hälfte stehen lässt, über den Tag aber 90 % mitnimmt, käme auf 90 %.
   Wer einmal nicht in den Bus gepasst hat, erinnert sich daran länger als an die neun Male,
   in denen es klappte — und er erzählt es weiter. 90 % mitgenommen werden so zu 77 %
   Zufriedenheit, 60 % zu 28 %.

2. **Die Asymmetrie 0,22 gegen 0,015.** Der Ruf fällt in Tagen und erholt sich in Monaten.
   Genau dieses Verhältnis macht Unterkapazität zu einem Fehler mit Nachwirkung statt zu
   einer verpassten Tageseinnahme. Ein überfahrener Korridor lässt sich nicht mit einem
   einzigen zusätzlichen Bus reparieren.

3. **Nachfrage außerhalb der Betriebszeit zählt nicht.** Dass um 23 Uhr nichts fährt, weiß
   der Reisende vorher, und die Verkehrsmittelwahl hat den dünnen Takt über die Wartezeit
   längst bestraft. Ihn hier ein zweites Mal zu bestrafen machte aus jedem Dreistundentakt
   eine Katastrophe, obwohl kein einziger Fahrgast stehen geblieben ist. Diese Unterscheidung
   ist der Grund, warum schwach ausgelastete Linien nach Phase 4 exakt dieselben Zahlen
   liefern wie vorher — der Mechanismus fasst nur an, was wirklich überfüllt ist.

Relationen ohne Bedienung erholen sich ebenfalls: wer einen Korridor aufgibt und Jahre später
zurückkehrt, findet keinen verbrannten Markt vor, sondern Leute, die sich nicht mehr erinnern.

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

Der Bericht hat sechs Abschnitte: Nachfrage, Verkehrsmittelwahl, Buswirtschaftlichkeit,
Schieneninfrastrukturkosten, Bahnbetrieb (Phase 3) und Netzwirkungen (Phase 4).

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

### Stand nach Phase 3 — Bahnbetrieb

Abschnitt 5 des Berichts baut denselben Korridor München–Augsburg (56 km Schiene) in
verschiedenen Ausbaustufen und Takten, jeweils an einem Dienstag mit Elektrotriebzügen
(206 Sitze, 140 km/h), sofern nicht anders angegeben:

| Ausbau | Takt | Züge/Ri | Pünktlichkeit | Ø Verspätung | Fahrgäste | schwächster Abschnitt |
|---|---|---|---|---|---|---|
| eingleisig 160 | 120′ | 9 | 50 % | 13,0 min | 2 894 | 392 % |
| eingleisig 160 | 60′ | 17 | 50 % | 13,0 min | 5 971 | 463 % |
| eingleisig 160 | 30′ | 33 | 11 % | 25,7 min | 9 262 | 251 % |
| **+ eine Überholstelle** | 60′ | 17 | **100 %** | **0,2 min** | 6 133 | 488 % |
| **+ eine Überholstelle** | 30′ | 33 | **100 %** | **0,2 min** | 9 872 | 280 % |
| zweigleisig 160 | 30′ | 33 | 100 % | 0,0 min | 9 846 | 286 % |
| zweigleisig 160 | 15′ | 65 | 100 % | 0,0 min | 13 927 | 152 % |
| zweigl. 200 + ETCS L2, 250-km/h-Zug | 30′ | 33 | 100 % | 0,0 min | 14 427 | 97 % |

Drei Dinge liest man daran ab, und alle drei sind so gewollt:

1. **Auf durchgehend eingleisiger Strecke hilft ein dünnerer Takt nicht.** 120′ und 60′
   liefern dieselbe Verspätung, weil jede einzelne Begegnung denselben Preis hat: ein Zug
   wartet, bis der andere die ganzen 56 km geräumt hat. Erst die Überholstelle ändert die
   Struktur, und sie kostet einen Bruchteil des zweigleisigen Ausbaus.
2. **Ein Streckenausbau nützt nur dem Zug, der ihn nutzen kann.** Der 140-km/h-Triebzug
   fährt auf dem 200-km/h-Gleis exakt dieselben Zahlen wie auf dem 160er. Wer die Trasse
   ausbaut, ohne den Fuhrpark mitzunehmen, hat Geld verbrannt.
3. **Über 100 % Abschnittsauslastung hilft ein größerer Zug mehr als ein dichterer Takt.**
   Der Doppelstockzug bringt bei gleichem 30′-Takt 13 743 statt 9 846 Fahrgäste.

**Einschränkung zum Bahnbetrieb:** die Auslastungswerte über 400 % sind kein Betriebszustand,
den irgendjemand hinnähme — sie sagen nur, dass zwischen München und Augsburg vier- bis
fünfmal so viel Nachfrage steht wie Sitzplätze angeboten werden. Seit Phase 4 bleibt das
nicht folgenlos (siehe unten), aber die Zahl selbst ist weiterhin als *Bedarfsanzeige* zu
lesen und nicht als realistischer Füllgrad.

### Stand nach Phase 4a — Umsteigen und Überlastung

Abschnitt 6 des Berichts fährt dieselbe Relation ein halbes Jahr lang mit verschieden viel
Kapazität. Die Zufriedenheit braucht Wochen, um sich einzupendeln, deshalb der lange Vorlauf.

| Angebot München–Augsburg | Fahrgäste/Tag | Spitzenauslastung | Zufriedenheit | Ergebnis |
|---|---|---|---|---|
| 120′ mit 2 Bussen | 414 | 133 % | 83 % | +2 602 €/Tag |
| 60′ mit 4 Bussen | 941 | 160 % | 80 % | +6 675 €/Tag |
| 30′ mit 8 Bussen | 1 572 | 131 % | 91 % | **+10 284 €/Tag** |
| 15′ mit 16 Bussen | 2 084 | 89 % | 100 % | +9 440 €/Tag |

Das ist die gewünschte Form: **es gibt ein Optimum, und es liegt nicht am Rand.** Wer zu
knapp fährt, verliert über Monate Fahrgäste an das Auto; wer zu üppig fährt, verbrennt Geld
im Betriebsaufwand. Der 30-Minuten-Takt trifft beides.

Der Umsteigeblock zeigt den zweiten Effekt:

| | Fahrgäste/Tag | davon Umsteiger |
|---|---|---|
| nur München–Augsburg (30′) | 1 572 | 0 |
| + Zubringer Landsberg–Augsburg | 1 661 | 65 |
| + Anschluss München–Rosenheim | 2 065 | 75 |

Landsberg hat keine eigene Verbindung nach München und bekommt sie über den Umstieg in
Augsburg. Die dritte Linie bringt mehr als ihre eigene Relation: Landsberg erreicht über
**zwei** Umstiege auch Rosenheim. Genau das ist der Unterschied zwischen einer Sammlung von
Korridoren und einem Netz — und vor Phase 4 wäre diese Nachfrage schlicht verschwunden.

**Ehrliche Einschränkung:** die Zufriedenheit pendelt sich ungefähr dort ein, wo der
mitgenommene Anteil liegt. Der Exponent 2,5 und die Gewichte sind gesetzt, nicht gemessen —
es gibt keine Erhebung dazu, wie lange jemand einem verpassten Bus nachträgt. Was sich
verteidigen lässt, ist die *Richtung* und die Größenordnung des Verhältnisses von Verfall zu
Erholung; die absoluten Zahlen sind Balancing.

### Vorgehen für die nächste Runde

1. Referenzrelationen mit bekannten Fahrgastzahlen zusammenstellen (10–15 Stück, gemischt
   nach Distanz und Land).
2. Verhältnis Modell/Realität je Relation ermitteln, globale Skalierung am Median setzen.
3. `d₀` je Segment anpassen, bis die Distanzverteilung stimmt.
4. `ASC` anpassen, bis die Modal-Split-Anteile passen.
5. Ergebnis als Regressionstest festhalten, damit spätere Parameteränderungen das Balancing
   nicht unbemerkt zerstören.
