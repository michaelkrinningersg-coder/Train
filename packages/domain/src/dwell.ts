/**
 * Haltezeit aus Fahrgastandrang.
 *
 * Bis Phase 3 war die Haltezeit eine Konstante — 60 Sekunden, ob drei oder
 * dreihundert Menschen ein- und aussteigen. Damit blieb Überfüllung im Fahrplan
 * folgenlos: ein Zug mit 400 % Auslastung fuhr so pünktlich wie ein leerer.
 *
 * Das Modell ist bewusst einfach: Fahrgäste strömen mit einer festen Rate durch
 * die Türen, und die Haltezeit ist die Zeit, die der letzte braucht. Ein Zug hat
 * viele Türen und schafft deshalb ein Vielfaches eines Busses, bei dem sich beim
 * Einstieg alles an einer Tür staut.
 *
 * Der Deckel ist keine Bequemlichkeit, sondern eine Aussage: irgendwann fährt der
 * Zug ab und lässt den Rest stehen. Dass die stehen bleiben, rechnet die
 * Fahrgastzuordnung ohnehin — hier soll die Verspätung nicht ins Absurde laufen.
 */

export type TransportMode = 'bus' | 'rail'

/** Fahrgäste je Sekunde, die ein Fahrzeug abfertigen kann. */
export const BOARDING_RATE_PER_SEC: Readonly<Record<TransportMode, number>> = {
  bus: 0.6,
  rail: 4,
}

/** Mehr als das wartet kein Zug — der Rest bleibt stehen. */
export const MAX_EXTRA_DWELL_SEC = 240

/**
 * Haltezeit an einem Halt.
 *
 * @param mode            Bus oder Bahn — sie fertigen unterschiedlich schnell ab
 * @param plannedSec      Geplante Haltezeit aus der Liniendefinition
 * @param baseSec         Mindesthaltezeit des Verkehrsträgers
 * @param paxPerDeparture Ein- und Aussteigende je Fahrt in der Spitzenstunde
 */
export function dwellWithCrowding(
  mode: TransportMode,
  plannedSec: number,
  baseSec: number,
  paxPerDeparture: number,
): number {
  const planned = Math.max(plannedSec, baseSec)
  if (paxPerDeparture <= 0) return planned

  const needed = paxPerDeparture / BOARDING_RATE_PER_SEC[mode]
  // Die geplante Haltezeit deckt einen Teil des Andrangs bereits ab; erst was
  // darüber hinausgeht, verspätet den Zug.
  const extra = Math.min(MAX_EXTRA_DWELL_SEC, Math.max(0, needed - planned))
  return planned + extra
}
