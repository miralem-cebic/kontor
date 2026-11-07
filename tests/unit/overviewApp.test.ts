import { describe, expect, it } from 'vitest';
import { buildOverview, companyTurnoverEntries } from '../../src/app/overview';
import { makeContact, makeExpense, makeInvoice, makePayment } from '../../src/data/schema';
import type { DocumentId } from '../../src/data/ids';
import type { CompanyFile, DocumentFile, InvoiceFile } from '../../src/data/types';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import { sampleCompany, sampleContact, sampleExpense, sampleIssued, sampleInvoice, sampleLine } from './fixtures';

// The overview of a small business: the Gesamtumsatz (§ 19 Abs. 2 UStG) is the net part of the payments, the warning
// says when the 100,000 € are close or crossed, and § 13b expenses make the banner.

const NOW = new Date(2026, 10, 7);
const SMALL: CompanyFile = { ...sampleCompany(), tax: { ...sampleCompany().tax, vat: { kind: 'smallBusiness' } } };
const REGULAR: CompanyFile = sampleCompany();
const ACCOUNT = SMALL.bank.defaultAccountId;
const customer = makeContact(sampleContact());

/** An issued invoice of one line at `euros` (quantity 1, 0 % VAT, so net and gross are the same) */
const invoice = (company: CompanyFile, euros: number, over: Partial<ReturnType<typeof sampleInvoice>> = {}): InvoiceFile => ({
  ...makeInvoice(customer.id, ACCOUNT, sampleInvoice({ date: '2026-03-01', lines: [sampleLine({ quantity: quantity(1000), unitPrice: cents(Math.round(euros * 100)), vatRate: basisPoints(0) })], ...over }), null),
  issued: sampleIssued('RE-2026-0001', { snapshot: { ...sampleIssued().snapshot, company: { ...sampleIssued().snapshot.company, tax: company.tax } } }),
});
const docs = (...list: DocumentFile[]) => new Map<DocumentId, DocumentFile>(list.map((d) => [d.id, d]));
const pay = (inv: InvoiceFile, date: string, euros: number) => makePayment(inv.id, { date, amount: cents(Math.round(euros * 100)), accountId: ACCOUNT, note: '' });
const toMap = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

describe('the turnover of the limits in the overview', () => {
  it('counts the payments of the year, not the invoices: an invoice that is not paid yet is not turnover', () => {
    const inv = invoice(SMALL, 30_000);
    const unpaid = buildOverview(SMALL, docs(inv), new Map(), new Map(), new Map(), NOW)!;
    expect(unpaid.figures.turnover).toBe(0);
    const paid = buildOverview(SMALL, docs(inv), toMap([pay(inv, '2026-04-01', 30_000)]), new Map(), new Map(), NOW)!;
    expect(paid.figures.turnover).toBe(3_000_000);
    expect(paid.warning).toBeNull();
  });

  it('leaves out the payments of a service that is not taxable in Germany', () => {
    const abroad = invoice(SMALL, 90_000, { taxTreatment: 'notTaxable' });
    const payments = toMap([pay(abroad, '2026-04-01', 90_000)]);
    const view = buildOverview(SMALL, docs(abroad), payments, new Map(), new Map(), NOW)!;
    expect(view.figures.income).toBe(9_000_000);
    expect(view.figures.turnover).toBe(0);
    expect(view.warning).toBeNull();
    expect(companyTurnoverEntries(SMALL, docs(abroad), payments)).toEqual([]);
  });
});

describe('the warning for a small business', () => {
  it('warns when the turnover is at 80 % of the limit, and says when the limit was crossed', () => {
    const inv = invoice(SMALL, 120_000);
    const close = buildOverview(SMALL, docs(inv), toMap([pay(inv, '2026-04-01', 80_000)]), new Map(), new Map(), NOW)!;
    expect(close.warning).toEqual({ kind: 'close', percent: 80 });
    const crossed = buildOverview(SMALL, docs(inv), toMap([pay(inv, '2026-04-01', 80_000), pay(inv, '2026-09-15', 20_000.01)]), new Map(), new Map(), NOW)!;
    expect(crossed.warning).toEqual({ kind: 'crossed', day: '2026-09-15' });
  });

  it('has no warning for a company with regular VAT, which charges VAT anyway', () => {
    const inv = invoice(REGULAR, 120_000);
    const view = buildOverview(REGULAR, docs(inv), toMap([pay(inv, '2026-04-01', 110_000)]), new Map(), new Map(), NOW)!;
    expect(view.warning).toBeNull();
    expect(view.reverseChargeExpenses).toBe(0);
  });
});

describe('the banner for § 13b UStG', () => {
  const expense = (over: Parameters<typeof sampleExpense>[0]) => makeExpense({ ...sampleExpense({ vatRate: basisPoints(0), ...over }), accountId: null });

  it('counts the expenses of the year with reverse charge or from outside the EU, for a small business only', () => {
    const list = toMap([
      expense({ taxTreatment: 'euReverseCharge' }),
      expense({ taxTreatment: 'thirdCountry' }),
      expense({ taxTreatment: 'noVat' }),
      expense({ date: '2025-12-31', taxTreatment: 'euReverseCharge' }),
      { ...expense({ taxTreatment: 'euReverseCharge' }), deletedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(buildOverview(SMALL, docs(), new Map(), list, new Map(), NOW)!.reverseChargeExpenses).toBe(2);
    expect(buildOverview(REGULAR, docs(), new Map(), list, new Map(), NOW)!.reverseChargeExpenses).toBe(0);
  });
});
