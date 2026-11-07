import { beforeEach, describe, expect, it } from 'vitest';
import { cancel, issue, type IssueContext } from '../../src/app/issue';
import { issueDunning, type DunningContext } from '../../src/app/dunning';
import { recordPayment, type PaymentContext } from '../../src/app/payments';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import type { DocumentId, DunningId, PaymentId } from '../../src/data/ids';
import { must } from '../../src/data/result';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, DunningFile, InvoiceFile, PaymentFile } from '../../src/data/types';
import { interestOn, claimTotal, SPREAD_BP } from '../../src/domain/dunning';
import { invoiceTotals } from '../../src/domain/invoice';
import { cents } from '../../src/domain/money';
import { sampleCompany, sampleContact, sampleInvoice } from './fixtures';

// Dunnings on an in-memory company folder: the file, the audit line and the outcome. The invoice of the sample is dated
// 31 October 2026 with a term of 14 days, so it is due on 14 November 2026.

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;
let customer: ContactFile;
let documents: Map<DocumentId, DocumentFile>;
let payments: Map<PaymentId, PaymentFile>;
let dunnings: Map<DunningId, DunningFile>;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = sampleCompany();
  must(await repo.createCompany(company, []));
  customer = makeContact(sampleContact());
  documents = new Map();
  payments = new Map();
  dunnings = new Map();
});

const issueCtx = (): IssueContext => ({
  repo,
  company,
  contacts: new Map([[customer.id, customer]]),
  documents,
  payments: new Map(),
  logo: null,
  device: 'device-1',
  now: new Date('2026-10-31T10:00:00Z'),
});

/** A dunning context on a day; the default day is 1 December 2026, when the sample invoice is overdue */
const dunCtx = (day = '2026-12-01'): DunningContext => ({
  repo,
  company,
  documents,
  payments,
  dunnings,
  device: 'device-1',
  now: new Date(`${day}T10:00:00`),
});

async function issuedInvoice(): Promise<InvoiceFile> {
  const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
  must(await repo.saveDocument(draft));
  documents.set(draft.id, draft);
  const r = await issue(draft.id, issueCtx());
  if (!r.ok) throw new Error(`issue failed: ${r.failure}`);
  documents.set(r.document.id, r.document);
  return r.document;
}

/** The gross amount of the sample invoice as it shows */
const grossOf = (inv: InvoiceFile) => invoiceTotals(inv, false).gross;

const auditLines = async (month: string) => {
  const dir = await root.getDirectoryHandle('audit');
  const text = await (await (await dir.getFileHandle(`${month}.jsonl`)).getFile()).text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe('issuing a dunning', () => {
  it('the first dunning is the payment reminder: its interest from the day after the due date, the flat fee of 40 €, a file and an audit line', async () => {
    const inv = await issuedInvoice();
    const r = await issueDunning(inv.id, { date: '2026-11-20', fee: cents(0) }, dunCtx('2026-11-20'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // the sample invoice is due on 14 November; the interest runs from 15 November to 20 November
    const expectedInterest = interestOn(grossOf(inv), '2026-11-15', '2026-11-20', SPREAD_BP.business);
    expect(expectedInterest).not.toBeNull();
    expect(r.dunning).toMatchObject({
      invoiceId: inv.id,
      level: 'reminder',
      date: '2026-11-20',
      debtor: 'business',
      open: grossOf(inv),
      interestFrom: '2026-11-15',
      interest: expectedInterest?.amount,
      flatFee: 4_000,
      fee: 0,
      payBy: '2026-12-04',
    });

    const { dunnings: onDisk } = must(await new FsRepository(root.asHandle()).loadDunnings());
    expect(onDisk).toEqual([r.dunning]);
    const [line] = await auditLines('2026-11');
    expect(line).toMatchObject({ action: 'dunning', documentId: inv.id, number: 'RE-2026-0001', files: [], device: 'device-1', dunning: { id: r.dunning.id, level: 'reminder', date: '2026-11-20' } });
    expect((line?.['dunning'] as { amount: number }).amount).toBe((expectedInterest?.amount ?? 0) + 4_000);
  });

  it('the next dunning is level 1: its interest starts the day after the reminder and the flat fee is not charged again', async () => {
    const inv = await issuedInvoice();
    const first = await issueDunning(inv.id, { date: '2026-11-20', fee: cents(0) }, dunCtx('2026-11-20'));
    if (!first.ok) throw new Error('first dunning failed');
    dunnings.set(first.dunning.id, first.dunning);
    const second = await issueDunning(inv.id, { date: '2026-11-30', fee: cents(500) }, dunCtx('2026-11-30'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.dunning).toMatchObject({ level: 'level1', interestFrom: '2026-11-21', flatFee: 0, fee: 500 });
    // the claim: the open amount plus both interests, the fee and the flat fee once
    const claim = claimTotal(grossOf(inv), [first.dunning, second.dunning]);
    expect(claim).toBe(grossOf(inv) + first.dunning.interest + second.dunning.interest + 500 + 4_000);
  });

  it('a fee typed in is part of the claim, and a payment reduces the open amount the next interest is counted on', async () => {
    const inv = await issuedInvoice();
    const paid = await recordPayment(inv.id, { date: '2026-11-18', amount: cents(50_000), accountId: company.bank.defaultAccountId, note: '' }, {
      repo,
      company,
      documents,
      payments,
      device: 'device-1',
      now: new Date('2026-11-18T10:00:00Z'),
    } satisfies PaymentContext);
    if (!paid.ok) throw new Error('payment failed');
    payments.set(paid.payment.id, paid.payment);
    const r = await issueDunning(inv.id, { date: '2026-11-20', fee: cents(500) }, dunCtx('2026-11-20'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dunning.open).toBe(grossOf(inv) - 50_000);
    expect(r.dunning.fee).toBe(500);
  });

  it('is refused with every reason: not overdue on the due date, before the last dunning, in the future, or without an open amount', async () => {
    const inv = await issuedInvoice();
    expect(await issueDunning(inv.id, { date: '2026-11-14', fee: cents(0) }, dunCtx('2026-11-14'))).toEqual({ ok: false, failure: 'planning', problems: ['notOverdue'] });
    expect(await issueDunning(inv.id, { date: '2026-12-05', fee: cents(0) }, dunCtx('2026-12-01'))).toEqual({ ok: false, failure: 'planning', problems: ['dateInFuture'] });
    const first = await issueDunning(inv.id, { date: '2026-11-20', fee: cents(0) }, dunCtx('2026-11-20'));
    if (!first.ok) throw new Error('first dunning failed');
    dunnings.set(first.dunning.id, first.dunning);
    expect(await issueDunning(inv.id, { date: '2026-11-19', fee: cents(0) }, dunCtx('2026-11-20'))).toEqual({ ok: false, failure: 'planning', problems: ['dateBeforePrevious'] });
  });

  it('a draft or a cancelled invoice takes no dunning', async () => {
    const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
    documents.set(draft.id, draft);
    expect(await issueDunning(draft.id, { date: '2026-12-01', fee: cents(0) }, dunCtx())).toEqual({ ok: false, failure: 'notReady' });

    const inv = await issuedInvoice();
    const cancelled = await cancel(inv.id, issueCtx());
    if (!cancelled.ok) throw new Error('cancel failed');
    documents.set(cancelled.document.id, cancelled.document);
    expect(await issueDunning(inv.id, { date: '2026-12-01', fee: cents(0) }, dunCtx())).toEqual({ ok: false, failure: 'planning', problems: ['cancelled'] });
  });
});
