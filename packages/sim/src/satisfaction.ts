/**
 * Zufriedenheit je Relation.
 *
 * Bis Phase 3 war Überfüllung folgenlos: wer keinen Platz bekam, fehlte im
 * Tagesumsatz und war am nächsten Morgen wieder da, als wäre nichts gewesen. Ein
 * Zug mit 400 % Auslastung war deshalb kein Problem, sondern nur eine
 * Gelegenheit, die man liegen ließ. Das ist der Grund, warum sich das Spiel bis
 * dahin nicht verlieren ließ.
 *
 * Jede Relation trägt jetzt einen Wert zwischen 0 und 1. Er fällt, wenn
 * Fahrgäste stehen bleiben oder Züge zu spät kommen, und er wirkt als Abschlag
 * auf den Nutzen des eigenen Angebots — die Leute nehmen wieder das Auto.
 *
 * Entscheidend ist die **Asymmetrie**: der Wert fällt gut zehnmal schneller, als
 * er sich erholt. Wer einen Sommer lang überfüllt fährt, hat den Ruf in zwei
 * Wochen ruiniert und braucht ein halbes Jahr, um ihn zurückzugewinnen. Genau
 * dieses Verhältnis macht Unterkapazität zu einem Fehler mit Nachwirkung statt
 * zu einer verpassten Tageseinnahme.
 */

/** Anteil pro Tag, um den sich der Wert einem schlechten Erlebnis annähert. */
export const SATISFACTION_DROP_RATE = 0.22
/** Und um den er sich erholt. Bewusst rund ein Fünfzehntel davon. */
export const SATISFACTION_RECOVERY_RATE = 0.015
/** Was ein vollständig verspielter Ruf im Logit-Modell kostet. */
export const SATISFACTION_ASC_WEIGHT = 2.2
/** Gewicht der Pünktlichkeit an der Bewertung; der Rest ist Mitkommen. */
export const PUNCTUALITY_WEIGHT = 0.4

/**
 * Wie stark ein schlechter Tag über sein Ausmaß hinaus nachwirkt.
 *
 * Ohne diesen Exponenten misst die Zufriedenheit den *Tagesdurchschnitt*: wer
 * in der Hauptverkehrszeit die Hälfte stehen lässt, über den Tag aber 90 % aller
 * Reisenden mitnimmt, käme auf 90 %. Das wird der Sache nicht gerecht. Wer
 * einmal nicht in den Bus gepasst hat, erinnert sich daran länger als die neun
 * anderen Male, in denen es geklappt hat — und er erzählt es weiter.
 *
 * 2,5 macht aus 90 % mitgenommen eine Zufriedenheit von 77 %, aus 60 % noch 28 %.
 */
export const CROWDING_EXPONENT = 2.5
/** Werte darüber werden nicht gespeichert — sie sind der Normalfall. */
export const SATISFACTION_PRUNE_ABOVE = 0.999

export interface ServiceObservation {
  /** Reisende, die das eigene Angebot gewählt haben. */
  readonly wanted: number
  /** Davon tatsächlich mitgenommen. */
  readonly carried: number
  /** Pünktlichkeit der gewählten Ketten, 0..1. */
  readonly punctuality: number
}

/**
 * Wie gut war die Bedienung heute? 1 = alle kamen mit und pünktlich.
 *
 * Mitkommen wiegt schwerer als Pünktlichkeit: wer gar nicht in den Zug passt,
 * ärgert sich mehr als wer zehn Minuten später ankommt.
 *
 * Gewertet werden nur die Stunden, in denen die Linie fährt. Dass um 23 Uhr
 * nichts mehr geht, hat die Verkehrsmittelwahl über die Wartezeit bereits
 * bestraft — hier ein zweites Mal draufzuschlagen machte aus jedem dünnen Takt
 * ein Desaster, ganz gleich ob ein Fahrgast stehen geblieben ist.
 */
export function observedQuality(observation: ServiceObservation): number {
  const served = observation.wanted > 0 ? observation.carried / observation.wanted : 1
  const punctual = Math.max(0, Math.min(1, observation.punctuality))
  return clamp(served ** CROWDING_EXPONENT * (1 - PUNCTUALITY_WEIGHT + PUNCTUALITY_WEIGHT * punctual))
}

/** Abschlag auf die alternativspezifische Konstante. 1 → 0, 0 → −2,2. */
export function satisfactionOffset(value: number): number {
  return (clamp(value) - 1) * SATISFACTION_ASC_WEIGHT
}

/**
 * Fortschreibung nach einem Betriebstag.
 *
 * Relationen ohne Beobachtung erholen sich ebenfalls — wer einen Korridor
 * aufgibt und Jahre später zurückkehrt, findet keinen verbrannten Markt vor,
 * sondern Leute, die sich nicht mehr erinnern.
 */
export function updateSatisfaction(
  previous: ReadonlyMap<string, number>,
  observations: ReadonlyMap<string, ServiceObservation>,
): Map<string, number> {
  const next = new Map<string, number>()

  const step = (current: number, target: number): number => {
    const rate = target < current ? SATISFACTION_DROP_RATE : SATISFACTION_RECOVERY_RATE
    return clamp(current + (target - current) * rate)
  }

  for (const [od, observation] of observations) {
    const current = previous.get(od) ?? 1
    const value = step(current, observedQuality(observation))
    if (value <= SATISFACTION_PRUNE_ABOVE) next.set(od, value)
  }

  for (const [od, current] of previous) {
    if (observations.has(od)) continue
    const value = step(current, 1)
    if (value <= SATISFACTION_PRUNE_ABOVE) next.set(od, value)
  }

  return next
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
