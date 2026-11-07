import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { effectiveTaxTreatment, emptyInvoiceDraft, invoiceTotals, issueProblems, readInvoice, TAX_TREATMENTS, vatNote } from '../../src/domain/invoice';
import { documentContent } from '../../src/pdf/content';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { BankAccount } from '../../src/data/types';
import { basisPoints, quantity } from '../../src/domain/money';
import { SMALL_AMOUNT_LIMIT } from '../../src/domain/invoice';
import { sampleCompany, sampleContact, sampleInvoice, sampleLine } from './fixtures';

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
    const facts = { lineCount: 1, gross: cents(10_000), taxTreatment: 'notTaxable' as const, customer: { address: null, vatId: '' }, ownVatId: '', accountActive: true, smallBusinessRefusal: null };
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

// § 14c Abs. 2 UStG: a small business that shows VAT owes it. That holds for a small amount invoice (§ 33 UStDV, up to
// 250 € gross) as much as for any other: a rate in the lines never reaches the totals or the PDF of a small business.
describe('a small business never shows a tax rate, also on a small amount invoice (§ 14c Abs. 2 UStG, § 33 UStDV)', () => {
  const small = sampleCompany({ tax: { taxNumber: '12/345/67890', vatId: '', vat: { kind: 'smallBusiness' }, business: { kind: 'freelance' } } });
  const account = small.bank.accounts[0] as BankAccount;
  const customer = makeContact(sampleContact({ address: null }));
  // 100 € at 19 % and 40 € at 7 %: a small amount invoice, with rates in its lines
  const lines = [sampleLine({ quantity: quantity(1000), unitPrice: cents(10_000), vatRate: basisPoints(1900) }), sampleLine({ name: 'Heft', quantity: quantity(1000), unitPrice: cents(4_000), vatRate: basisPoints(700) })];
  const content = sampleInvoice({ lines, taxTreatment: 'standard' });

  it('the totals show no VAT: the net amount is the gross amount, within the small amount limit', () => {
    const totals = invoiceTotals(content, true);
    expect(totals).toMatchObject({ net: 14_000, tax: 0, gross: 14_000 });
    expect(totals.gross).toBeLessThanOrEqual(SMALL_AMOUNT_LIMIT);
    expect(totals.byRate.map((r) => r.rate)).toEqual([0]);
  });

  it('the same lines with regular VAT would show the rates, so the rule is the small business, not the amount', () => {
    expect(invoiceTotals(content, false).byRate.map((r) => r.rate)).toEqual([700, 1900]);
  });

  it('the PDF shows no rate in a line and no VAT in the totals, only the note of § 19', () => {
    const doc = makeInvoice(customer.id, account.id, content, null);
    const c = documentContent({ company: small, document: doc, customer, account, lang: 'de', number: null });
    expect(c.table.showRate).toBe(false);
    expect(c.table.rows.map((r) => r.rate)).toEqual(['', '']);
    expect(c.totals).toEqual([{ label: 'Gesamtbetrag', value: '140,00\u00a0€', grand: true }]);
    expect(c.notes[0]).toBe('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
  });

  it('it can be issued as a small amount invoice without an address, and the check does not ask for a rate', () => {
    const facts = { lineCount: 2, gross: invoiceTotals(content, true).gross, taxTreatment: 'standard' as const, customer: { address: null, vatId: '' }, ownVatId: '', accountActive: true, smallBusinessRefusal: null };
    expect(issueProblems(facts)).toEqual([]);
  });
});
