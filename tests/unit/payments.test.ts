import { beforeEach, describe, expect, it } from 'vitest';
import { cancel, issue, type IssueContext } from '../../src/app/issue';
import { recordPayment, removePayment, type PaymentContext } from '../../src/app/payments';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { brandId, type DocumentId, type PaymentId } from '../../src/data/ids';
import { must } from '../../src/data/result';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, InvoiceFile, PaymentFile } from '../../src/data/types';
import { cents } from '../../src/domain/money';
import { invoiceTotals } from '../../src/domain/invoice';
import type { PaymentContent } from '../../src/domain/payment';
import { sampleCompany, sampleContact, sampleInvoice } from './fixtures';

// Recording and removing payments on an in-memory company folder: the payment file, the audit line and the outcome
// the form gets. The store is not involved; its state is kept here as the store would keep it.

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;
let customer: ContactFile;
let documents: Map<DocumentId, DocumentFile>;
let payments: Map<PaymentId, PaymentFile>;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = sampleCompany();
  must(await repo.createCompany(company, []));
  customer = makeContact(sampleContact());
  documents = new Map();
  payments = new Map();
});

const issueCtx = (over: Partial<IssueContext> = {}): IssueContext => ({
  repo,
  company,
  contacts: new Map([[customer.id, customer]]),
  documents,
  logo: null,
  device: 'device-1',
  now: new Date('2026-10-31T10:00:00Z'),
  ...over,
});

const payCtx = (over: Partial<PaymentContext> = {}): PaymentContext => ({
  repo,
  company,
  documents,
  payments,
  device: 'device-1',
  now: new Date('2026-11-02T09:00:00Z'),
  ...over,
});

/** A saved draft of the sample invoice, issued; the result is kept in the documents, as the store does */
async function issuedInvoice(over: Parameters<typeof sampleInvoice>[0] = {}): Promise<InvoiceFile> {
  const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(over), null);
  must(await repo.saveDocument(draft));
  documents.set(draft.id, draft);
  const r = await issue(draft.id, issueCtx());
  if (!r.ok) throw new Error(`issue failed: ${r.failure}`);
  documents.set(r.document.id, r.document);
  return r.document;
}

/** The gross amount of an issued invoice as the invoice shows it */
const grossOf = (inv: InvoiceFile) => invoiceTotals(inv, false).gross;

const content = (over: Partial<PaymentContent> = {}): PaymentContent => ({
  date: '2026-11-02',
  amount: cents(1_000),
  accountId: company.bank.defaultAccountId,
  note: '',
  ...over,
});

/** Records a payment and keeps it in the payments, as the store does; fails the test when the recording is refused */
async function record(inv: InvoiceFile, over: Partial<PaymentContent> = {}): Promise<PaymentFile> {
  const r = await recordPayment(inv.id, content(over), payCtx());
  if (!r.ok) throw new Error(`record failed: ${r.failure}`);
  payments.set(r.payment.id, r.payment);
  return r.payment;
}

/** The lines of the audit log of November 2026 */
const auditLines = async () => {
  const dir = await root.getDirectoryHandle('audit');
  const text = await (await (await dir.getFileHandle('2026-11.jsonl')).getFile()).text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe('recording a payment', () => {
  it('writes the payment to payments/ and appends a recordPayment entry to the audit log', async () => {
    const inv = await issuedInvoice();
    const r = await recordPayment(inv.id, content({ amount: cents(5_000), note: 'Anzahlung' }), payCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.auditWritten).toBe(true);
    expect(r.payment).toMatchObject({ invoiceId: inv.id, date: '2026-11-02', amount: 5_000, accountId: company.bank.defaultAccountId, note: 'Anzahlung', deletedAt: null });

    const { payments: onDisk } = must(await new FsRepository(root.asHandle()).loadPayments());
    expect(onDisk).toEqual([r.payment]);
    const [line] = await auditLines();
    expect(line).toEqual({
      at: '2026-11-02T09:00:00.000Z',
      action: 'recordPayment',
      documentId: inv.id,
      number: 'RE-2026-0001',
      files: [],
      device: 'device-1',
      payment: { id: r.payment.id, date: '2026-11-02', amount: 5_000 },
    });
  });

  it('partial payments add up: a payment above the open amount is refused', async () => {
    const inv = await issuedInvoice();
    const gross = grossOf(inv);
    await record(inv, { amount: cents(gross - 1_000) });
    expect(await recordPayment(inv.id, content({ amount: cents(1_001) }), payCtx({ payments }))).toEqual({ ok: false, failure: 'tooHigh' });
    expect(await recordPayment(inv.id, content({ amount: cents(1_000) }), payCtx({ payments }))).toMatchObject({ ok: true });
  });

  it('a payment counts for its own invoice only', async () => {
    const first = await issuedInvoice();
    const second = await issuedInvoice({ subject: 'Zweite Rechnung' });
    await record(first, { amount: grossOf(first) });
    expect(await recordPayment(second.id, content({ amount: grossOf(second) }), payCtx({ payments }))).toMatchObject({ ok: true });
  });

  it('a draft takes no payment', async () => {
    const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
    documents.set(draft.id, draft);
    expect(await recordPayment(draft.id, content(), payCtx())).toEqual({ ok: false, failure: 'notReady' });
  });

  it('a cancelled invoice and a cancellation take no payment', async () => {
    const inv = await issuedInvoice();
    const cancelled = await cancel(inv.id, issueCtx());
    if (!cancelled.ok) throw new Error('cancel failed');
    documents.set(cancelled.document.id, cancelled.document);
    expect(await recordPayment(inv.id, content(), payCtx())).toEqual({ ok: false, failure: 'notReady' });
    expect(await recordPayment(cancelled.document.id, content(), payCtx())).toEqual({ ok: false, failure: 'notReady' });
  });

  it('a payment is more than 0', async () => {
    const inv = await issuedInvoice();
    expect(await recordPayment(inv.id, content({ amount: cents(0) }), payCtx())).toEqual({ ok: false, failure: 'notPositive' });
  });

  it('the account must be an account of the company', async () => {
    const inv = await issuedInvoice();
    expect(await recordPayment(inv.id, content({ accountId: 'unknown' }), payCtx())).toEqual({ ok: false, failure: 'notReady' });
  });
});

describe('removing a payment', () => {
  it('soft-deletes it, reopens the open amount and appends a deletePayment entry', async () => {
    const inv = await issuedInvoice();
    const payment = await record(inv, { amount: cents(5_000) });

    const removed = await removePayment(payment.id, payCtx({ payments, now: new Date('2026-11-03T08:00:00Z') }));
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.payment.deletedAt).toBe('2026-11-03T08:00:00.000Z');

    const { payments: onDisk } = must(await new FsRepository(root.asHandle()).loadPayments());
    expect(onDisk.find((p) => p.id === payment.id)?.deletedAt).toBe('2026-11-03T08:00:00.000Z');
    const last = (await auditLines()).at(-1);
    expect(last).toMatchObject({ action: 'deletePayment', documentId: inv.id, number: 'RE-2026-0001', payment: { id: payment.id, amount: 5_000 } });
  });

  it('a removed payment is no payment: the full amount can be paid again', async () => {
    const inv = await issuedInvoice();
    const payment = await record(inv, { amount: grossOf(inv) });
    const removed = await removePayment(payment.id, payCtx({ payments }));
    if (!removed.ok) throw new Error('remove failed');
    payments.set(removed.payment.id, removed.payment);
    expect(await recordPayment(inv.id, content({ amount: grossOf(inv) }), payCtx({ payments }))).toMatchObject({ ok: true });
  });

  it('a payment is removed once; a second attempt finds nothing', async () => {
    const inv = await issuedInvoice();
    const payment = await record(inv);
    payments.set(payment.id, { ...payment, deletedAt: '2026-11-03T08:00:00.000Z' });
    expect(await removePayment(payment.id, payCtx({ payments }))).toEqual({ ok: false, failure: 'gone' });
  });

  it('an unknown payment is not found', async () => {
    expect(await removePayment(brandId<'PaymentId'>('11111111-1111-4111-8111-111111111111'), payCtx())).toEqual({ ok: false, failure: 'gone' });
  });
});
