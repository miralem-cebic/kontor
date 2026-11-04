import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { effectiveTaxTreatment, emptyInvoiceDraft, invoiceTotals, issueProblems, readInvoice, TAX_TREATMENTS, vatNote } from '../../src/domain/invoice';
import { sampleInvoice } from './fixtures';

// A small business (§ 19 UStG) charges no VAT. It may still issue a service whose place of supply is abroad
// (§ 3a UStG): that invoice shows no VAT either, and the note of § 3a instead of the note of § 19. Every other tax
// treatment counts as "no VAT, § 19" for a small business.

describe('a small business and the tax treatment of an invoice', () => {
  it('may choose a service not taxable in Germany; every other choice is "no VAT, § 19"', () => {
    expect(effectiveTaxTreatment('notTaxable', true)).toBe('notTaxable');
    expect(effectiveTaxTreatment('standard', true)).toBe('standard');
    expect(effectiveTaxTreatment('reverseCharge', true)).toBe('standard');
    expect(effectiveTaxTreatment('intraCommunitySupply', true)).toBe('standard');
  });

  it('a regular business keeps every treatment', () => {
    expect(TAX_TREATMENTS.map((v) => effectiveTaxTreatment(v, false))).toEqual([...TAX_TREATMENTS]);
  });

  it('the note of a small business is the note of § 19, except for a service not taxable in Germany', () => {
    expect(TAX_TREATMENTS.map((v) => vatNote(v, true))).toEqual(['smallBusiness', 'smallBusiness', 'smallBusiness', 'notTaxable']);
  });

  it('a service not taxable in Germany shows no VAT, so its total is its net amount', () => {
    expect(invoiceTotals({ ...sampleInvoice(), taxTreatment: 'notTaxable' }, true)).toMatchObject({ tax: 0, gross: 136250 });
  });

  it('it needs the address of the customer, like any service not taxable in Germany', () => {
    const facts = { lineCount: 1, gross: cents(10_000), taxTreatment: 'notTaxable' as const, customer: { address: null, vatId: '' }, ownVatId: '', accountActive: true };
    expect(issueProblems(facts)).toEqual(['customerAddress']);
  });

  it('a draft keeps the choice of a small business, and any other choice becomes "no VAT, § 19"', () => {
    const draft = (taxTreatment: 'notTaxable' | 'reverseCharge') => ({ ...emptyInvoiceDraft('2026-11-04', 'account-1', 14), customerId: 'c1', taxTreatment });
    const kept = readInvoice(draft('notTaxable'), 'de', true);
    expect(kept.ok && kept.value.content.taxTreatment).toBe('notTaxable');
    const other = readInvoice(draft('reverseCharge'), 'de', true);
    expect(other.ok && other.value.content.taxTreatment).toBe('standard');
  });
});
