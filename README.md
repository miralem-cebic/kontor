# kontor

[![CI](https://github.com/miralem-cebic/kontor/actions/workflows/ci.yml/badge.svg)](https://github.com/miralem-cebic/kontor/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/github/license/miralem-cebic/kontor)](LICENSE)

**kontor** ist eine lokale App für Angebote, Rechnungen und die Einnahmen-Überschuss-Rechnung (EÜR) für Selbständige, Freiberufler und Kleinunternehmer in Deutschland.

Sie läuft vollständig im Browser und braucht keinen Server, keine Datenbank und kein Benutzerkonto. Deine Daten liegen als einfache Dateien in einem Ordner, den du selbst wählst: auf deinem Rechner, in OneDrive, SharePoint, Nextcloud oder Dropbox. kontor sendet nichts ins Internet.

> **Keine Steuerberatung.** kontor ist eine Ausfüllhilfe. Berechnungen, Rücklagen und Exporte sind Schätzungen auf Grundlage deiner Eingaben und ersetzen keine Beratung durch Steuerberater/innen. Prüfe Ergebnisse, bevor du sie beim Finanzamt einreichst.

## Für wen ist kontor?

| Tätigkeit | Kleinunternehmer (§ 19 UStG) | Regelbesteuerung mit Umsatzsteuer-Voranmeldung |
| --- | --- | --- |
| Freiberufler (§ 18 EStG) | ✓ | ✓ |
| Gewerbliches Einzelunternehmen | ✓ | ✓ |

kontor ist für Einzelunternehmen mit Einnahmen-Überschuss-Rechnung (§ 4 Abs. 3 EStG), solange keine Buchführungspflicht besteht (§ 141 AO, § 241a HGB). Nicht gedacht ist kontor für Kapitalgesellschaften wie GmbH und UG (sie müssen bilanzieren) und für Personengesellschaften wie GbR und Partnerschaft (ihr Gewinn wird gesondert und einheitlich festgestellt).

**Mehrere Betriebe:** Wer zum Beispiel freiberuflich arbeitet und zusätzlich ein Gewerbe hat, legt dafür zwei Unternehmen an: Gewinn und Gewerbesteuer werden je Betrieb ermittelt. Für die Umsatzsteuer ist eine Person aber ein einziges Unternehmen (§ 2 Abs. 1 Satz 2 UStG): Die Kleinunternehmergrenze gilt für den Gesamtumsatz, und es gibt eine gemeinsame Voranmeldung. kontor rechnet die Umsätze mehrerer Unternehmen noch nicht zusammen.

## Stand

Der aktuelle Stand enthält:

- **Einrichtungsassistent:** Ordner, Stammdaten mit Logo, Steuer (Kleinunternehmer nach § 19 UStG, Soll-/Ist-Versteuerung, Voranmeldungszeitraum, Freiberuf oder Gewerbe mit Hebesatz), Bankverbindung mit IBAN-Prüfung, Rechnungsnummern-Format, Zahlungsziel und Fußzeile.
- **Mehrere Unternehmen:** Jedes Unternehmen hat einen eigenen Ordner. Ein Umschalter wechselt zwischen ihnen.
- **Kontakte:** Kunden und Lieferanten mit Anschrift, Rechnungs-E-Mail, Kundennummer, USt-IdNr., Leitweg-ID für Behörden, Standard-Bestellnummer und Zahlungsziel. Suche und Filter nach Rolle.
- **Bankkonten:** Mehrere Konten pro Unternehmen, zum Beispiel zwei Girokonten und PayPal. Eines davon ist das Standardkonto für Rechnungen.
- **Artikel & Leistungen:** Ein Katalog mit Nummer, Bezeichnung, Beschreibung, Einheit, Nettopreis und Umsatzsteuersatz, mit Suche. Angebote übernehmen ihre Positionen daraus.
- **Angebote (Entwürfe):** Kunde, Datum, Gültigkeit, Betreff, Einleitung und Schlusstext; Positionen aus dem Katalog oder frei, mit Menge, Einheit, Preis und Steuersatz. Die Summen werden je Steuersatz berechnet; als Kleinunternehmer mit dem Hinweis nach § 19 UStG. Mit „Rechnung erstellen“ wird aus einem Angebot ein Rechnungsentwurf. Angebotsnummer und PDF folgen.
- **Rechnungen (Entwürfe):** Kunde, Rechnungsdatum, Leistungsdatum oder Leistungszeitraum, Bestellnummer und Leitweg-ID, Zahlungsziel mit Fälligkeit und das Konto, auf das gezahlt wird. Bei Regelbesteuerung wählst du den Steuerfall: mit Umsatzsteuer, Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) oder steuerfreie innergemeinschaftliche Lieferung; die Rechnung trägt dann den nötigen Hinweis. Ein Entwurf darf unvollständig sein; das Formular zeigt, was vor dem Ausstellen noch fehlt (zum Beispiel die Anschrift des Kunden, außer bei Kleinbetragsrechnungen bis 250 €, oder beide USt-IdNrn.). Rechnungsnummer, PDF und das Ausstellen folgen.
- **Einstellungen:** Alle Angaben aus dem Assistenten lassen sich später ändern.
- **Sicherung:** Einmal am Tag eine Kopie im Unternehmensordner (`backups/`).

Angebots- und Rechnungsnummern, PDF, das Ausstellen von Rechnungen, Zahlungen, E-Rechnung, Ausgaben, Dashboard, Steuerrechner und Exporte folgen. Was geplant ist, steht in der [Roadmap](docs/roadmap.md).

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

- [Roadmap](docs/roadmap.md): geplante Funktionen, Weg zu Version 1.0 und Finanzamt-Exporte
- [Wettbewerb](docs/competition.md): andere Anbieter und was sie exportieren
- [Architekturentscheidungen](docs/adr/)
- [Entwicklung](DEVELOPMENT.md), [Mitarbeit](CONTRIBUTING.md), [Verhaltenskodex](CODE_OF_CONDUCT.md), [Sicherheit](SECURITY.md), [Änderungen](CHANGELOG.md)

## Lizenz

Veröffentlicht unter der MIT-Lizenz, siehe [LICENSE](LICENSE).
