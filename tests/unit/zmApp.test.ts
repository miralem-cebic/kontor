import { beforeEach, describe, expect, it } from 'vitest';
import { makeCancellation, makeContact, makeInvoice, makePayment } from '../../src/data/schema';
import type { DocumentFile, InvoiceFile } from '../../src/data/types';
import { brandId } from '../../src/data/ids';
import type { DocumentId } from '../../src/data/ids';
import { buildZm, zmCopyValue, zmTable } from '../../src/app/zm';
import { cents } from '../../src/domain/money';
import { usePrefs } from '../../src/store/prefs';
import { sampleAccount, sampleCompany, sampleContact, sampleInvoice, sampleIssued, sampleProfile } from './fixtures';

beforeEach(() => usePrefs.setState({ language: 'de' }));

const COMPANY = sampleCompany();
const ACCOUNT_ID = COMPANY.bank.defaultAccountId;
const Q4 = { year: 2026, kind: 'quarter', index: 4 } as const;
const Q3 = { year: 2026, kind: 'quarter', index: 3 } as const;

const irish = makeContact(sampleContact({ name: 'Apps Ireland Ltd', address: { street: 'Main Street 1', postalCode: 'D01', city: 'Dublin', country: 'IE' }, vatId: 'IE6388047V' }));
// 1,362.50 € net (12.5 h at 85 € and 300 €), no VAT: a reverse charge to Ireland, performed in October 2026
const issuedService = (number = 'RE-2026-0001', customer = irish): InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> } => ({
  ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ taxTreatment: 'reverseCharge' }), null),
  issued: sampleIssued(number, { snapshot: { company: sampleProfile(), customer, account: sampleAccount() } }),
});
const docs = (...list: DocumentFile[]): Map<DocumentId, DocumentFile> => new Map(list.map((d) => [d.id, d]));
const none = new Map<string, never>();

describe('buildZm', () => {
  it('worked example: the services of the quarter per VAT ID, from the snapshot of the issued invoice', () => {
    const view = buildZm(COMPANY, docs(issuedService()), none, none, Q4);
    expect(view?.zm.lines).toMatchObject([{ country: 'IE', vatId: 'IE6388047V', kind: 'service', base: 136_250, problem: null }]);
    expect(view?.zm.dueDate).toBe('2027-01-25');
  });

  it('checks the total against Kz 21 of the advance return of the same quarter', () => {
    expect(buildZm(COMPANY, docs(issuedService()), none, none, Q4)?.check).toEqual({ zm: 136_250, ustva: 136_250, difference: 0, consistent: true });
  });

  it('a draft, a deleted invoice and an invoice issued by a small business are left out', () => {
    const draft = makeInvoice(irish.id, ACCOUNT_ID, sampleInvoice({ taxTreatment: 'reverseCharge' }), null);
    const deleted: InvoiceFile = { ...issuedService('RE-2026-0002'), deletedAt: '2026-11-01T10:00:00.000Z' };
    const smallProfile = sampleProfile({ tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } } });
    const small: InvoiceFile = { ...issuedService('RE-2026-0003'), issued: sampleIssued('RE-2026-0003', { snapshot: { company: smallProfile, customer: irish, account: sampleAccount() } }) };
    expect(buildZm(COMPANY, docs(draft, deleted, small), none, none, Q4)?.zm.lines).toEqual([]);
  });

  it('an issued cancellation is negative on its own date', () => {
    const original = issuedService();
    const cancellation: InvoiceFile = { ...makeCancellation(original, '2027-01-05', brandId<'DocumentId'>('11111111-1111-4111-8111-111111111111')), issued: sampleIssued('RE-2027-0001', { snapshot: original.issued.snapshot }) };
    const view = buildZm(COMPANY, docs(original, cancellation), none, none, { year: 2027, kind: 'quarter', index: 1 });
    expect(view?.zm.lines.map((l) => l.base)).toEqual([-136_250]);
  });

  it('a recipient without a usable VAT ID is a problem named by the invoice number', () => {
    const noId = makeContact(sampleContact({ address: { street: 'Main Street 1', postalCode: 'D01', city: 'Dublin', country: 'IE' }, vatId: '' }));
    const view = buildZm(COMPANY, docs(issuedService('RE-2026-0009', noId)), none, none, Q4);
    expect(view?.zm.problems).toEqual([{ invoiceId: expect.any(String), number: 'RE-2026-0009', vatId: '', code: 'vatIdMissing' }]);
  });

  it('cash basis: Kz 21 of the advance return follows the payment, so the check shows the difference to the report', () => {
    const cash = sampleCompany({ tax: { ...sampleProfile().tax, vat: { kind: 'regular', method: 'cash', period: 'quarterly', permanentExtension: false } } });
    const original = issuedService();
    const unpaid = buildZm(cash, docs(original), none, none, Q4);
    expect(unpaid?.zm.total.service).toBe(136_250);
    expect(unpaid?.check).toEqual({ zm: 136_250, ustva: 0, difference: 136_250, consistent: false });
    expect(unpaid?.method).toBe('cash');
    const paid = makePayment(original.id, { date: '2026-11-03', amount: cents(136_250), accountId: ACCOUNT_ID, note: '' });
    expect(buildZm(cash, docs(original), new Map([[paid.id, paid]]), none, Q4)?.check?.consistent).toBe(true);
  });

  it('a month: the services appear in the last month of the quarter, and only there is there a check', () => {
    const december = buildZm(COMPANY, docs(issuedService()), none, none, { year: 2026, kind: 'month', index: 12 });
    expect(december?.zm.total.service).toBe(136_250);
    expect(december?.check?.consistent).toBe(true);
    const november = buildZm(COMPANY, docs(issuedService()), none, none, { year: 2026, kind: 'month', index: 11 });
    expect(november?.zm.lines).toEqual([]);
    expect(november?.check).toBeNull();
  });

  it('is null for a small business company and without a company (§ 18a Abs. 4 UStG)', () => {
    const small = sampleCompany({ tax: { ...sampleProfile().tax, vat: { kind: 'smallBusiness' } } });
    expect(buildZm(small, docs(), none, none, Q3)).toBeNull();
    expect(buildZm(null, docs(), none, none, Q3)).toBeNull();
  });
});

describe('copy values and CSV', () => {
  const view = buildZm(COMPANY, docs(issuedService()), none, none, Q4);
  const line = view?.zm.lines[0];

  it('country, the number of the VAT ID without the country, and the amount in whole euros (1,362.50 € is 1363)', () => {
    expect(line).toBeDefined();
    if (!line) return;
    expect(zmCopyValue('country', line)).toBe('IE');
    expect(zmCopyValue('idNumber', line)).toBe('6388047V');
    expect(zmCopyValue('amount', line)).toBe('1363');
  });

  it('the CSV table has one row per line, the amount in whole euros and exact', () => {
    if (!view) throw new Error('no view');
    const table = zmTable(view.zm);
    expect(table.header).toEqual(['Land', 'USt-IdNr.', 'Art', 'Betrag (volle Euro)', 'Betrag (genau)']);
    expect(table.rows).toEqual([['IE', 'IE6388047V', 'Sonstige Leistung', { number: '1363' }, { number: '1362,50' }]]);
  });
});
