import { beforeEach, describe, expect, it } from 'vitest';
import { decideQuote, removeQuoteDecision, type QuoteStatusContext } from '../../src/app/quoteStatus';
import { issueQuote, type IssueContext } from '../../src/app/issue';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import type { DocumentId, QuoteStatusId } from '../../src/data/ids';
import { must } from '../../src/data/result';
import { makeContact, makeQuote } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, QuoteFile, QuoteStatusFile } from '../../src/data/types';
import { sampleCompany, sampleContact, sampleQuote } from './fixtures';

// The customer's decisions on a finalized quote (F21), written as files of their own and logged in the audit log.

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;
let customer: ContactFile;
let documents: Map<DocumentId, DocumentFile>;
let quoteStatuses: Map<QuoteStatusId, QuoteStatusFile>;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = sampleCompany();
  must(await repo.createCompany(company, []));
  customer = makeContact(sampleContact());
  documents = new Map();
  quoteStatuses = new Map();
});

const issueCtx = (): IssueContext => ({
  repo,
  company,
  contacts: new Map([[customer.id, customer]]),
  documents,
  logo: null,
  device: 'device-1',
  now: new Date('2026-10-31T10:00:00Z'),
});

/** A decision context on a day: the customer decides on the day of the context */
const statusCtx = (day = '2026-11-02'): QuoteStatusContext => ({
  repo,
  documents,
  quoteStatuses,
  device: 'device-1',
  now: new Date(`${day}T10:00:00`),
});

/** A quote of the sample, finalized on 31 October 2026 */
async function finalizedQuote(): Promise<QuoteFile> {
  const quote = makeQuote(customer.id, sampleQuote({ date: '2026-10-31' }));
  must(await repo.saveDocument(quote));
  documents.set(quote.id, quote);
  const r = await issueQuote(quote.id, issueCtx());
  if (!r.ok) throw new Error(`finalize failed: ${r.failure}`);
  documents.set(r.document.id, r.document);
  return r.document;
}

const auditLines = async (month: string) => {
  const dir = await root.getDirectoryHandle('audit');
  const text = await (await (await dir.getFileHandle(`${month}.jsonl`)).getFile()).text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe('deciding on a finalized quote', () => {
  it('is written as a file of its own, and the audit log says what was decided and when', async () => {
    const quote = await finalizedQuote();
    const r = await decideQuote(quote.id, { decision: 'accepted', date: '2026-11-02' }, statusCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toMatchObject({ quoteId: quote.id, decision: 'accepted', date: '2026-11-02', deletedAt: null });
    expect(must(await repo.loadQuoteStatuses()).quoteStatuses).toEqual([r.status]);
    const [line] = (await auditLines('2026-11')).filter((l) => l['action'] === 'quoteDecision');
    expect(line).toMatchObject({ action: 'quoteDecision', documentId: quote.id, number: quote.issued?.number, quoteStatus: { id: r.status.id, decision: 'accepted', date: '2026-11-02' } });
  });

  it('a second decision is refused while one counts; once the first is removed, a new one is taken', async () => {
    const quote = await finalizedQuote();
    const first = await decideQuote(quote.id, { decision: 'accepted', date: '2026-11-02' }, statusCtx());
    if (!first.ok) throw new Error('first decision failed');
    quoteStatuses.set(first.status.id, first.status); // the store keeps what was written; the context sees it the same way
    expect(await decideQuote(quote.id, { decision: 'declined', date: '2026-11-02' }, statusCtx())).toEqual({ ok: false, failure: 'planning', problems: ['alreadyDecided'] });

    const removed = await removeQuoteDecision(first.status.id, statusCtx());
    expect(removed.ok).toBe(true);
    if (removed.ok) quoteStatuses.set(removed.status.id, removed.status);
    const onDisk = must(await repo.loadQuoteStatuses()).quoteStatuses.find((s) => s.id === first.status.id);
    expect(onDisk?.deletedAt).toEqual(expect.any(String));
    const audit = (await auditLines('2026-11')).map((l) => l['action']);
    expect(audit).toContain('deleteQuoteDecision');

    const again = await decideQuote(quote.id, { decision: 'declined', date: '2026-11-02' }, statusCtx());
    expect(again.ok && again.status.decision).toBe('declined');
  });

  it('a draft takes no decision: it is not sent yet', async () => {
    const quote = makeQuote(customer.id, sampleQuote());
    documents.set(quote.id, quote);
    expect(await decideQuote(quote.id, { decision: 'accepted', date: '2026-11-02' }, statusCtx())).toEqual({ ok: false, failure: 'planning', problems: ['notFinalized'] });
  });

  it('a quote that a later version replaced takes no decision: the customer decides on the version that counts', async () => {
    const first = await finalizedQuote();
    const version = makeQuote(customer.id, sampleQuote({ date: '2026-10-31' }), { id: first.id, number: first.issued?.number ?? '', date: first.date, firstNumber: first.issued?.number ?? '', version: 2 });
    documents.set(version.id, version);
    must(await repo.saveDocument(version));
    const finalized = await issueQuote(version.id, issueCtx());
    if (!finalized.ok) throw new Error('version failed');
    documents.set(finalized.document.id, finalized.document);
    expect(await decideQuote(first.id, { decision: 'accepted', date: '2026-11-02' }, statusCtx())).toEqual({ ok: false, failure: 'planning', problems: ['replaced'] });
  });

  it('the date is not before the quote and not in the future', async () => {
    const quote = await finalizedQuote();
    expect(await decideQuote(quote.id, { decision: 'accepted', date: '2026-10-30' }, statusCtx())).toEqual({ ok: false, failure: 'planning', problems: ['dateBeforeQuote'] });
    expect(await decideQuote(quote.id, { decision: 'accepted', date: '2026-11-05' }, statusCtx())).toEqual({ ok: false, failure: 'planning', problems: ['dateInFuture'] });
  });
});
