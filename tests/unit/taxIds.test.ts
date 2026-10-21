import { describe, expect, it } from 'vitest';
import { isValidGermanVatId, isValidTaxNumber, normalizeVatId } from '../../src/domain/taxIds';

describe('Steuernummer', () => {
  it.each(['12/345/67890', '123/456/78901', '2181508150', '9181081508155', '21 815 08150'])('accepts %s', (n) => expect(isValidTaxNumber(n)).toBe(true));
  it.each(['', '123456789', '12345678901234', '12/345/6789A'])('rejects %s', (n) => expect(isValidTaxNumber(n)).toBe(false));
});

describe('USt-IdNr.', () => {
  // published IDs of large companies, which pass the BZSt check digit procedure
  it.each(['DE136695976', 'DE129273398', 'DE812526315', 'de 136 695 976'])('accepts %s', (id) => expect(isValidGermanVatId(id)).toBe(true));
  it.each(['DE136695977', 'DE13669597', 'ATU12345678', 'DE1366959760', 'DE999999999'])('rejects %s', (id) => expect(isValidGermanVatId(id)).toBe(false));
  it('normalizes', () => expect(normalizeVatId('de 136.695-976')).toBe('DE136695976'));

  it('accepts exactly one check digit for every eight digits', () => {
    for (const base of ['00000000', '12345678', '98765432', '13669597']) {
      const valid = [...'0123456789'].filter((d) => isValidGermanVatId(`DE${base}${d}`));
      expect(valid).toHaveLength(1);
    }
  });
});
