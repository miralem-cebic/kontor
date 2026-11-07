import { beforeEach, describe, expect, it } from 'vitest';
import { buildReports } from '../../src/app/reports';
import { buildSearchEntries } from '../../src/app/search';
import { makeCancellation, makeContact, makeExpense, makeInvoice, makeItem, makePayment, makePayout, makeQuote } from '../../src/data/schema';
import type { ContactId, DocumentId } from '../../src/data/ids';
import type { ContactFile, DocumentFile, InvoiceFile } from '../../src/data/types';
import { cancellationOf } from '../../src/data/types';
import { invoiceTotals } from '../../src/domain/invoice';
import { basisPoints, cents } from '../../src/domain/money';
import { netShareOf } from '../../src/domain/overview';
import { searchEntries, type SearchEntry } from '../../src/domain/search';
import { usePrefs } from '../../src/store/prefs';
import { sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued, sampleItem, samplePayout, sampleQuote } from './fixtures';

beforeEach(() => usePrefs.setState({ language: 'de' }));

const NOW = new Date(2026, 10, 7);
const COMPANY = { ...sampleCompany(), tax: { ...sampleCompany().tax, vat: { kind: 'regular' as const, method: 'cash' as const, period: 'quarterly' as const, permanentExtension: false } } };
const ACCOUNT_ID = COMPANY.bank.defaultAccountId;

const customer: ContactFile = makeContact(sampleContact({ name: 'Kunde GmbH', customerNumber: 'K-1001' }));
const other: ContactFile = makeContact(sampleContact({ name: 'Zweite AG', customerNumber: 'K-1002', address: null }));
const contacts = new Map<ContactId, ContactFile>([customer, other].map((c) => [c.id, c]));

const issue = (c: ContactFile, number: string, date: string, over: Partial<InvoiceFile> = {}): InvoiceFile => ({
  ...makeInvoice(c.id, ACCOUNT_ID, sampleInvoice({ date }), null),
  issued: sampleIssued(number, { snapshot: { ...sampleIssued().snapshot, company: COMPANY, customer: { ...sampleContact(), name: c.name } } }),
  ...over,
});

const docs = (...list: DocumentFile[]): Map<DocumentId, DocumentFile> => new Map(list.map((d) => [d.id, d]));
const payment = (invoice: InvoiceFile, date: string, amount: number) => makePayment(invoice.id, { date, amount: cents(amount), accountId: ACCOUNT_ID, note: '' });
const toMap = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

describe('buildReports', () => {
  it('has nothing without a company', () => {
    expect(buildReports(null, contacts, docs(), new Map(), new Map(), new Map(), 2026, NOW)).toBeNull();
  });

  it('adds up the income per customer with their names, and agrees with the totals', () => {
    const a = issue(customer, 'RE-2026-0001', '2026-03-10');
    const b = issue(other, 'RE-2026-0002', '2026-04-10');
    const totals = invoiceTotals(a, false);
    const payments = toMap([payment(a, '2026-04-02', totals.gross), payment(b, '2026-05-02', 10_000)]);
    const view = buildReports(COMPANY, contacts, docs(a, b), payments, new Map(), new Map(), 2026, NOW)!;
    const share = netShareOf(cents(10_000), totals.net, totals.gross);
    expect(view.turnover.rows.map((r) => [r.name, r.total])).toEqual([
      ['Kunde GmbH', totals.net],
      ['Zweite AG', share],
    ]);
    expect(view.turnover.rows.find((r) => r.name === 'Kunde GmbH')?.months[3]).toBe(totals.net);
    expect(view.turnover.rows.find((r) => r.name === 'Zweite AG')?.months[4]).toBe(share);
    expect(view.turnover.total).toBe(totals.net + share);
  });

  it('names a customer from the snapshot of the invoice when the contact is gone', () => {
    const a = issue(customer, 'RE-2026-0001', '2026-03-10');
    const payments = toMap([payment(a, '2026-04-02', 1_000)]);
    const view = buildReports(COMPANY, new Map(), docs(a), payments, new Map(), new Map(), 2026, NOW)!;
    expect(view.turnover.rows[0]?.name).toBe('Kunde GmbH');
  });

  it('leaves out deleted payments, deleted expenses and deleted invoices', () => {
    const a = issue(customer, 'RE-2026-0001', '2026-03-10');
    const deletedInvoice = issue(customer, 'RE-2026-0002', '2026-03-11', { deletedAt: '2026-03-12T10:00:00.000Z' });
    const gone = { ...payment(a, '2026-04-02', 5_000), deletedAt: '2026-04-03T10:00:00.000Z' };
    const kept = payment(a, '2026-04-04', 1_190);
    const deletedExpense = { ...makeExpense(sampleExpense({ date: '2026-04-05' })), deletedAt: '2026-04-06T10:00:00.000Z' };
    const view = buildReports(COMPANY, contacts, docs(a, deletedInvoice), toMap([gone, kept]), toMap([deletedExpense]), new Map(), 2026, NOW)!;
    expect(view.turnover.rows).toHaveLength(1);
    expect(view.expenses.rows).toEqual([]);
    expect(view.open.items.map((i) => i.number)).toEqual(['RE-2026-0001']);
  });

  it('groups expenses by category; an expense without a category has an empty name', () => {
    const expenses = toMap([
      makeExpense(sampleExpense({ category: 'Telefon', gross: cents(11_900) })),
      makeExpense(sampleExpense({ category: '', gross: cents(2_000), vatRate: basisPoints(0), taxTreatment: 'noVat' })),
    ]);
    const view = buildReports(COMPANY, contacts, docs(), new Map(), expenses, new Map(), 2026, NOW)!;
    expect(view.expenses.rows.map((r) => [r.name, r.total])).toEqual([
      ['Telefon', 10_000],
      ['', 2_000],
    ]);
  });

  it('lists the open items with the customer name, and leaves out a cancelled invoice and its cancellation', () => {
    const a = issue(customer, 'RE-2026-0001', '2026-03-10');
    const b = issue(other, 'RE-2026-0002', '2026-10-30');
    const cancelled = issue(customer, 'RE-2026-0003', '2026-03-11');
    const cancellation = { ...makeCancellation(cancelled as InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> }, '2026-03-20', 's-1' as DocumentId), issued: sampleIssued('RE-2026-0004') };
    const all = [a, b, cancelled, cancellation];
    expect(cancellationOf(all, cancelled.id)).toBe(cancellation);
    const view = buildReports(COMPANY, contacts, docs(...all), new Map(), new Map(), new Map(), 2026, NOW)!;
    expect(view.open.items.map((i) => [i.number, i.customerName])).toEqual([
      ['RE-2026-0001', 'Kunde GmbH'],
      ['RE-2026-0002', 'Zweite AG'],
    ]);
    expect(view.open.items[0]?.daysOverdue).toBeGreaterThan(200);
    expect(view.open.items[1]?.daysOverdue).toBe(0);
    expect(view.open.customers.map((c) => c.name)).toEqual(expect.arrayContaining(['Kunde GmbH', 'Zweite AG']));
  });

  it('an issued invoice counts with the VAT status it was issued with, not with the status of the company today', () => {
    const smallSnapshot = { ...COMPANY, tax: { ...COMPANY.tax, vat: { kind: 'smallBusiness' as const } } };
    const a = issue(customer, 'RE-2026-0001', '2026-03-10', { issued: sampleIssued('RE-2026-0001', { snapshot: { ...sampleIssued().snapshot, company: smallSnapshot } }) });
    const view = buildReports(COMPANY, contacts, docs(a), toMap([payment(a, '2026-04-02', 10_000)]), new Map(), new Map(), 2026, NOW)!;
    // without VAT the whole amount is income
    expect(view.turnover.total).toBe(10_000);
  });

  it('offers the years of the records and the current year, and compares with the year before', () => {
    const a = issue(customer, 'RE-2025-0001', '2025-03-10');
    const view = buildReports(COMPANY, contacts, docs(a), toMap([payment(a, '2025-04-02', 1_190)]), toMap([makeExpense(sampleExpense({ date: '2024-02-02' }))]), new Map(), 2025, NOW)!;
    expect(view.years).toEqual([2026, 2025, 2024]);
    expect(view.comparison.year).toBe(2025);
    expect(view.comparison.previousYear).toBe(2024);
    const t25 = invoiceTotals(a, false);
    expect(view.comparison.current.income).toBe(netShareOf(cents(1_190), t25.net, t25.gross));
    expect(view.comparison.previous.expenses).toBeGreaterThan(0);
  });
});

describe('buildReports with payouts', () => {
  const payer: ContactFile = makeContact(sampleContact({ name: 'Apple Distribution International', customerNumber: 'K-2001' }));
  const payerContacts = new Map<ContactId, ContactFile>([...contacts, [payer.id, payer]]);
  const payout = (over = {}) => makePayout(samplePayout(ACCOUNT_ID, payer.id, over));

  it('puts the payouts under the name of their payer, next to the customers', () => {
    const a = issue(customer, 'RE-2026-0001', '2026-03-10');
    const view = buildReports(COMPANY, payerContacts, docs(a), toMap([payment(a, '2026-04-02', 11_900)]), new Map(), toMap([payout()]), 2026, NOW)!;
    const totals = invoiceTotals(a, false);
    const fromInvoice = netShareOf(cents(11_900), totals.net, totals.gross);
    expect(view.turnover.rows.map((r) => [r.name, r.total])).toEqual([
      ['Apple Distribution International', 123_456],
      ['Kunde GmbH', fromInvoice],
    ]);
    expect(view.turnover.total).toBe(123_456 + fromInvoice);
    expect(view.comparison.current.income).toBe(123_456 + fromInvoice);
  });

  it('leaves out a deleted payout, and counts a domestic payout without its VAT', () => {
    const deleted = { ...payout(), deletedAt: '2026-11-04T10:00:00.000Z' };
    const domestic = payout({ taxTreatment: 'domesticTaxed', vatRate: basisPoints(1_900), amount: cents(11_900) });
    const view = buildReports(COMPANY, payerContacts, docs(), new Map(), new Map(), toMap([deleted, domestic]), 2026, NOW)!;
    expect(view.turnover.total).toBe(10_000);
  });

  it('offers the year of a payout in the year selector', () => {
    const view = buildReports(COMPANY, payerContacts, docs(), new Map(), new Map(), toMap([payout({ date: '2024-05-05' })]), 2026, NOW)!;
    expect(view.years).toEqual([2026, 2024]);
  });
});

describe('buildSearchEntries', () => {
  const invoice = issue(customer, 'RE-2026-0001', '2026-03-10', { subject: 'Website-Relaunch' });
  const draft = { ...makeInvoice(other.id, ACCOUNT_ID, sampleInvoice({ subject: 'Wartungsvertrag' }), null) };
  const quote: DocumentFile = { ...makeQuote(customer.id, sampleQuote({ subject: 'Angebot Shop' })), issued: sampleIssued('AN-2026-0001') };
  const item = makeItem(sampleItem({ name: 'Webdesign', number: 'L-100' }));
  const expense = makeExpense(sampleExpense({ supplier: 'Telekom', reference: 'T-4711', category: 'Telefon', note: 'Mobilfunk' }));
  // built after the language was set: a draft is called "Entwurf"
  let entries: SearchEntry[] = [];
  beforeEach(() => {
    entries = buildSearchEntries(contacts, toMap([item]), docs(invoice, draft, quote), toMap([expense]));
  });
  const find = (q: string) => searchEntries(entries, q).hits.map((h) => `${h.kind}:${h.title}`);

  it('finds an invoice by its number, and a draft by its subject', () => {
    expect(find('RE-2026-0001')).toEqual(['invoice:RE-2026-0001']);
    expect(find('wartung')).toEqual(['invoice:Entwurf']);
  });

  it('finds a quote by its number or subject, a contact by its city or number, an item by its number, an expense by its note', () => {
    expect(find('AN-2026-0001')).toEqual(['quote:AN-2026-0001']);
    expect(find('shop')).toEqual(['quote:AN-2026-0001']);
    expect(find('K-1002')).toEqual(['contact:Zweite AG']);
    expect(find('berlin')).toEqual(['contact:Kunde GmbH']);
    expect(find('L-100')).toEqual(['item:Webdesign']);
    expect(find('mobilfunk')).toEqual(['expense:Telekom']);
    expect(find('T-4711')).toEqual(['expense:Telekom']);
  });

  it('finds an invoice by its customer', () => {
    expect(find('Zweite')).toEqual(['invoice:Entwurf', 'contact:Zweite AG']);
  });

  it('leaves out what was deleted', () => {
    const gone = { ...makeContact(sampleContact({ name: 'Geloescht GmbH' })), deletedAt: '2026-01-01T00:00:00.000Z' };
    const goneExpense = { ...makeExpense(sampleExpense({ supplier: 'Geloescht Bank' })), deletedAt: '2026-01-01T00:00:00.000Z' };
    const goneDoc = { ...issue(customer, 'RE-2026-0009', '2026-03-10'), deletedAt: '2026-01-01T00:00:00.000Z' };
    const goneItem = { ...makeItem(sampleItem({ name: 'Geloescht Artikel' })), deletedAt: '2026-01-01T00:00:00.000Z' };
    const all = buildSearchEntries(toMap([gone]), toMap([goneItem]), docs(goneDoc), toMap([goneExpense]));
    expect(searchEntries(all, 'geloescht').total).toBe(0);
    expect(searchEntries(all, 'RE-2026-0009').total).toBe(0);
  });
});
