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

- **Einrichtungsassistent:** Ordner, Stammdaten mit Logo, Steuer (Kleinunternehmer nach § 19 UStG, Soll-/Ist-Versteuerung, Voranmeldungszeitraum, Freiberuf oder Gewerbe mit Hebesatz, dazu ein Link zur Karte der Hebesätze aller Gemeinden), Bankverbindung mit IBAN-Prüfung, Formate für Rechnungs- und Angebotsnummern, Zahlungsziel und Fußzeile (mit Auswahl, welche Angaben aus den Stammdaten sie zeigt, und einer Vorschau).
- **Mehrere Unternehmen:** Jedes Unternehmen hat einen eigenen Ordner. Ein Umschalter wechselt zwischen ihnen.
- **Kontakte:** Kunden und Lieferanten mit Anschrift, Rechnungs-E-Mail, Kundennummer (neue Kontakte bekommen die nächste freie Nummer aus dem Muster in den Einstellungen), USt-IdNr., Leitweg-ID für Behörden, Standard-Bestellnummer, Zahlungsziel und die Sprache der Dokumente (Deutsch oder Englisch). Bei Privatpersonen entfallen USt-IdNr., Leitweg-ID, Bestellnummer und Ansprechpartner. Suche und Filter nach Rolle.
- **Mahnungen:** Für eine überfällige Rechnung wird die Zahlungserinnerung oder die 1. bis 3. Mahnung erstellt, mit den Verzugszinsen seit dem Fälligkeitstag (bei Unternehmern) bzw. seit der ersten Erinnerung (bei Verbrauchern), dem Basiszinssatz des jeweiligen Halbjahres und 9 bzw. 5 Prozentpunkten darüber. Ist der Basiszinssatz für einen Tag noch nicht hinterlegt (nach dem letzten Halbjahr der Tabelle), werden keine Zinsen berechnet und die Mahnung nicht erstellt; das Formular nennt den Grund. Für Unternehmer kommt die Pauschale von 40 € einmal dazu. Das Formular zeigt die Forderung vor dem Speichern. Die Berechnung ist eine Schätzung für das Mahnschreiben, keine Rechtsberatung. Eine Mahnung wird nicht geändert und steht im Protokoll. Das Mahnschreiben gibt es als PDF; wie bei Rechnungen und Angeboten lässt sich die Mail dazu als E-Mail-Datei mit PDF-Anhang erstellen oder im Mailprogramm öffnen.
- **Versand per E-Mail:** Rechnung, Stornorechnung, Angebot und Mahnung lassen sich als E-Mail-Datei (.eml) mit dem PDF im Anhang erstellen; die Datei öffnet sich als Entwurf im Mailprogramm. Alternativ öffnet kontor das Mailprogramm mit Empfänger, Betreff und Text, und das PDF wird heruntergeladen, um es anzuhängen. kontor verschickt nichts selbst. Jede vorbereitete Mail steht im Protokoll.
- **Kundenkonto:** Pro Kunde stehen die Rechnungen, Stornorechnungen und Zahlungen in zeitlicher Reihenfolge, mit dem Saldo nach jeder Buchung und dem überfälligen Betrag. Ein Guthaben entsteht, wenn ein Kunde bezahlt hat und die Rechnung danach storniert wurde; es ist zu erstatten. Zu öffnen über den Kontakt.
- **Bankkonten:** Mehrere Konten pro Unternehmen, zum Beispiel zwei Girokonten und PayPal. Eines davon ist das Standardkonto für Rechnungen.
- **Artikel & Leistungen:** Ein Katalog mit Nummer, Bezeichnung, Beschreibung, Einheit, Nettopreis und Umsatzsteuersatz, mit Suche. Angebote übernehmen ihre Positionen daraus.
- **Angebote:** Kunde, Datum, Gültigkeit, Betreff, Einleitung und Schlusstext; ein abgeschlossenes Angebot lässt sich als angenommen oder abgelehnt eintragen, mit Datum, und die Eintragung zurücknehmen; Positionen aus dem Katalog oder frei, mit Menge, Einheit, Preis und Steuersatz. Die Summen werden je Steuersatz berechnet; als Kleinunternehmer mit dem Hinweis nach § 19 UStG. Das PDF eines Entwurfs lässt sich jederzeit herunterladen (als Entwurf markiert). Mit „Angebot abschließen“ bekommt ein Angebot die nächste Angebotsnummer aus dem Format der Einstellungen (zum Beispiel `AN-2026-0001`, für sich gezählt, nicht zusammen mit den Rechnungen); sein PDF ohne Entwurfsvermerk wird unter `documents/quotes/<Nummer>.pdf` abgelegt. Danach lässt es sich weder ändern noch löschen. Eine Änderung ist eine **neue Version**: Sie ersetzt das Angebot, bekommt dieselbe Nummer mit Zusatz (`AN-2026-0001-2`) und nennt im PDF das Angebot, das sie ersetzt. Die Versionen zeigen, was sich geändert hat (Positionen neu, entfernt, Menge, Preis) und wie oft die Angebote eines Kunden und alle zusammen geändert wurden. „Als neues Angebot kopieren“ übernimmt alles in ein neues, eigenes Angebot. Mit „Rechnung erstellen“ wird aus einem Angebot ein Rechnungsentwurf.
- **Rechnungen:** Kunde, Rechnungsdatum, Leistungsdatum oder Leistungszeitraum, Bestellnummer und Leitweg-ID, Zahlungsziel mit Fälligkeit und das Konto, auf das gezahlt wird. Bei Regelbesteuerung wählst du den Steuerfall: mit Umsatzsteuer, Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG), steuerfreie innergemeinschaftliche Lieferung oder nicht im Inland steuerbare Leistung (zum Beispiel für Kunden außerhalb der EU); die Rechnung trägt dann den nötigen Hinweis. Ein Entwurf darf unvollständig sein; das Formular zeigt, was vor dem Ausstellen noch fehlt (zum Beispiel die Anschrift des Kunden, außer bei Kleinbetragsrechnungen bis 250 €, oder beide USt-IdNrn.). Das PDF eines Entwurfs lässt sich jederzeit herunterladen.
- **Ausstellen:** Eine vollständige Rechnung bekommt die nächste Nummer aus dem Format der Einstellungen (mit `{YYYY}` oder `{YY}` beginnt die Zählung jedes Jahr neu, nach dem Rechnungsdatum). Ihr PDF wird unter `documents/issued/<Nummer>.pdf` im Unternehmensordner abgelegt, mit seiner Prüfsumme (SHA-256) in der Rechnung, und jeder Vorgang steht im Protokoll `audit/`. Danach lässt sich die Rechnung weder ändern noch löschen; sie behält die Angaben zu Unternehmen, Kunde und Konto vom Zeitpunkt des Ausstellens.
- **Zahlungen:** Zu einer ausgestellten Rechnung wird erfasst, wann welcher Betrag auf welchem Konto eingegangen ist. Teilzahlungen sind möglich; die Rechnung zeigt, was bezahlt und was noch offen ist. Die Liste zeigt offene und überfällige Rechnungen und filtert danach. Eine Zahlung wird nicht geändert: Eine falsche wird entfernt, und beides steht im Protokoll `audit/`. Mehr als der offene Betrag wird nicht angenommen.
- **Stornieren:** Eine falsche Rechnung wird storniert. kontor stellt dafür eine Stornorechnung mit der nächsten Rechnungsnummer aus: dieselben Positionen mit umgekehrtem Vorzeichen, mit Verweis auf die stornierte Rechnung (Nummer und Datum), mit eigenem PDF und Eintrag im Protokoll. Die ursprüngliche Rechnung bleibt unverändert und ist danach als storniert markiert. Mit „Als neue Rechnung kopieren“ übernimmt ein neuer Entwurf alle Angaben der Rechnung, für die korrigierte Rechnung.
- **PDF:** Geschäftsbrief nach DIN 5008 (Anschriftfeld für Fensterumschläge, Informationsblock mit E-Mail und Telefon des Kunden, Falzmarken) mit Logo, Positionen über mehrere Seiten, Summen je Steuersatz, dem nötigen Hinweis zur Umsatzsteuer, Zahlungsaufforderung und Fußzeile mit Steuernummer und Bankverbindung. Entwürfe tragen den Schriftzug „ENTWURF“ und noch keine Nummer.
- **Umsatzsteuer-Voranmeldung (Ausfüllhilfe):** Unter „Steuern“ zeigt kontor für ein Unternehmen mit Regelbesteuerung zu einem Monat oder Quartal die Werte für „Mein ELSTER“: Kennzahlen 81 und 86 (Umsätze zu 19 % und 7 %, Bemessungsgrundlage in vollen Euro und Steuer), 41, 21, 60 und 45 (innergemeinschaftliche Lieferungen, Steuerschuldnerschaft des Leistungsempfängers, Leistungen im Ausland), 66 (Vorsteuer aus den Ausgaben) und 83 (Vorauszahlung), jeweils mit einer Schaltfläche zum Kopieren, dazu die Fälligkeit (mit Dauerfristverlängerung einen Monat später) und eine CSV-Datei. Je nach Einstellung zählen Rechnungen nach der Leistung (Soll) oder nach den Zahlungen (Ist). Die Ansicht sagt ausdrücklich, was nicht berechnet wird (zum Beispiel Steuerschuldnerschaft bei Einkäufen nach § 13b UStG, andere Steuersätze, die Sondervorauszahlung). Alle Werte sind Schätzungen und Ausfüllhilfen, keine Steuerberatung. Kleinunternehmer sehen den Hinweis, dass keine Voranmeldung nötig ist.
- **Zusammenfassende Meldung (Ausfüllhilfe):** Unter „Steuern“ zeigt kontor für ein Unternehmen mit Regelbesteuerung zu einem Quartal oder Monat, welche Leistungen an Unternehmer in anderen EU-Staaten und welche innergemeinschaftlichen Lieferungen du melden musst (§ 18a UStG): eine Zeile je USt-IdNr. des Empfängers mit Land, Art und Summe in vollen Euro, jeweils mit einer Schaltfläche zum Kopieren, dazu die Fälligkeit (der 25. nach Ende des Zeitraums), eine CSV-Datei und der Link zum Online-Portal des BZSt, wo du die Meldung abgibst. kontor prüft die USt-IdNr. der Empfänger und gleicht die Leistungen mit Kennzahl 21 der Voranmeldung ab. Eine Importdatei für das Portal erzeugt kontor nicht. Alle Werte sind Ausfüllhilfen, keine Steuerberatung. Kleinunternehmer sehen den Hinweis, dass keine Meldung nötig ist (§ 18a Abs. 4 UStG).
- **Einstellungen:** Alle Angaben aus dem Assistenten lassen sich später ändern.
- **Sicherung:** Einmal am Tag eine Kopie im Unternehmensordner (`backups/`).

Angebotsstatus (angenommen, abgelehnt), Rechnungskorrekturen und Gutschriften, GiroCode, E-Rechnung, Ausgaben, Dashboard, Steuerrechner und Exporte folgen. Was geplant ist, steht in der [Roadmap](docs/roadmap.md).

## Voraussetzungen

- **Google Chrome** oder **Microsoft Edge** auf dem Desktop. kontor schreibt über die File System Access API in einen Ordner; Safari und Firefox unterstützen diese Schnittstelle nicht.

## Loslegen

### Fertige Version

1. Auf der Seite [Releases](https://github.com/miralem-cebic/kontor/releases) die neueste `kontor-<version>.zip` herunterladen und mit der beigefügten `.sha256`-Datei prüfen.
2. Das Archiv entpacken und `index.html` per Doppelklick in Chrome oder Edge öffnen.
3. Der Assistent führt durch die Einrichtung. Wähle am besten einen neuen, leeren Ordner für dein Unternehmen.

Nach einem Neustart des Browsers fragt der Browser einmal nach, ob kontor wieder auf den Ordner zugreifen darf.

### Als Container (Raspberry Pi)

kontor gibt es auch als Docker-Image für `amd64`, `arm64` und `arm/v7`. Der Container liefert nur die App aus; deine Daten bleiben im Ordner, den du im Browser wählst. Für den Zugriff aus dem Heimnetz brauchst du HTTPS, sonst sperrt der Browser den Ordnerdialog. Anleitung: [kontor im Container](docs/docker.md).

```bash
docker compose up -d   # mit compose.yaml, dann http://localhost:8080
```

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
- Öffne einen Unternehmensordner nicht gleichzeitig auf zwei Geräten zum Bearbeiten. Änderungen an verschiedenen Feldern werden zusammengeführt, aber Rechnungsnummern setzen voraus, dass jeweils nur ein Gerät schreibt. Im selben Browser passt kontor selbst darauf auf: Ist ein Unternehmen schon in einem anderen Fenster oder Tab geöffnet, zeigt das neue Fenster das an und öffnet es erst auf „Hier öffnen“; das andere Fenster speichert dann und schließt es.
- Welche Ordner du schon geöffnet hast, merkt sich nur dein Browser. Ein anderer Browser oder Rechner fragt beim ersten Mal nach dem Ordner.
- Alle Seiten, die der Browser direkt von der Festplatte öffnet, teilen sich seinen Speicher. Öffne im Browserprofil, mit dem du kontor nutzt, keine HTML-Dateien aus unbekannter Quelle (zum Beispiel aus Downloads oder Mail-Anhängen), oder nutze für kontor ein eigenes Browserprofil. kontor prüft die Notfallkopie ungespeicherter Änderungen im Browser mit einem Schlüssel aus deinem Firmenordner und verwirft eine Kopie, die nicht daher stammt.

## Dokumentation

- [Roadmap](docs/roadmap.md): geplante Funktionen, Weg zu Version 1.0 und Finanzamt-Exporte
- [kontor im Container](docs/docker.md): Docker, Raspberry Pi und HTTPS im Heimnetz
- [Wettbewerb](docs/competition.md): andere Anbieter und was sie exportieren
- [Architekturentscheidungen](docs/adr/)
- [Entwicklung](DEVELOPMENT.md), [Mitarbeit](CONTRIBUTING.md), [Verhaltenskodex](CODE_OF_CONDUCT.md), [Sicherheit](SECURITY.md), [Änderungen](CHANGELOG.md)

## Lizenz

Veröffentlicht unter der MIT-Lizenz, siehe [LICENSE](LICENSE).
