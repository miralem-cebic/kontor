// The lines of the advance VAT return "USt 1 A" for 2026 that kontor fills, copied from the official sample of the form:
// BMF letter of 29 December 2025, "Muster der Vordrucke im Umsatzsteuer-Voranmeldungs- und -Vorauszahlungsverfahren für das
// Kalenderjahr 2026" (Az. III C 3 - S 7344/00039/007/036), pages 1 to 3 of the form and its instructions ("Anleitung"), read on
// 15 November 2026 from
// https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/2025-12-29-vordruckmuster-USt-voranmeldung-2026.pdf
// tests/unit/ustvaForm.test.ts compares the field numbers of `src/domain/tax/params/2026.ts` with these lines, so a
// number that differs from the official form fails a test and does not reach a user (#34). When the BMF publishes the form
// of a new year, add its lines here and a block to the test; a year without lines is not checked and says so.

export interface FormLine {
  /** The row ("Zeile") of the form */
  zeile: number;
  /** The Kennzahl of the base column ("Bemessungsgrundlage"), or null */
  base: string | null;
  /** The Kennzahl of the tax column ("Steuer"), or null; a line with only a tax column has no base */
  tax: string | null;
  /** The label of the line as printed on the form (shortened where the print wraps over many lines) */
  label: string;
}

export const FORM_2026: readonly FormLine[] = [
  { zeile: 13, base: '81', tax: null, label: 'Steuerpflichtige Umsätze zum Steuersatz von 19 %' },
  { zeile: 14, base: '86', tax: null, label: 'Steuerpflichtige Umsätze zum Steuersatz von 7 %' },
  { zeile: 19, base: '41', tax: null, label: 'Innergemeinschaftliche Lieferungen (§ 4 Nummer 1 Buchstabe b UStG) an Abnehmer mit Umsatzsteuer-Identifikationsnummer' },
  { zeile: 30, base: '46', tax: '47', label: 'Sonstige Leistungen nach § 3a Absatz 2 UStG eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b Absatz 1 UStG)' },
  { zeile: 32, base: '84', tax: '85', label: 'Andere Leistungen (§ 13b Absatz 2 Nummer 1, 2, 4 bis 12 UStG)' },
  { zeile: 34, base: '60', tax: null, label: 'Steuerpflichtige Umsätze des leistenden Unternehmers, für die der Leistungsempfänger die Steuer nach § 13b Absatz 5 UStG schuldet' },
  { zeile: 35, base: '21', tax: null, label: 'Nicht steuerbare sonstige Leistungen gemäß § 18b Satz 1 Nummer 2 UStG' },
  { zeile: 36, base: '45', tax: null, label: 'Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)' },
  { zeile: 37, base: null, tax: null, label: 'Umsatzsteuer (Summe der Zeilen 13 bis 18 und 25 bis 32)' },
  { zeile: 38, base: null, tax: '66', label: 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern (§ 15 Absatz 1 Satz 1 Nummer 1 UStG)' },
  { zeile: 41, base: null, tax: '67', label: 'Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG (§ 15 Absatz 1 Satz 1 Nummer 4 UStG)' },
  { zeile: 45, base: null, tax: null, label: 'Verbleibender Betrag (Zeile 37 abzüglich der Zeilen 38 bis 44)' },
  { zeile: 50, base: null, tax: '83', label: 'Verbleibende Umsatzsteuer-Vorauszahlung / Verbleibender Überschuss' },
];

/**
 * What the instructions of the form say about the tax of the lines 30 and 32 and the input tax of line 41, which the
 * code of `src/domain/ustva.ts` follows (read on 15 November 2026):
 * - Line 30: "Für die in Zeile 30 einzutragenden Umsätze entsteht die Steuer mit Ablauf des Voranmeldungszeitraums, in dem die
 *   Leistungen ausgeführt worden sind."
 * - Line 32 (the other services, among them "die nicht in Zeile 30 einzutragenden sonstigen Leistungen eines im Ausland
 *   ansässigen Unternehmers"): "Die Steuer für die übrigen Umsätze entsteht mit Ausstellung der Rechnung, spätestens jedoch mit
 *   Ablauf des Kalendermonats, der auf die Ausführung der Leistung folgt."
 * - Line 41: input tax "aus Leistungen im Sinne des § 13b Absatz 1 und 2 UStG, die Sie als Leistungsempfänger nach § 13b
 *   Absatz 5 UStG schulden ..., wenn die Leistungen für Ihr Unternehmen ausgeführt worden sind".
 * - Small business: "Für den Zeitraum der Anwendung der Kleinunternehmer-Regelung sind Sie nicht berechtigt, ... Vorsteuern
 *   nach § 15 UStG abzuziehen", and "Steuerbeträge, die Sie als Kleinunternehmer nach § 13b Absatz 5 UStG schulden" go to
 *   lines 30 to 32.
 */
