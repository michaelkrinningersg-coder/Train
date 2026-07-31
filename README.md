# Rail & Road — Europäisches Transportimperium

Ein browserbasiertes Transport-Wirtschaftsspiel auf Basis einer OpenStreetMap-Karte von Europa.
Der Spieler baut Bahnstrecken, kauft reale Zugtypen, platziert Bahnhöfe, erstellt Fahrpläne und
konkurriert mit Buslinien auf der Straße um Passagiere.

## Kernideen

- **Echte Geografie**: Europa-Karte aus OSM, Städte mit realen Einwohnerzahlen und Einrichtungen.
- **Zwei Verkehrsträger**: Straße (Busse, Reisezeit aus echtem Straßenrouting) und Schiene
  (selbst gebautes Netz, das der Spieler ausbaut).
- **Nachfragemodell**: Gravitationsmodell je Reisendensegment (Pendler, Touristen,
  Geschäftsreisende, Schüler, Studenten …) mit unterschiedlicher Zahlungsbereitschaft.
- **Betriebssimulation**: Blockabschnitte, Fahrplan, Konflikterkennung, Verspätungsausbreitung.
  Wer zu dicht taktet, produziert Verspätungen — und muss ausbauen.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/00-KONZEPT.md](docs/00-KONZEPT.md) | Spielkonzept, Kernentscheidungen, Gameplay-Loop |
| [docs/01-TECHSTACK.md](docs/01-TECHSTACK.md) | Technologie-Entscheidungen und Architektur |
| [docs/02-DATENMODELL.md](docs/02-DATENMODELL.md) | Domänenmodell als TypeScript-Typen |
| [docs/03-NACHFRAGEMODELL.md](docs/03-NACHFRAGEMODELL.md) | Gravitationsmodell, Segmente, Preisbildung |
| [docs/04-BETRIEBSSIMULATION.md](docs/04-BETRIEBSSIMULATION.md) | Blöcke, Fahrplan, Verspätungen, Kapazität |
| [docs/05-DATENPIPELINE.md](docs/05-DATENPIPELINE.md) | OSM/GeoNames/Routing-Aufbereitung |
| [docs/06-ROADMAP.md](docs/06-ROADMAP.md) | Phasenplan bis zum spielbaren Prototyp |

## Status

Konzeptphase. Noch kein Code.
