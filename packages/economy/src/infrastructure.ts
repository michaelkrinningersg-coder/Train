import { BLOCK_LENGTH_KM, cityRadiusKm } from '@game/domain'
import type { MaxSpeed, Money, Signalling, TrackCount, TrackSegment, TrackUpgrade } from '@game/domain'

/**
 * Bau- und Ausbaukosten der Schieneninfrastruktur. Alle Beträge in Cent.
 *
 * **Bewusste Abweichung von der Wirklichkeit:** Neubaustrecken kosten in
 * Deutschland real 3 bis 15 Millionen Euro je Kilometer. Mit diesen Zahlen wäre
 * die erste Strecke aus Fahrgelderlösen niemals zu finanzieren - reale Bahnen
 * werden vom Staat gebaut, nicht aus dem Fahrkartenverkauf. Die Baukosten sind
 * deshalb um rund den Faktor drei heruntergesetzt, damit ein über Busse
 * aufgebautes Unternehmen in einigen Spieljahren zur ersten Strecke kommt.
 * Die *Verhältnisse* zwischen den Ausbaustufen bleiben realistisch.
 */

/** Einfaches Gleis, 120 km/h, ohne Fahrdraht, in der Ebene. */
export const TRACK_BASE_COST_PER_KM: Money = 1_200_000_00

export const SPEED_BUILD_FACTOR: Readonly<Record<MaxSpeed, number>> = {
  80: 0.8,
  120: 1.0,
  160: 1.2,
  200: 1.55,
  250: 2.1,
  300: 2.8,
}

export const TRACK_COUNT_BUILD_FACTOR: Readonly<Record<TrackCount, number>> = {
  1: 1.0,
  2: 1.75,
  4: 3.2,
}

/** Fahrdraht samt Unterwerken je km. */
export const ELECTRIFICATION_COST_PER_KM: Money = 400_000_00

/** Signaltechnik je km, gemessen an der klassischen Blocksicherung. */
export const SIGNALLING_COST_PER_KM: Readonly<Record<Signalling, Money>> = {
  classic: 0,
  etcs_l1: 180_000_00,
  etcs_l2: 420_000_00,
}

export interface TrackSpec {
  readonly maxSpeed: MaxSpeed
  readonly electrified: boolean
  readonly tracks: TrackCount
  readonly signalling: Signalling
}

/**
 * Baukosten einer Strecke.
 *
 * Der Geländefaktor wirkt auf den Unterbau voll, auf Fahrdraht und Signaltechnik
 * gedämpft: Masten und Balisen werden im Gebirge auch teurer, aber längst nicht
 * so sehr wie Einschnitte, Dämme und Tunnel.
 */
export function trackBuildCost(lengthKm: number, spec: TrackSpec, terrainFactor: number): Money {
  const civil =
    TRACK_BASE_COST_PER_KM *
    SPEED_BUILD_FACTOR[spec.maxSpeed] *
    TRACK_COUNT_BUILD_FACTOR[spec.tracks] *
    terrainFactor

  const dampened = Math.sqrt(terrainFactor)
  const electrification = spec.electrified ? ELECTRIFICATION_COST_PER_KM * spec.tracks * dampened : 0
  const signalling = SIGNALLING_COST_PER_KM[spec.signalling] * dampened

  return Math.round(lengthKm * (civil + electrification + signalling))
}

/** Umbau im Bestand ist teurer als Neubau: unter laufendem Betrieb, in Etappen. */
export const REBUILD_SURCHARGE = 1.35

export function trackUpgradeCost(track: TrackSegment, upgrade: TrackUpgrade): Money {
  const { lengthKm, terrainFactor } = track

  switch (upgrade.kind) {
    case 'speed': {
      const delta = SPEED_BUILD_FACTOR[upgrade.to] - SPEED_BUILD_FACTOR[track.maxSpeed]
      if (delta <= 0) return 0
      return Math.round(
        lengthKm *
          TRACK_BASE_COST_PER_KM *
          delta *
          TRACK_COUNT_BUILD_FACTOR[track.tracks] *
          terrainFactor *
          REBUILD_SURCHARGE,
      )
    }
    case 'tracks': {
      const delta = TRACK_COUNT_BUILD_FACTOR[upgrade.to] - TRACK_COUNT_BUILD_FACTOR[track.tracks]
      if (delta <= 0) return 0
      // Ein zweites Gleis wird neu gebaut, nicht umgebaut - deshalb ohne Zuschlag.
      const civil = TRACK_BASE_COST_PER_KM * delta * SPEED_BUILD_FACTOR[track.maxSpeed] * terrainFactor
      const wire = track.electrified
        ? ELECTRIFICATION_COST_PER_KM * (upgrade.to - track.tracks) * Math.sqrt(terrainFactor)
        : 0
      return Math.round(lengthKm * (civil + wire))
    }
    case 'electrify': {
      if (track.electrified) return 0
      return Math.round(lengthKm * ELECTRIFICATION_COST_PER_KM * track.tracks * Math.sqrt(terrainFactor))
    }
    case 'signalling': {
      const delta = SIGNALLING_COST_PER_KM[upgrade.to] - SIGNALLING_COST_PER_KM[track.signalling]
      if (delta <= 0) return 0
      return Math.round(lengthKm * delta * Math.sqrt(terrainFactor))
    }
  }
}

/** Bauzeit in Tagen. Länge und Gelände bestimmen sie, nicht der Preis. */
export function trackBuildDays(lengthKm: number, terrainFactor: number): number {
  return Math.min(720, Math.max(14, Math.round(lengthKm * 1.2 * terrainFactor)))
}

export function trackUpgradeDays(track: TrackSegment, upgrade: TrackUpgrade): number {
  const base = upgrade.kind === 'signalling' ? 0.25 : 0.6
  return Math.min(540, Math.max(7, Math.round(track.lengthKm * base * track.terrainFactor)))
}

/**
 * Während eines Ausbaus ist die Strecke nur eingeschränkt befahrbar. Bei der
 * Signaltechnik bleibt der Betrieb weitgehend unberührt, beim Gleisumbau nicht.
 */
export function capacityDuringWorks(upgrade: TrackUpgrade): number {
  switch (upgrade.kind) {
    case 'signalling':
      return 0.9
    case 'electrify':
      return 0.7
    case 'tracks':
      return 0.6
    case 'speed':
      return 0.5
  }
}

/** Rückbau bringt Schrotterlös, kostet aber Abbruch. Netto meist knapp positiv. */
export function trackDemolitionValue(track: TrackSegment): Money {
  return Math.round(track.lengthKm * TRACK_BASE_COST_PER_KM * 0.08 * TRACK_COUNT_BUILD_FACTOR[track.tracks])
}

// ── Bahnhöfe ───────────────────────────────────────────────────────────────

export const STATION_BASE_COST: Money = 1_500_000_00
export const STATION_PLATFORM_COST: Money = 1_000_000_00
export const STATION_UPKEEP_BASE: Money = 12_000
export const STATION_UPKEEP_PER_PLATFORM: Money = 6_000

/**
 * Grundstückspreis: zum Stadtzentrum hin steigt er stark. Das ist die Gegenseite
 * des Einzugsgebiets - zentral heißt viele Fahrgäste und teures Land, am Rand
 * billig und halb so viel Nachfrage.
 */
export function landPriceFactor(distanceToCentreKm: number, cityRadiusKm: number): number {
  const relative = Math.min(1, distanceToCentreKm / Math.max(cityRadiusKm, 0.5))
  return 1 + 3 * (1 - relative) ** 2
}

export function railStationCost(
  population: number,
  distanceToCentreKm: number,
  platforms: number,
): Money {
  const radius = cityRadiusKm(population)
  const size = 1 + radius / 20
  const base = STATION_BASE_COST + STATION_PLATFORM_COST * platforms
  return Math.round(base * landPriceFactor(distanceToCentreKm, radius) * size)
}

export function railStationUpkeep(platforms: number): Money {
  return STATION_UPKEEP_BASE + STATION_UPKEEP_PER_PLATFORM * platforms
}

/**
 * Aufschlag auf einen Bahnsteiganbau gegenüber dem Neubau auf der grünen Wiese.
 *
 * Unter laufendem Betrieb zu bauen ist teurer: Bauzustände, Provisorien,
 * Nachtarbeit. Ein Drittel Aufschlag ist eine konservative Schätzung — real
 * liegt der Unterschied bei innerstädtischen Bahnhöfen deutlich höher.
 */
export const STATION_EXPANSION_SURCHARGE = 1.35

/** Kosten für zusätzliche Bahnsteiggleise an einem bestehenden Bahnhof. */
export function stationExpansionCost(
  population: number,
  distanceToCentreKm: number,
  fromPlatforms: number,
  toPlatforms: number,
): Money {
  const added = Math.max(0, toPlatforms - fromPlatforms)
  if (added === 0) return 0
  const radius = cityRadiusKm(population)
  const size = 1 + radius / 20
  const base = STATION_PLATFORM_COST * added
  return Math.round(
    base * landPriceFactor(distanceToCentreKm, radius) * size * STATION_EXPANSION_SURCHARGE,
  )
}

/** Bauzeit einer Bahnhofserweiterung. */
export function stationExpansionDays(fromPlatforms: number, toPlatforms: number): number {
  const added = Math.max(0, toPlatforms - fromPlatforms)
  if (added === 0) return 0
  return 90 + 60 * added
}

/** Anzahl Blockabschnitte einer Strecke - bestimmt die Kapazität in Phase 3. */
export function blockCount(lengthKm: number, signalling: Signalling): number {
  return Math.max(1, Math.ceil(lengthKm / BLOCK_LENGTH_KM[signalling]))
}



/**
 * Überholstelle: ein Ausweichgleis samt Weichen und Signalen. Auf eingleisigen
 * Strecken ist sie das billigste Mittel gegen Kreuzungskonflikte — ein zweites
 * durchgehendes Gleis kostet ein Vielfaches.
 */
export const PASSING_LOOP_BASE_COST: Money = 2_400_000_00
export const PASSING_LOOP_PER_TRACK_COST: Money = 900_000_00
export const PASSING_LOOP_UPKEEP_PER_DAY: Money = 9_000

export function passingLoopCost(capacity: number): Money {
  return PASSING_LOOP_BASE_COST + PASSING_LOOP_PER_TRACK_COST * Math.max(0, capacity - 1)
}

export function passingLoopDays(capacity: number): number {
  return 30 + 15 * Math.max(0, capacity - 1)
}
