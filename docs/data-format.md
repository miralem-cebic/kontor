# Datenformat von kontor

Dieses Dokument beschreibt, wie kontor die Daten einer Firma speichert. Es ist für dich gedacht, damit du deine Daten jederzeit ohne kontor lesen kannst (F12, „Exit at any time“). Der Ordner gehört dir: Er liegt auf deinem Rechner oder in deinem Cloud-Ordner, und kontor braucht keinen Server.

Die Entwicklerdetails (Migrationen, Prüfregeln, Zusammenführung) stehen in [DEVELOPMENT.md](../DEVELOPMENT.md).

## Der Ordner

Eine Firma hat einen Ordner. Er enthält diese Dateien und Unterordner:

| Pfad | Inhalt |
| --- | --- |
| `company.json` | Die Firma: Name, Anschrift, Kontakt, Steuerangaben, Konten, Einstellungen für Nummern und Fußzeile |
| `assets/` | Das Logo, benannt nach dem Anfang seiner Prüfsumme |
| `contacts/<id>.json` | Kunden und Lieferanten, je eine Datei |
| `items/<id>.json` | Artikel und Leistungen des Katalogs |
| `documents/<id>.json` | Angebote und Rechnungen, auch Entwürfe und Stornorechnungen |
| `documents/issued/<nummer>.pdf` | Das fertige PDF jeder ausgestellten Rechnung |
| `documents/quotes/<nummer>.pdf` | Das fertige PDF jedes abgeschlossenen Angebots |
| `payments/<id>.json` | Zahlungseingänge zu ausgestellten Rechnungen |
| `dunnings/<id>.json` | Mahnungen zu ausgestellten Rechnungen |
| `quoteStatus/<id>.json` | Die Entscheidung des Kunden zu einem Angebot (angenommen oder abgelehnt) |
| `expenses/<id>.json` | Ausgaben |
| `belege/<jahr>/<id>-<name>` | Die Belege zu den Ausgaben, als Datei kopiert |
| `numbering/<bereich>.json` | Der Zähler der Nummernkreise (Rechnungen, Angebote) |
| `audit/<JJJJ-MM>.jsonl` | Das Protokoll: eine JSON-Zeile je Vorgang, nur angehängt |
| `backups/<JJJJ-MM-TT>.json` | Die tägliche Sicherung der Daten |

Der Ordner `listen/` ist im ZIP-Export dabei; er liegt nicht im Firmenordner. Er enthält jede Liste als CSV-Datei, siehe unten.

Versteckte Dateien (sie beginnen mit einem Punkt) und Hilfsdateien von Sync-Programmen gehören nicht zum Datenbestand.

## Die Dateien

Die Datensätze sind JSON in UTF-8, jeder hat ein Feld `schemaVersion`; die aktuelle Version ist 15. PDFs, Belege und das Logo sind Dateien wie sie sind. Ältere Versionen werden beim Lesen auf die aktuelle gebracht, und ältere Versionen von kontor lehnen Dateien einer neueren Version ab, statt sie zu überschreiben.

Die wichtigsten Felder:

- **Kontakte** (`contacts/`): `kind` (`company` oder `person`), `roles` (Kunde und/oder Lieferant), `name`, `customerNumber`, `address`, `contact` (E-Mail, Telefon), `vatId` (EU-USt-IdNr.), `leitwegId`, `paymentTermDays`, `language` (`de` oder `en`), `deletedAt`.
- **Artikel** (`items/`): `number`, `name`, `description`, `unit` (ein Code der UN/ECE-Empfehlung 20, zum Beispiel `HUR` für Stunde), `netPrice`, `vatRate`, `deletedAt`.
- **Dokumente** (`documents/`): `kind` (`quote` oder `invoice`), `customerId`, `date`, `lines` (Menge, Einheit, Preis je Einheit, Umsatzsteuersatz), `discount`, bei Rechnungen `service`, `paymentTermDays`, `taxTreatment`, `accountId`; ausgestellte Dokumente haben `issued` mit Nummer, Zeitpunkt, Kopie der Stammdaten zu diesem Zeitpunkt und der Prüfsumme des PDFs.
- **Zahlungen** (`payments/`): `invoiceId`, `date`, `amount`, `accountId`, `note`. Eine Zahlung ändert sich nicht; eine falsche wird als gelöscht markiert.
- **Mahnungen** (`dunnings/`): `invoiceId`, `level`, `date`, `open`, `interest`, `flatFee`, `fee`, `payBy`. Eine Mahnung ändert sich nicht.
- **Entscheidungen zu Angeboten** (`quoteStatus/`): `quoteId`, `decision` (`accepted` oder `declined`), `date`.
- **Ausgaben** (`expenses/`): `date` (der Tag der Zahlung), `supplier`, `reference` (Belegnummer des Lieferanten), `gross` (Brutto), `taxTreatment` (`domestic`, `euReverseCharge`, `thirdCountry` oder `noVat`), `vatRate`, `category`, `accountId`, `note`, `receipt` (der Beleg, siehe unten).
- **Belege**: Ein Beleg in `expenses/` ist entweder `{ "kind": "file", "year", "name", "type", "size", "sha256" }` für eine Datei in `belege/<year>/<name>`, oder `{ "kind": "link", "url" }` für einen Link (nur http oder https). Eine Datei ist `application/pdf`, `image/png` oder `image/jpeg`.
- **Protokoll** (`audit/`): eine Zeile je Vorgang mit `at` (Zeitpunkt), `action` (zum Beispiel `issue`, `cancel`, `recordPayment`, `dunning`, `send`, `attachReceipt`), dem Dokument oder der Ausgabe und dem Gerät, auf dem der Vorgang geschah.
- **Nummern** (`numbering/`): der höchste Zähler je Schlüssel, und die letzten Reservierungen.

## Zahlen, Daten, Kennungen

- **Geldbeträge** sind ganze Zahlen in Cent. `1250` bedeutet 12,50 €.
- **Umsatzsteuersätze** sind Basispunkte: `1900` bedeutet 19 %, `700` bedeutet 7 %, `0` bedeutet 0 %.
- **Mengen** sind Tausendstel: `1500` bedeutet 1,5.
- **Daten** sind ISO-Daten `JJJJ-MM-TT`, Zeitpunkte sind ISO-Zeitstempel in UTC.
- **Kennungen** (`id`, `customerId` und so weiter) sind UUIDs.
- **Dateien mit Prüfsumme**: Das PDF einer Rechnung, das PDF eines Angebots und jeder Beleg haben einen SHA-256-Wert im Datensatz, der zu der Datei passen muss.

## Die Listen als CSV

Im ZIP-Export liegt jede Liste im Ordner `listen/` als CSV-Datei: Kontakte, Artikel, Angebote, Rechnungen und Ausgaben. Die Dateien haben:

- Semikolon als Trennzeichen,
- Dezimalkomma bei Beträgen, ohne Tausendertrennzeichen,
- ISO-Daten,
- UTF-8 mit Byte-Order-Mark, damit Umlaute in Tabellenkalkulationen stimmen,
- Textzellen, die wie eine Formel aussehen könnten, mit einem Apostroph davor.

## Das Archiv

Der ZIP-Export enthält den Firmenordner so, wie er ist, auf oberster Ebene, dazu `listen/` mit den CSV-Dateien und eine Datei `LIESMICH.txt` mit einer kurzen Beschreibung. Jede Datei des Ordners steht unverändert im Archiv.

## Was dieses Dokument nicht ist

Es ist keine Steuerberatung. Die Angaben in den Dateien sind Daten, die du selbst eingetragen hast; kontor prüft nur, dass sie zusammenpassen, nicht, dass sie steuerlich richtig sind.
