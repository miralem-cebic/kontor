// German tax identifiers on invoices (§ 14 Abs. 4 Nr. 2 UStG: Steuernummer or USt-IdNr.).

/**
 * Steuernummer: 10 or 11 digits in the format of the state ("12/345/67890") or 13 digits in the
 * nationwide ELSTER format. Only the number of digits is checked; the state formats differ.
 */
export const normalizeTaxNumber = (input: string): string => input.replace(/[\s/-]/g, '');

export const isValidTaxNumber = (input: string): boolean => /^\d{10,13}$/.test(normalizeTaxNumber(input));

/** USt-IdNr. without spaces and in capitals: "de 136 695 976" → "DE136695976" */
export const normalizeVatId = (input: string): string => input.replace(/[\s.-]/g, '').toUpperCase();

/**
 * German USt-IdNr.: "DE" and nine digits, the last one a check digit (ISO 7064 MOD 11,10 over the first eight).
 * Source of the procedure: Bundeszentralamt für Steuern, https://www.bzst.de (Prüfung der USt-IdNr.).
 * A valid check digit does not mean the number is assigned; only the BZSt confirmation service can tell that.
 */
export function isValidGermanVatId(input: string): boolean {
  const id = normalizeVatId(input);
  if (!/^DE\d{9}$/.test(id)) return false;
  let product = 10;
  for (const ch of id.slice(2, 10)) {
    let s = (Number(ch) + product) % 10;
    if (s === 0) s = 10;
    product = (2 * s) % 11;
  }
  const check = (11 - product) % 10;
  return check === Number(id[10]);
}

/** Country prefixes of VAT IDs in the EU (Greece uses EL, Northern Ireland XI) */
const EU_VAT_PREFIXES = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'] as const;

/**
 * VAT ID of a business customer in the EU: country prefix and 2 to 12 letters or digits. German IDs also need a
 * valid check digit. Only the form is checked; whether the ID is assigned can only be confirmed by the BZSt
 * (qualified confirmation) or VIES.
 */
export function isPlausibleEuVatId(input: string): boolean {
  const id = normalizeVatId(input);
  const prefix = id.slice(0, 2);
  if (!(EU_VAT_PREFIXES as readonly string[]).includes(prefix) || !/^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(id)) return false;
  return prefix !== 'DE' || isValidGermanVatId(id);
}

/**
 * Leitweg-ID of a public buyer (BT-10 in XRechnung): coarse address (2–12 digits), optional fine address
 * (up to 30 letters or digits) and two check digits, separated by "-", at most 46 characters.
 * Source: KoSIT, Formatspezifikation Leitweg-ID, https://www.xoev.de/xrechnung-16828
 * Only the structure is checked here; the check digits are verified when e-invoices are built (Phase 2).
 */
export const isPlausibleLeitwegId = (input: string): boolean => {
  const id = input.trim();
  return id.length <= 46 && /^\d{2,12}(-[A-Za-z0-9]{1,30})?-\d{2}$/.test(id);
};
