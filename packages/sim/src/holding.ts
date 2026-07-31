/**
 * Anschlusssicherung: warten oder pünktlich weiterfahren.
 *
 * Bis hierher fuhr die Anschlusslinie immer nach Plan. Damit war ein Anschluss
 * mit null Minuten Puffer im Modell genauso zuverlässig wie einer mit zehn — die
 * Phasenlage entschied nur darüber, wie *lange* man wartet, nie darüber, ob man
 * überhaupt mitkommt. Ein Fahrplan ohne dieses Risiko lässt sich beliebig eng
 * legen, und die Entscheidung, die jeder Betrieb wirklich treffen muss, kam im
 * Spiel nicht vor.
 *
 * Jetzt gibt es sie: je Linie eine Höchstwartezeit. Wer sie auf null lässt,
 * fährt immer pünktlich los und lässt Umsteiger stehen. Wer wartet, holt sie ab
 * und schleppt die Verspätung durch die ganze eigene Linie — sie trifft alle an
 * Bord, nicht nur die Umsteiger.
 *
 * ## Warum eine Verteilung statt einzelner Fahrten
 *
 * Das Modell rechnet mit Takten und mittleren Verspätungen, nicht mit einzelnen
 * Zügen. Die Frage „kommt der Zubringer heute rechtzeitig?" hat deshalb keine
 * Ja-Nein-Antwort, sondern eine Wahrscheinlichkeit. Angenommen wird eine
 * **Exponentialverteilung** mit der bekannten mittleren Verspätung: die meisten
 * Fahrten sind fast pünktlich, wenige sehr spät. Das ist die übliche erste
 * Näherung für Verspätungen und die einzige Verteilung, die aus einem einzigen
 * beobachteten Mittelwert folgt, ohne weitere Annahmen hineinzuschmuggeln.
 *
 * Damit lässt sich beides geschlossen ausrechnen — kein Würfeln, kein
 * Iterieren:
 *
 * - erwartete Haltezeit `E[min(c, (d−s)⁺)] = m·e^(−s/m)·(1−e^(−c/m))`
 * - verpasste Anschlüsse `P(d > s+c) = e^(−(s+c)/m)`
 *
 * mit `m` mittlere Verspätung des Zubringers, `s` Puffer (die geplante Wartezeit
 * am Bahnsteig) und `c` Höchstwartezeit der Anschlusslinie.
 *
 * Beide Formeln zeigen dieselbe Abwägung aus zwei Richtungen: mehr Puffer senkt
 * beides, aber verlängert die Reise für alle. Mehr Wartebereitschaft senkt die
 * verpassten Anschlüsse und erhöht die eigene Verspätung.
 *
 * ## Was bewusst nicht modelliert ist
 *
 * Ein gehaltener Anschluss verspätet die eigene Linie — aber diese Verspätung
 * löst **keine zweite Runde** von Anschlusssicherungen aus. Sonst müsste ein
 * Fixpunkt über das ganze Netz iteriert werden, und zwei Linien, die
 * gegenseitig aufeinander warten, würden dabei nicht konvergieren, sondern sich
 * hochschaukeln. Eine Runde ist die ehrliche Auflösung: die Verspätung, die aus
 * dem Betrieb kommt, wird weitergereicht; die, die aus dem Warten entsteht,
 * bleibt bei der wartenden Linie.
 *
 * Und: gewartet wird auf jeden möglichen Zubringer, nicht nur auf einen mit
 * tatsächlichen Umsteigern. Wie viele Fahrgäste an einem einzelnen Anschluss
 * hängen, weiß das Modell erst nach der Nachfrageverteilung — also nach dem
 * Fahrplan. In der Praxis ist der Unterschied klein, weil nur verspätete Linien
 * überhaupt einen Halt auslösen und Buslinien mit null Verspätung gar keinen.
 *
 * Hier steht nur die Rechnung. Angewandt wird sie in `connections.ts`, wo die
 * konkreten Umsteigepunkte des Netzes bekannt sind.
 */

/**
 * Erwartete Haltezeit an einem Anschluss.
 *
 * @param meanDelaySec mittlere Verspätung des Zubringers
 * @param slackSec geplante Wartezeit am Bahnsteig — der Puffer
 * @param maxHoldSec wie lange die Anschlusslinie höchstens wartet
 */
export function expectedHoldSec(meanDelaySec: number, slackSec: number, maxHoldSec: number): number {
  if (meanDelaySec <= 0 || maxHoldSec <= 0) return 0
  const s = Math.max(0, slackSec)
  return meanDelaySec * Math.exp(-s / meanDelaySec) * (1 - Math.exp(-maxHoldSec / meanDelaySec))
}

/** Wie oft der Zubringer überhaupt zu spät für den Anschluss ist. */
export function holdProbability(meanDelaySec: number, slackSec: number): number {
  if (meanDelaySec <= 0) return 0
  return Math.exp(-Math.max(0, slackSec) / meanDelaySec)
}

/**
 * Wie oft ein gehaltener Anschluss die Fahrt **unpünktlich** macht.
 *
 * Nicht dasselbe wie `holdProbability`: dort zählt jede Sekunde Warten, hier
 * nur, was über der Pünktlichkeitsschwelle liegt. Der Unterschied ist nicht
 * kosmetisch. Hinter einem Zubringer mit zehn Minuten mittlerer Verspätung
 * wartet ein knapper Anschluss fast immer *ein bisschen* — zählte das als
 * unpünktlich, stünde jede wartende Linie bei zehn Prozent Pünktlichkeit,
 * während dieselben zwei Minuten Verspätung aus dem Betrieb heraus als
 * pünktlich durchgingen. Zwei Maßstäbe für dieselbe Verspätung.
 *
 * Wartet die Linie höchstens bis zur Schwelle, kann sie daran gar nicht
 * scheitern — der Halt ist nach oben begrenzt.
 */
export function holdLateChance(
  meanDelaySec: number,
  slackSec: number,
  maxHoldSec: number,
  thresholdSec: number,
): number {
  if (meanDelaySec <= 0 || maxHoldSec <= thresholdSec) return 0
  return Math.exp(-(Math.max(0, slackSec) + thresholdSec) / meanDelaySec)
}

/**
 * Anteil der Umsteiger, die den Anschluss trotz allem verpassen.
 *
 * Ohne Anschlusssicherung ist das genau der Anteil, dessen Zubringer den Puffer
 * überschreitet. Mit ihr verschiebt sich die Schwelle um die Wartezeit.
 */
export function missProbability(meanDelaySec: number, slackSec: number, maxHoldSec: number): number {
  if (meanDelaySec <= 0) return 0
  return Math.exp(-(Math.max(0, slackSec) + Math.max(0, maxHoldSec)) / meanDelaySec)
}
