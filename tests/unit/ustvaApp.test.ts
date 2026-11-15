import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCsv } from '../../src/data/export/csv';
import { makeCancellation, makeContact, makeExpense, makeInvoice, makePayment } from '../../src/data/schema';
import type { DocumentFile, ExpenseFile, InvoiceFile, PaymentFile } from '../../src/data/types';
import { brandId } from '../../src/data/ids';
import type { DocumentId } from '../../src/data/ids';
import { buildUstva, ustvaCopyValue, ustvaTable, ustvaTerms } from '../../src/app/ustva';
import { cents } from '../../src/domain/money';
import { usePrefs } from '../../src/store/prefs';
import { sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued, sampleProfile } from './fixtures';

beforeEach(() => usePrefs.setState({ language: 'de' }));

const COMPANY = sampleCompany();
const ACCOUNT_ID = COMPANY.bank.defaultAccountId;
const OCT = { year: 2026, kind: 'month', index: 10 } as const;
const NOV = { year: 2026, kind: 'month', index: 11 } as const;

const customer = makeContact(sampleContact());
// 1,062.50 € at 19 % (VAT 201.88 €) and 300.00 € at 7 % (VAT 21.00 €); gross 1,585.38 €
const issuedInvoice = (): InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> } => ({ ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice(), null), issued: sampleIssued('RE-2026-0001') });
const docs = (...list: DocumentFile[]): Map<DocumentId, DocumentFile> => new Map(list.map((d) => [d.id, d]));
const none = new Map<string, never>();
const expensesOf = (...list: ExpenseFile[]) => new Map(list.map((e) => [e.id, e]));
const paymentsOf = (...list: PaymentFile[]) => new Map(list.map((p) => [p.id, p]));
const field = (r: ReturnType<typeof buildUstva>, id: string) => r?.fields.find((f) => f.id === id);

describe('buildUstva', () => {
  it('worked example, accrual: the invoice counts in the month its service ends, the expense by its date', () => {
    const exp = makeExpense({ ...sampleExpense(), accountId: null });
    const r = buildUstva(COMPANY, docs(issuedInvoice()), none, expensesOf(exp), OCT);
    expect(field(r, 'taxable19')).toMatchObject({ base: 106_250, tax: 20_188 });
    expect(field(r, 'taxable7')).toMatchObject({ base: 30_000, tax: 2_100 });
    // 49.99 € gross at 19 %: 42.01 € net, 7.98 € VAT
    expect(field(r, 'inputTax')?.tax).toBe(798);
    expect(field(r, 'remainingPrepayment')?.tax).toBe(21_490);
    // quarterly with permanent extension in the sample company
    expect(r?.dueDate).toBe('2026-12-10');
  });

  it('leaves out drafts and deleted expenses', () => {
    const draft = makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice(), null);
    const deleted: ExpenseFile = { ...makeExpense({ ...sampleExpense(), accountId: null }), deletedAt: '2026-10-30T10:00:00.000Z' };
    const r = buildUstva(COMPANY, docs(draft), none, expensesOf(deleted), OCT);
    expect(field(r, 'taxable19')?.base).toBe(0);
    expect(field(r, 'inputTax')?.tax).toBe(0);
  });

  it('an issued cancellation counts negative in the month of its date', () => {
    const original = issuedInvoice();
    const cancellation: InvoiceFile = { ...makeCancellation(original, '2026-11-02', brandId<'DocumentId'>('11111111-1111-4111-8111-111111111111')), issued: sampleIssued('RE-2026-0002') };
    const r = buildUstva(COMPANY, docs(original, cancellation), none, none, NOV);
    expect(field(r, 'taxable19')).toMatchObject({ base: -106_250, tax: -20_188 });
  });

  it('cash basis: the payments of the period count their share of the invoice', () => {
    const cash = sampleCompany({ tax: { ...sampleProfile().tax, vat: { kind: 'regular', method: 'cash', period: 'monthly', permanentExtension: false } } });
    const original = issuedInvoice();
    // 1,585.38 € gross in all; 792.69 € is half of it
    const payment = makePayment(original.id, { date: '2026-11-03', amount: cents(79_269), accountId: ACCOUNT_ID, note: '' });
    const deleted: PaymentFile = { ...makePayment(original.id, { date: '2026-11-04', amount: cents(10_000), accountId: ACCOUNT_ID, note: '' }), deletedAt: '2026-11-05T10:00:00.000Z' };
    const r = buildUstva(cash, docs(original), paymentsOf(payment, deleted), none, NOV);
    expect(field(r, 'taxable19')).toMatchObject({ base: 53_125, tax: 10_094 });
    expect(field(buildUstva(cash, docs(original), paymentsOf(payment), none, OCT), 'taxable19')?.base).toBe(0);
    expect(r?.dueDate).toBe('2026-12-10');
  });

  it('an invoice issued by a small business is not part of the return', () => {
    const smallProfile = sampleProfile({ tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } } });
    const small: InvoiceFile = { ...issuedInvoice(), issued: sampleIssued('RE-2026-0001', { snapshot: { ...sampleIssued().snapshot, company: smallProfile } }) };
    expect(field(buildUstva(COMPANY, docs(small), none, none, OCT), 'taxable19')?.base).toBe(0);
  });

  it('is null for a small business company and without a company', () => {
    const small = sampleCompany({ tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } } });
    expect(buildUstva(small, docs(), none, none, OCT)).toBeNull();
    expect(buildUstva(null, docs(), none, none, OCT)).toBeNull();
  });
});

describe('ustvaCopyValue', () => {
  it('copies a base in whole euros and a tax with a comma, without grouping', () => {
    expect(ustvaCopyValue('base', cents(106_250))).toBe('1062');
    expect(ustvaCopyValue('tax', cents(20_188))).toBe('201,88');
    expect(ustvaCopyValue('tax', cents(-1_900_000))).toBe('-19000,00');
    expect(ustvaCopyValue('base', cents(-99))).toBe('0');
  });
});

describe('ustvaTable', () => {
  it('has one line per shown field: number, description, base in whole euros and exact, and tax', () => {
    const r = buildUstva(COMPANY, docs(issuedInvoice()), none, none, OCT)!;
    const table = ustvaTable(r);
    const text = new TextDecoder().decode(encodeCsv(table.header, table.rows)).replace(/^\uFEFF/, '');
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Kennzahl;Beschreibung;Bemessungsgrundlage (volle Euro);Bemessungsgrundlage (genau);Steuer');
    expect(lines[1]).toMatch(/^81;.*;1062;1062,50;201,88$/);
    // header, 81, 86, 66, 83 and the empty piece after the last line break
    expect(lines).toHaveLength(6);
  });
});

describe('the VAT status of the day (#77)', () => {
  const smallProfile = sampleProfile({
    tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } },
  });
  const smallNow = sampleCompany({
    tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } },
  });
  const Q2 = { year: 2026, kind: 'quarter', index: 2 } as const;
  const Q3 = { year: 2026, kind: 'quarter', index: 3 } as const;
  const Q4 = { year: 2026, kind: 'quarter', index: 4 } as const;
  const Q1_2027 = { year: 2027, kind: 'quarter', index: 1 } as const;
  const issuedOn = (date: string, number: string, small: boolean): InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> } => ({
    ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ date, service: { kind: 'date', date } }), null),
    issued: sampleIssued(number, {
      issuedAt: `${date}T10:00:00.000Z`,
      snapshot: {
        ...sampleIssued().snapshot,
        company: small ? smallProfile : sampleProfile(),
      },
    }),
  });

  it('leaves out the expenses of a day on which the business was a small business (no right to deduct input tax)', () => {
    // small business until the invoice of 15 July, regular from then on, accrual method
    const history = docs(issuedOn('2026-03-01', 'RE-2026-0001', true), issuedOn('2026-07-15', 'RE-2026-0002', false));
    const before = makeExpense(
      sampleExpense({
        date: '2026-07-05',
        gross: cents(11_900),
        accountId: null,
      }),
    );
    const after = makeExpense(
      sampleExpense({
        date: '2026-08-01',
        gross: cents(11_900),
        accountId: null,
      }),
    );
    // the quarter of the change: only the expense after it has input tax
    const q3 = buildUstva(COMPANY, history, none, expensesOf(before, after), Q3);
    expect(field(q3, 'inputTax')?.tax).toBe(1_900);
    // the output tax of the invoice of 15 July (20,188 + 2,100) less that input tax
    expect(field(q3, 'remainingPrepayment')?.tax).toBe(20_388);
    // the quarter before it was a small business throughout: no input tax, so no refund claim (the case of #77)
    const q2 = buildUstva(
      COMPANY,
      history,
      none,
      expensesOf(
        before,
        after,
        makeExpense(
          sampleExpense({
            date: '2026-05-10',
            gross: cents(11_900),
            accountId: null,
          }),
        ),
      ),
      Q2,
    );
    expect(field(q2, 'inputTax')?.tax).toBe(0);
    expect(field(q2, 'remainingPrepayment')?.tax).toBe(0);
  });

  it('gives the return of the last regular periods to a business that is a small business today', () => {
    const history = docs(issuedInvoice());
    const r = buildUstva(smallNow, history, none, none, Q4);
    expect(field(r, 'taxable19')).toMatchObject({ base: 106_250, tax: 20_188 });
    // the terms are those of the invoice's snapshot: quarterly, permanent extension
    expect(r?.dueDate).toBe(buildUstva(COMPANY, history, none, none, Q4)?.dueDate);
  });

  it('files no return for a period after the change to small business, nor for a business that was never regular', () => {
    expect(buildUstva(smallNow, docs(issuedInvoice()), none, none, Q1_2027)).toBeNull();
    // while a business that is regular today always gets its return
    expect(buildUstva(COMPANY, docs(issuedOn('2026-10-31', 'RE-2026-0001', true)), none, none, Q4)).not.toBeNull();
    expect(buildUstva(smallNow, docs(), none, none, Q4)).toBeNull();
  });

  it('ustvaTerms: the terms of the company, or of the last regular invoice for a small business today, or null', () => {
    expect(ustvaTerms(COMPANY, docs())).toEqual({
      kind: 'regular',
      method: 'accrual',
      period: 'quarterly',
      permanentExtension: true,
    });
    expect(ustvaTerms(smallNow, docs(issuedInvoice()))).toEqual({
      kind: 'regular',
      method: 'accrual',
      period: 'quarterly',
      permanentExtension: true,
    });
    expect(ustvaTerms(smallNow, docs(issuedOn('2026-03-01', 'RE-2026-0001', true)))).toBeNull();
    expect(ustvaTerms(null, docs())).toBeNull();
  });
});
