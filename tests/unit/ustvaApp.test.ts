import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCsv } from '../../src/data/export/csv';
import { makeCancellation, makeContact, makeExpense, makeInvoice, makePayment, makePayout } from '../../src/data/schema';
import type { DocumentFile, ExpenseFile, InvoiceFile, PaymentFile } from '../../src/data/types';
import { brandId } from '../../src/data/ids';
import type { DocumentId } from '../../src/data/ids';
import { buildUstva, owesReverseChargeTax, payerCountry, ustvaBookingLabel, ustvaCopyValue, ustvaTable, ustvaTerms } from '../../src/app/ustva';
import { basisPoints, cents } from '../../src/domain/money';
import { usePrefs } from '../../src/store/prefs';
import { sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued, samplePayout, sampleProfile } from './fixtures';

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

describe('expenses with reverse charge (#34)', () => {
  const smallNow = sampleCompany({ tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } } });
  const fee = makeExpense({ ...sampleExpense({ date: '2026-10-16', gross: cents(9_900), taxTreatment: 'euReverseCharge', vatRate: basisPoints(0) }), accountId: null });

  it('a business with regular VAT owes and deducts the tax of the fee: Kz 46/47, 67, nothing to pay', () => {
    const r = buildUstva(COMPANY, docs(), none, expensesOf(fee), OCT);
    expect(field(r, 'euReverseCharge')).toMatchObject({ kz: '46', taxKz: '47', base: 9_900, tax: 1_881 });
    expect(field(r, 'inputTaxReverseCharge')?.tax).toBe(1_881);
    expect(field(r, 'remainingPrepayment')?.tax).toBe(0);
    expect(field(r, 'euReverseCharge')?.bookings).toEqual([{ kind: 'expense', id: fee.id, base: 9_900, tax: 1_881 }]);
  });

  it('a small business files only for that tax, in the period it falls in (§ 18 Abs. 4a UStG), without input tax', () => {
    const r = buildUstva(smallNow, docs(), none, expensesOf(fee), OCT);
    expect(r?.mode).toBe('smallBusiness');
    expect(field(r, 'euReverseCharge')).toMatchObject({ base: 9_900, tax: 1_881, shown: true });
    expect(field(r, 'inputTaxReverseCharge')?.tax).toBe(0);
    expect(field(r, 'remainingPrepayment')?.tax).toBe(1_881);
    // no return for another period, and none without such an expense
    expect(buildUstva(smallNow, docs(), none, expensesOf(fee), NOV)).toBeNull();
    expect(buildUstva(smallNow, docs(), none, none, OCT)).toBeNull();
    // the due date is the 10th after the period, without a permanent extension
    expect(r?.dueDate).toBe('2026-11-10');
  });

  it('owesReverseChargeTax: an expense with reverse charge or from a third country, not a removed one', () => {
    expect(owesReverseChargeTax(expensesOf(fee))).toBe(true);
    expect(owesReverseChargeTax(expensesOf(fee), NOV)).toBe(false);
    expect(owesReverseChargeTax(expensesOf({ ...fee, deletedAt: '2026-10-30T10:00:00.000Z' }))).toBe(false);
    expect(owesReverseChargeTax(expensesOf(makeExpense({ ...sampleExpense(), accountId: null })))).toBe(false);
  });

  it('the CSV shows both numbers of a field and the table leaves out the fields a small business does not file', () => {
    const regular = ustvaTable(buildUstva(COMPANY, docs(), none, expensesOf(fee), OCT)!);
    expect(regular.rows.map((row) => row[0])).toContain('46 / 47');
    const small = ustvaTable(buildUstva(smallNow, docs(), none, expensesOf(fee), OCT)!);
    expect(small.rows.map((row) => row[0])).toEqual(['46 / 47', '83']);
  });
});

describe('payouts (#34)', () => {
  const apple = makeContact(sampleContact({ name: 'Apple Distribution International', address: { street: 'Hollyhill', postalCode: 'T23', city: 'Cork', country: 'IE' }, vatId: 'IE9700053D' }));
  const google = makeContact(sampleContact({ name: 'Google LLC', address: { street: '1600 Amphitheatre', postalCode: '94043', city: 'Mountain View', country: 'US' }, vatId: '' }));
  const contacts = new Map([apple, google].map((c) => [c.id as string, c]));
  const payoutsOf = (...list: ReturnType<typeof makePayout>[]) => new Map(list.map((p) => [p.id as string, p]));
  const payout = (payer: typeof apple, over: Parameters<typeof samplePayout>[2] = {}) => makePayout({ ...samplePayout(ACCOUNT_ID, payer.id, over), accountId: ACCOUNT_ID, payerId: payer.id });
  const OCT_RETURN = OCT;
  const records = (...list: ReturnType<typeof makePayout>[]) => ({ payouts: payoutsOf(...list), contacts });

  it('a payout from an EU business belongs to Kz 21 of the month it covers, not of the month the money arrived', () => {
    const p = payout(apple, { date: '2026-11-03', period: '2026-10' });
    expect(field(buildUstva(COMPANY, docs(), none, none, OCT_RETURN, records(p)), 'euServices')).toMatchObject({ base: 123_456, bookings: [{ kind: 'payout', id: p.id, base: 123_456 }] });
    expect(field(buildUstva(COMPANY, docs(), none, none, NOV, records(p)), 'euServices')?.base).toBe(0);
  });

  it('a payout from outside the EU is a service with its place abroad: Kz 45, no Kz 21', () => {
    const p = payout(google, { taxTreatment: 'thirdCountryB2bNotTaxable', date: '2026-10-05', period: '2026-10' });
    const r = buildUstva(COMPANY, docs(), none, none, OCT_RETURN, records(p));
    expect(field(r, 'otherNotTaxable')?.base).toBe(123_456);
    expect(field(r, 'euServices')?.base).toBe(0);
  });

  it('a payout from a German payer with 19 % inside is a taxed supply: only the net part is the base', () => {
    const de = makeContact(sampleContact({ name: 'Beispiel GmbH' }));
    const p = payout(de, { taxTreatment: 'domesticTaxed', vatRate: basisPoints(1900), amount: cents(11_900), date: '2026-10-05', period: '2026-10' });
    const r = buildUstva(COMPANY, docs(), none, none, OCT_RETURN, { payouts: payoutsOf(p), contacts: new Map([[de.id as string, de]]) });
    expect(field(r, 'taxable19')).toMatchObject({ base: 10_000, tax: 1_900 });
  });

  it('a removed payout, one of the small business scheme and one without a country of the payer', () => {
    const removed: ReturnType<typeof makePayout> = { ...payout(apple, { period: '2026-10' }), deletedAt: '2026-11-04T10:00:00.000Z' };
    expect(field(buildUstva(COMPANY, docs(), none, none, OCT_RETURN, records(removed)), 'euServices')?.base).toBe(0);
    const small = payout(apple, { taxTreatment: 'smallBusiness', period: '2026-10' });
    expect(field(buildUstva(COMPANY, docs(), none, none, OCT_RETURN, records(small)), 'euServices')?.base).toBe(0);
    const stranger = makeContact(sampleContact({ name: 'Nowhere', address: null, vatId: '' }));
    const lost = payout(stranger, { period: '2026-10' });
    const r = buildUstva(COMPANY, docs(), none, none, OCT_RETURN, { payouts: payoutsOf(lost), contacts: new Map([[stranger.id as string, stranger]]) });
    expect(r?.notices).toEqual([{ code: 'supplyUnplaced', count: 1, amount: 123_456 }]);
  });

  it('a payout where the platform collects the VAT is not included and is reported (open question of #30)', () => {
    const p = payout(apple, { taxTreatment: 'platformCollectsVat', date: '2026-10-05', period: '2026-10' });
    const r = buildUstva(COMPANY, docs(), none, none, OCT_RETURN, records(p));
    expect(r?.notices).toEqual([{ code: 'payoutPlatformVat', count: 1, amount: 123_456 }]);
    expect(field(r, 'euServices')?.base).toBe(0);
    expect(field(r, 'otherNotTaxable')?.base).toBe(0);
  });

  it('payerCountry: the address, else the start of the VAT ID with EL read as Greece', () => {
    expect(payerCountry(apple)).toBe('IE');
    expect(payerCountry(makeContact(sampleContact({ address: null, vatId: 'EL123456789' })))).toBe('GR');
    expect(payerCountry(makeContact(sampleContact({ address: null, vatId: '' })))).toBeNull();
    expect(payerCountry(undefined)).toBeNull();
  });

  it('ustvaBookingLabel names the invoice, the payout and the expense', () => {
    const p = payout(apple, { date: '2026-11-03' });
    const exp = makeExpense({ ...sampleExpense(), accountId: null });
    const inv = issuedInvoice();
    const src = { documents: docs(inv), expenses: expensesOf(exp), payouts: payoutsOf(p), contacts };
    expect(ustvaBookingLabel({ kind: 'invoice', id: inv.id, base: null, tax: null }, src)).toBe('RE-2026-0001');
    expect(ustvaBookingLabel({ kind: 'payout', id: p.id, base: null, tax: null }, src)).toBe('Apple Distribution International, 2026-11-03');
    expect(ustvaBookingLabel({ kind: 'expense', id: exp.id, base: null, tax: null }, src)).toBe('Telekom, 2026-10-28');
    expect(ustvaBookingLabel({ kind: 'expense', id: 'gone', base: null, tax: null }, src)).toBe('gone');
  });
});
