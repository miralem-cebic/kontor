import { describe, expect, it } from 'vitest';
import { taxParams } from '../../src/domain/tax/params';
import { FORM_2026, type FormLine } from '../fixtures/vat/form-2026';

// The field numbers of the tax parameters against the lines of the official form (#34): a number that differs fails here.
// Only 2026 has lines; 2027 uses the numbers of the form of 2026 until the BMF publishes the next form, which is the
// reason the test runs both years against the same lines. A new year with a changed form needs its own lines.

const line = (lines: readonly FormLine[], kz: string): FormLine | undefined => lines.find((l) => l.base === kz || l.tax === kz);

describe.each([2026, 2027])('the Kennzahlen of %i against the official form of 2026 (USt 1 A)', (year) => {
  const kz = taxParams(year).vatReturn.kz;

  it.each([
    ['taxable19', kz.taxable19, 13],
    ['taxable7', kz.taxable7, 14],
    ['intraCommunitySupply', kz.intraCommunitySupply, 19],
    ['euReverseCharge', kz.euReverseCharge, 30],
    ['otherReverseCharge', kz.otherReverseCharge, 32],
    ['reverseChargeSupplied', kz.reverseChargeSupplied, 34],
    ['euServices', kz.euServices, 35],
    ['otherNotTaxable', kz.otherNotTaxable, 36],
    ['inputTax', kz.inputTax, 38],
    ['inputTaxReverseCharge', kz.inputTaxReverseCharge, 41],
    ['remainingPrepayment', kz.remainingPrepayment, 50],
  ])('%s is %s and sits in line %i of the form', (_id, number, zeile) => {
    expect(line(FORM_2026, number)?.zeile).toBe(zeile);
  });

  it('the tax columns of lines 30 and 32 have the numbers 47 and 85', () => {
    expect(line(FORM_2026, kz.euReverseChargeTax)).toMatchObject({ zeile: 30, base: kz.euReverseCharge, tax: '47' });
    expect(line(FORM_2026, kz.otherReverseChargeTax)).toMatchObject({ zeile: 32, base: kz.otherReverseCharge, tax: '85' });
  });

  it('every number in the parameters is a line of the form, and none is used twice', () => {
    const numbers = Object.values(kz);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(line(FORM_2026, n), `Kz ${n}`).toBeDefined();
  });
});
