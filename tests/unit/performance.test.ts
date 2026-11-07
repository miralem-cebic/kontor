import { beforeAll, describe, expect, it } from 'vitest';
import { accountInputs } from '../../src/app/customerAccount';
import { invoicesTable } from '../../src/app/csvExport';
import { buildOverview, companyTurnoverEntries } from '../../src/app/overview';
import { buildReports } from '../../src/app/reports';
import { buildUstva } from '../../src/app/ustva';
import { buildZm } from '../../src/app/zm';
import { makeContact, makeExpense, makeInvoice, makePayment, makePayout } from '../../src/data/schema';
import { brandId, newDocumentId, type ContactId, type DocumentId, type PaymentId, type PayoutId } from '../../src/data/ids';
import type { ContactFile, DocumentFile, ExpenseFile, InvoiceFile, PaymentFile, PayoutFile } from '../../src/data/types';
import { cents } from '../../src/domain/money';
import { customerAccount } from '../../src/domain/customerAccount';
import { usePrefs } from '../../src/store/prefs';
import { sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued, samplePayout } from './fixtures';

// Regression test for #85: the overview, the reports, the UStVA, the customer account and the invoice table looked up
// "is this invoice cancelled?" and "what was paid on it?" by scanning every document and every payment once per invoice
// (O(n²)). With 20,000 invoices that took 20 s and more. The budget is generous (an accidental O(n²) misses it by a
// factor of ten or more), so the test does not flake on a slow CI machine.

const INVOICES = 20_000;
const CUSTOMERS = 50;
const BUDGET_MS = 3_000;

const company = {
  ...sampleCompany(),
  tax: { ...sampleCompany().tax, vat: { kind: 'regular' as const, method: 'cash' as const, period: 'quarterly' as const, permanentExtension: false } },
};
const ACCOUNT_ID = company.bank.defaultAccountId;

interface Data {
  contacts: Map<ContactId, ContactFile>;
  documents: Map<DocumentId, DocumentFile>;
  payments: Map<PaymentId, PaymentFile>;
  expenses: Map<string, ExpenseFile>;
  payouts: Map<PayoutId, PayoutFile>;
}

/** Issued invoices spread over ten years, one payment each, 4 % of them cancelled, as many expenses as invoices */
function dataset(): Data {
  const contacts = new Map<ContactId, ContactFile>();
  const customers = Array.from({ length: CUSTOMERS }, () => makeContact(sampleContact()));
  for (const c of customers) contacts.set(c.id, c);
  const documents = new Map<DocumentId, DocumentFile>();
  const payments = new Map<PaymentId, PaymentFile>();
  const expenses = new Map<string, ExpenseFile>();
  const payouts = new Map<PayoutId, PayoutFile>();
  const date = (i: number): string => {
    const year = 2017 + (i % 10);
    const month = 1 + (Math.floor(i / 10) % 12);
    const day = 1 + (Math.floor(i / 120) % 28);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  for (let i = 0; i < INVOICES; i++) {
    const customer = customers[i % CUSTOMERS] as ContactFile;
    const number = `RE-${i}`;
    const base = makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ date: date(i) }), null);
    const invoice: InvoiceFile = { ...base, id: newDocumentId(), issued: sampleIssued(number) };
    documents.set(invoice.id, invoice);
    const payment = makePayment(invoice.id, { date: date(i + 3), amount: cents(10_000 + (i % 7_000)), accountId: ACCOUNT_ID, note: '' });
    payments.set(payment.id, payment);
    const expense = makeExpense(sampleExpense({ date: date(i + 5) }));
    expenses.set(expense.id, expense);
    // as many platform payouts as invoices, spread over the customers
    const payout = makePayout(samplePayout(ACCOUNT_ID, customer.id, { date: date(i + 7), period: date(i + 7).slice(0, 7) }) as Parameters<typeof makePayout>[0]);
    payouts.set(payout.id, payout);
    if (i % 25 === 0) {
      // every 25th invoice is cancelled: the cancellation is an invoice of its own
      const cancellation: InvoiceFile = {
        ...invoice,
        id: brandId<'DocumentId'>(crypto.randomUUID()),
        issued: sampleIssued(`ST-${i}`),
        cancels: { id: invoice.id, number, date: invoice.date },
      };
      documents.set(cancellation.id, cancellation);
    }
  }
  return { contacts, documents, payments, expenses, payouts };
}

let data: Data;
beforeAll(() => {
  usePrefs.setState({ language: 'de' });
  data = dataset();
}, 60_000);

/** Runs `fn`, reports the time (a run with `PERF_LOG=1` prints it) and returns it */
function timed(name: string, fn: () => unknown): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  if (process.env['PERF_LOG']) console.log(`${name}: ${ms.toFixed(0)} ms`);
  return ms;
}

describe(`computations on ${INVOICES} invoices with payments stay far from quadratic (#85)`, () => {
  const now = new Date(2026, 10, 7);

  it('buildOverview (Home)', () => {
    expect(timed('buildOverview', () => buildOverview(company, data.documents, data.payments, data.expenses, data.payouts, now))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('buildReports (all four reports)', () => {
    expect(timed('buildReports', () => buildReports(company, data.contacts, data.documents, data.payments, data.expenses, data.payouts, 2024, now))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('buildUstva (one quarter)', () => {
    expect(timed('buildUstva', () => buildUstva(company, data.documents, data.payments, data.expenses, { year: 2024, kind: 'quarter', index: 3 }))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('buildZm (one quarter)', () => {
    expect(timed('buildZm', () => buildZm(company, data.documents, data.payments, data.expenses, { year: 2024, kind: 'quarter', index: 3 }))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('the turnover entries of the small business scheme (payment based)', () => {
    expect(timed('companyTurnoverEntries', () => companyTurnoverEntries(company, data.documents, data.payments))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('invoicesTable (CSV / XLSX export)', () => {
    expect(timed('invoicesTable', () => invoicesTable([...data.documents.values()], false, data.contacts))).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('the account of every customer', () => {
    const ms = timed('customerAccount x50', () => {
      for (const id of data.contacts.keys()) {
        const inputs = accountInputs(id, data.documents, data.payments, data.payouts);
        customerAccount(inputs.invoices, inputs.payments, '2026-11-07', inputs.payouts);
      }
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
