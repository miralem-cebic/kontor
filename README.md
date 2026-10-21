# kontor

[![CI](https://github.com/miralem-cebic/kontor/actions/workflows/ci.yml/badge.svg)](https://github.com/miralem-cebic/kontor/actions/workflows/ci.yml)

**kontor** ist eine lokale App für Angebote, Rechnungen und die Einnahmen-Überschuss-Rechnung (EÜR) für Selbständige, Freiberufler und Kleinunternehmer in Deutschland.

Sie läuft vollständig im Browser und braucht keinen Server, keine Datenbank und kein Benutzerkonto. Deine Daten liegen als einfache Dateien in einem Ordner, den du selbst wählst: auf deinem Rechner, in OneDrive, SharePoint, Nextcloud oder Dropbox. kontor sendet nichts ins Internet.

> **Keine Steuerberatung.** kontor ist eine Ausfüllhilfe. Berechnungen, Rücklagen und Exporte sind Schätzungen auf Grundlage deiner Eingaben und ersetzen keine Beratung durch Steuerberater/innen. Prüfe Ergebnisse, bevor du sie beim Finanzamt einreichst.

## Stand

Version 0.1 (Phase 0) enthält das Grundgerüst:

- **Einrichtungsassistent:** Ordner, Stammdaten mit Logo, Steuer (Kleinunternehmer nach § 19 UStG, Soll-/Ist-Versteuerung, Voranmeldungszeitraum, Freiberuf oder Gewerbe mit Hebesatz), Bankverbindung mit IBAN-Prüfung, Rechnungsnummern-Format, Zahlungsziel und Fußzeile.
- **Mehrere Unternehmen:** Jedes Unternehmen hat einen eigenen Ordner. Ein Umschalter wechselt zwischen ihnen.
- **Einstellungen:** Alle Angaben aus dem Assistenten lassen sich später ändern.
- **Sicherung:** Einmal am Tag eine Kopie im Unternehmensordner (`backups/`).

Angebote, Rechnungen, E-Rechnung, Ausgaben, Dashboard, Steuerrechner und Exporte folgen. Was geplant ist, steht in der [Roadmap](docs/roadmap.md).

## Voraussetzungen

- **Google Chrome** oder **Microsoft Edge** auf dem Desktop. kontor schreibt über die File System Access API in einen Ordner; Safari und Firefox unterstützen diese Schnittstelle nicht.

## Loslegen

### Fertige Version

1. Auf der Seite [Releases](https://github.com/miralem-cebic/kontor/releases) die neueste `kontor-<version>.zip` herunterladen und mit der beigefügten `.sha256`-Datei prüfen.
2. Das Archiv entpacken und `index.html` per Doppelklick in Chrome oder Edge öffnen.
3. Der Assistent führt durch die Einrichtung. Wähle am besten einen neuen, leeren Ordner für dein Unternehmen.

Nach einem Neustart des Browsers fragt der Browser einmal nach, ob kontor wieder auf den Ordner zugreifen darf.

### Aus dem Quellcode

```bash
git clone https://github.com/miralem-cebic/kontor.git
cd kontor
npm ci
npm run dev        # Entwicklungsserver unter http://localhost:5173
npm run build      # Typprüfung und Build nach dist/
npm test           # Unit-Tests
```

Architektur, Datenformat und alle Skripte stehen in [DEVELOPMENT.md](DEVELOPMENT.md).

## Deine Daten

- Ein Unternehmen ist ein Ordner mit JSON-Dateien (`company.json`, später Kontakte, Belege, Rechnungen). Du kannst ihn sichern, kopieren oder deiner Steuerberatung freigeben wie jeden anderen Ordner.
- Öffne einen Unternehmensordner nicht gleichzeitig auf zwei Geräten zum Bearbeiten. Änderungen an verschiedenen Feldern werden zusammengeführt, aber Rechnungsnummern setzen voraus, dass jeweils nur ein Gerät schreibt.
- Welche Ordner du schon geöffnet hast, merkt sich nur dein Browser. Ein anderer Browser oder Rechner fragt beim ersten Mal nach dem Ordner.

## Dokumentation

- [Roadmap](docs/roadmap.md): geplante Funktionen und Finanzamt-Exporte
- [Architekturentscheidungen](docs/adr/)
- [Entwicklung](DEVELOPMENT.md), [Mitarbeit](CONTRIBUTING.md), [Verhaltenskodex](CODE_OF_CONDUCT.md), [Sicherheit](SECURITY.md), [Änderungen](CHANGELOG.md)
