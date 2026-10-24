import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { cancel, issue, type IssueContext } from '../../src/app/issue';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { cancellationId, type DocumentId } from '../../src/data/ids';
import { err, must } from '../../src/data/result';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, InvoiceFile } from '../../src/data/types';
import { invoiceTotals } from '../../src/domain/invoice';
import { sha256Hex } from '../../src/lib/sha256';
import { sampleCompany, sampleContact, sampleInvoice } from './fixtures';

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;
let customer: ContactFile;
let documents: Map<string, DocumentFile>;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = sampleCompany();
  must(await repo.createCompany(company, []));
  customer = makeContact(sampleContact());
  documents = new Map();
});

const ctx = (over: Partial<IssueContext> = {}): IssueContext => ({
  repo,
  company,
  contacts: new Map([[customer.id, customer]]),
  documents,
  logo: null,
  device: 'device-1',
  now: new Date('2026-10-31T10:00:00Z'),
  ...over,
});

/** A saved draft in the folder and in the documents of the context */
async function draft(over: Parameters<typeof sampleInvoice>[0] = {}): Promise<InvoiceFile> {
  const inv = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(over), null);
  must(await repo.saveDocument(inv));
  documents.set(inv.id, inv);
  return inv;
}

/** Issues and keeps the result in the documents, as the store does */
async function issueOk(id: DocumentId, over: Partial<IssueContext> = {}): Promise<InvoiceFile> {
  const r = await issue(id, ctx(over));
  if (!r.ok) throw new Error(`issue failed: ${r.failure}`);
  documents.set(r.invoice.id, r.invoice);
  return r.invoice;
}

const text = async (dir: MemDir, name: string) => (await (await dir.getFileHandle(name)).getFile()).text();

describe('issue', () => {
  it('gives the first number, writes the PDF once with its hash, the range file and the audit entry', async () => {
    const inv = await draft();
    const issued = await issueOk(inv.id);
    expect(issued.issued).toMatchObject({ number: 'RE-2026-0001', counter: 1, counterKey: '2026', issuedAt: '2026-10-31T10:00:00.000Z', pdf: { file: 'RE-2026-0001.pdf' } });
    expect(issued.issued?.snapshot.customer.name).toBe('Kunde GmbH');
    expect(issued.issued?.snapshot.account).toEqual({ kind: 'bank', name: 'Geschäftskonto', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' });

    // the PDF in documents/issued/ matches its hash; it is the invoice with its number, without the draft mark
    const bytes = must(await repo.readIssuedFile('RE-2026-0001.pdf'));
    expect(await sha256Hex(bytes.slice())).toBe(issued.issued?.pdf.sha256);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getTitle()).toBe('Rechnung – RE-2026-0001 – Kunde GmbH – 31.10.2026');

    // the record in the folder is issued
    const [onDisk] = must(await new FsRepository(root.asHandle()).loadDocuments()).documents;
    expect(onDisk).toEqual(issued);

    const range = must(await repo.readNumbering('invoice'));
    expect(range?.counters).toEqual([{ key: '2026', last: 1 }]);
    expect(range?.reservations).toEqual([{ number: 'RE-2026-0001', counterKey: '2026', counter: 1, documentId: inv.id, device: 'device-1', at: '2026-10-31T10:00:00.000Z' }]);
    const audit = JSON.parse((await text(await root.getDirectoryHandle('audit'), '2026-10.jsonl')).trim()) as Record<string, unknown>;
    expect(audit).toEqual({ at: '2026-10-31T10:00:00.000Z', action: 'issue', documentId: inv.id, number: 'RE-2026-0001', files: [{ file: 'RE-2026-0001.pdf', sha256: issued.issued?.pdf.sha256 }], device: 'device-1' });
  });

  it('numbers follow each other and start again every year, by the invoice date', async () => {
    const a = await issueOk((await draft()).id);
    const b = await issueOk((await draft()).id);
    const c = await issueOk((await draft({ date: '2027-01-04' })).id);
    const d = await issueOk((await draft({ date: '2026-12-30' })).id);
    expect([a, b, c, d].map((i) => i.issued?.number)).toEqual(['RE-2026-0001', 'RE-2026-0002', 'RE-2027-0001', 'RE-2026-0003']);
  });

  it('without a year in the pattern the counter runs on across years', async () => {
    company = sampleCompany({ invoiceDefaults: { numberPattern: 'R{NNN}', paymentTermDays: 14, footer: '' } });
    const a = await issueOk((await draft({ date: '2026-12-30' })).id);
    const b = await issueOk((await draft({ date: '2027-01-04' })).id);
    expect([a.issued?.number, b.issued?.number]).toEqual(['R001', 'R002']);
  });

  it('a range file that fell behind does not lead to a number given twice', async () => {
    await issueOk((await draft()).id);
    await issueOk((await draft()).id);
    // the range file is replaced by an old copy (for example by a sync client): it knows only the first number
    const range = must(await repo.readNumbering('invoice'));
    must(await repo.writeNumbering({ ...range!, counters: [{ key: '2026', last: 1 }], reservations: range!.reservations.slice(0, 1) }));
    const third = await issueOk((await draft()).id);
    expect(third.issued?.number).toBe('RE-2026-0003');
  });

  it('stops when the next number exists as a file already, and writes nothing', async () => {
    must(await repo.writeIssuedFile('RE-2026-0001.pdf', new Uint8Array([1, 2, 3])));
    const inv = await draft();
    expect(await issue(inv.id, ctx())).toEqual({ ok: false, failure: 'numberTaken' });
    expect(must(await repo.readNumbering('invoice'))).toBeNull();
  });

  it('refuses a draft that is not complete', async () => {
    const inv = await draft({ lines: [] });
    expect(await issue(inv.id, ctx())).toEqual({ ok: false, failure: 'notReady' });
    expect(must(await repo.readNumbering('invoice'))).toBeNull();
    expect(must(await repo.listIssuedFiles())).toEqual([]);
  });

  it('a second attempt after a failure in the middle goes on with the same number and file', async () => {
    const inv = await draft();
    const save = repo.saveDocument.bind(repo);
    repo.saveDocument = async () => err({ kind: 'permission', cause: new Error('denied') });
    expect(await issue(inv.id, ctx())).toEqual({ ok: false, failure: 'permission' });
    const firstFile = must(await repo.readIssuedFile('RE-2026-0001.pdf'));
    repo.saveDocument = save;
    const issued = await issueOk(inv.id, { now: new Date('2026-10-31T10:05:00Z') });
    expect(issued.issued?.number).toBe('RE-2026-0001');
    expect(issued.issued?.pdf.sha256).toBe(await sha256Hex(firstFile.slice()));
    expect(must(await repo.listIssuedFiles())).toEqual(['RE-2026-0001.pdf']);
    // the next invoice gets the next number
    expect((await issueOk((await draft()).id)).issued?.number).toBe('RE-2026-0002');
  });

  it('an issued invoice is returned as it is', async () => {
    const issued = await issueOk((await draft()).id);
    expect(await issue(issued.id, ctx())).toEqual({ ok: true, invoice: issued, auditWritten: true });
    expect(must(await repo.listIssuedFiles())).toHaveLength(1);
  });

  it('notices when the reservation does not hold after reading it back', async () => {
    const inv = await draft();
    const write = repo.writeNumbering.bind(repo);
    // another device's file wins the race: our reservation is not in what is read back
    repo.writeNumbering = async (file) => write({ ...file, reservations: file.reservations.map((r) => ({ ...r, documentId: 'other' as DocumentId })) });
    expect(await issue(inv.id, ctx())).toEqual({ ok: false, failure: 'conflict' });
    expect(must(await repo.listIssuedFiles())).toEqual([]);
  });
});

describe('cancel', () => {
  const later = { now: new Date('2026-11-05T09:00:00Z') };

  /** Cancels and keeps the result in the documents, as the store does */
  async function cancelOk(id: DocumentId, over: Partial<IssueContext> = later): Promise<InvoiceFile> {
    const r = await cancel(id, ctx(over));
    if (!r.ok) throw new Error(`cancel failed: ${r.failure}`);
    documents.set(r.invoice.id, r.invoice);
    return r.invoice;
  }

  it('issues the cancellation with the next number, the opposite amounts, its PDF and an audit entry', async () => {
    const original = await issueOk((await draft()).id);
    const c = await cancelOk(original.id);
    expect(c.id).not.toBe(original.id);
    expect(c.cancels).toEqual({ id: original.id, number: 'RE-2026-0001', date: '2026-10-31' });
    expect(c).toMatchObject({ date: '2026-11-05', service: original.service, customerId: original.customerId, quoteId: null });
    expect(c.issued).toMatchObject({ number: 'RE-2026-0002', counter: 2, counterKey: '2026', pdf: { file: 'RE-2026-0002.pdf' } });
    expect(c.issued?.snapshot).toEqual(original.issued?.snapshot);
    expect(invoiceTotals(c, false).gross).toBe(-invoiceTotals(original, false).gross);

    const bytes = must(await repo.readIssuedFile('RE-2026-0002.pdf'));
    expect(await sha256Hex(bytes.slice())).toBe(c.issued?.pdf.sha256);
    expect((await PDFDocument.load(bytes, { updateMetadata: false })).getTitle()).toBe('Stornorechnung – RE-2026-0002 – Kunde GmbH – 05.11.2026');

    // in the folder: the invoice as it was, and its cancellation
    const onDisk = must(await new FsRepository(root.asHandle()).loadDocuments()).documents;
    expect(onDisk.find((d) => d.id === original.id)).toEqual(original);
    expect(onDisk.find((d) => d.id === c.id)).toEqual(c);
    const lines = (await text(await root.getDirectoryHandle('audit'), '2026-11.jsonl')).trim().split('\n');
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      at: '2026-11-05T09:00:00.000Z',
      action: 'cancel',
      documentId: c.id,
      number: 'RE-2026-0002',
      files: [{ file: 'RE-2026-0002.pdf', sha256: c.issued?.pdf.sha256 }],
      device: 'device-1',
      cancels: { documentId: original.id, number: 'RE-2026-0001' },
    });
    // the next invoice goes on in the same range
    expect((await issueOk((await draft()).id, later)).issued?.number).toBe('RE-2026-0003');
  });

  it('keeps the master data of the invoice, also when the customer and the account changed since', async () => {
    const original = await issueOk((await draft()).id);
    customer = { ...customer, name: 'Neuer Name AG', deletedAt: '2026-11-01T00:00:00.000Z' };
    company = { ...company, bank: { ...company.bank, accounts: company.bank.accounts.map((a) => ({ ...a, deletedAt: '2026-11-01T00:00:00.000Z' })) } };
    const c = await cancelOk(original.id);
    expect(c.issued?.snapshot.customer.name).toBe('Kunde GmbH');
    expect(c.issued?.snapshot.account).toEqual(original.issued?.snapshot.account);
  });

  it('the ID of a cancellation is a UUID that follows from the invoice', async () => {
    const a = await cancellationId('0f8fad5b-d9cb-469f-a165-70867728950e' as DocumentId);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await cancellationId('0f8fad5b-d9cb-469f-a165-70867728950e' as DocumentId)).toBe(a);
    expect(await cancellationId('7c9e6679-7425-40de-944b-e07fc1f90ae7' as DocumentId)).not.toBe(a);
  });

  it('is numbered in the year of the cancellation', async () => {
    const original = await issueOk((await draft({ date: '2026-12-30' })).id);
    const c = await cancelOk(original.id, { now: new Date('2027-01-04T09:00:00Z') });
    expect(c.issued?.number).toBe('RE-2027-0001');
  });

  it('an invoice is cancelled once: a second call returns its cancellation', async () => {
    const original = await issueOk((await draft()).id);
    const c = await cancelOk(original.id);
    expect(await cancel(original.id, ctx(later))).toEqual({ ok: true, invoice: c, auditWritten: true });
    expect(must(await repo.listIssuedFiles())).toEqual(['RE-2026-0001.pdf', 'RE-2026-0002.pdf']);
  });

  it('refuses a draft, a cancellation and an unknown invoice', async () => {
    const d = await draft();
    const c = await cancelOk((await issueOk((await draft()).id)).id);
    for (const id of [d.id, c.id, 'nope' as DocumentId]) expect(await cancel(id, ctx(later))).toEqual({ ok: false, failure: 'notReady' });
    expect(must(await repo.listIssuedFiles())).toHaveLength(2);
  });

  it('a second attempt after a failure in the middle goes on with the same number and file', async () => {
    const original = await issueOk((await draft()).id);
    const save = repo.saveDocument.bind(repo);
    repo.saveDocument = async () => err({ kind: 'permission', cause: new Error('denied') });
    expect(await cancel(original.id, ctx(later))).toEqual({ ok: false, failure: 'permission' });
    repo.saveDocument = save;
    const c = await cancelOk(original.id, { now: new Date('2026-11-05T09:10:00Z') });
    expect(c.issued?.number).toBe('RE-2026-0002');
    expect(must(await repo.listIssuedFiles())).toEqual(['RE-2026-0001.pdf', 'RE-2026-0002.pdf']);
  });
});
