import { beforeEach, describe, expect, it } from 'vitest';
import { cancel, issue, issueQuote, type IssueContext } from '../../src/app/issue';
import { issueDunning, type DunningContext } from '../../src/app/dunning';
import { mailDefaults, mailFile, recordSend, type SendContext, type SendSource } from '../../src/app/sending';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import type { DocumentId, DunningId } from '../../src/data/ids';
import { must } from '../../src/data/result';
import { makeContact, makeInvoice, makeQuote } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, DunningFile, InvoiceFile } from '../../src/data/types';
import { claimTotal } from '../../src/domain/dunning';
import { invoiceTotals } from '../../src/domain/invoice';
import { cents, formatCents } from '../../src/domain/money';
import { sampleCompany, sampleContact, sampleInvoice, sampleQuote } from './fixtures';

// Sending a document by e-mail (F04) on an in-memory company folder: the mail file with the stored PDF, the letter of a
// dunning, the refusals, the text of the draft and the log line. kontor never sends a mail; these tests read what it prepares.

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;
let customer: ContactFile;
let documents: Map<DocumentId, DocumentFile>;
let dunnings: Map<DunningId, DunningFile>;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = sampleCompany();
  must(await repo.createCompany(company, []));
  customer = makeContact(sampleContact({ contact: { email: 'einkauf@kunde.example', phone: '' } }));
  documents = new Map();
  dunnings = new Map();
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

const sendCtx = (day = '2026-11-02'): SendContext => ({
  repo,
  company,
  documents,
  dunnings,
  logo: null,
  device: 'device-1',
  now: new Date(`${day}T09:00:00Z`),
});

const dunCtx = (day: string) =>
  ({
    repo,
    company,
    documents,
    payments: new Map(),
    dunnings,
    device: 'device-1',
    now: new Date(`${day}T10:00:00`),
  }) satisfies DunningContext;

/** An invoice of the sample, issued on 31 October 2026 */
async function issuedInvoice(): Promise<InvoiceFile> {
  const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
  must(await repo.saveDocument(draft));
  documents.set(draft.id, draft);
  const r = await issue(draft.id, issueCtx());
  if (!r.ok) throw new Error(`issue failed: ${r.failure}`);
  documents.set(r.document.id, r.document);
  return r.document as InvoiceFile;
}

/** A dunning of an issued invoice on a day; it is also kept in the test's map of dunnings */
async function issuedDunning(inv: InvoiceFile, date: string): Promise<DunningFile> {
  const r = await issueDunning(inv.id, { date, fee: cents(0) }, dunCtx(date));
  if (!r.ok) throw new Error(`dunning failed: ${JSON.stringify(r)}`);
  dunnings.set(r.dunning.id, r.dunning);
  return r.dunning;
}

const sourceInvoice = (id: DocumentId): SendSource => ({ kind: 'invoice', documentId: id });

/** The PDF written at issue time, read back from the folder */
async function storedPdf(file: string): Promise<Uint8Array> {
  const dir = await (await root.getDirectoryHandle('documents')).getDirectoryHandle('issued');
  return new Uint8Array(await (await (await dir.getFileHandle(file)).getFile()).arrayBuffer());
}

/** The mail file as text, with the CRLF line ends read as LF */
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');

describe('the mail of an issued invoice', () => {
  it('is a draft .eml file with the issued PDF attached, named after the invoice', async () => {
    const inv = await issuedInvoice();
    const draft = mailDefaults(sourceInvoice(inv.id), sendCtx());
    const r = await mailFile(sourceInvoice(inv.id), draft, sendCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fileName).toBe('Rechnung_RE-2026-0001_Kunde-GmbH.eml');
    const body = text(r.bytes);
    expect(body.startsWith('X-Unsent: 1\n')).toBe(true);
    expect(body).toContain('To: einkauf@kunde.example\n');
    // the attachment is the very file written at issue time: its base64 is in the mail, line breaks aside
    const stored = Buffer.from(await storedPdf('RE-2026-0001.pdf')).toString('base64');
    expect(body.replace(/\n/g, '')).toContain(stored);
    expect(r.files).toEqual([{ file: 'RE-2026-0001.pdf', sha256: inv.issued?.pdf.sha256 }]);
  });

  it('is refused for a draft: a draft is not a document that went out', async () => {
    const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
    documents.set(draft.id, draft);
    const r = await mailFile(sourceInvoice(draft.id), { to: 'einkauf@kunde.example', subject: 'Rechnung', body: 'Text' }, sendCtx());
    expect(r).toEqual({ ok: false, failure: 'notReady' });
  });

  it('is refused when the stored PDF no longer matches its SHA-256: a changed file is not sent', async () => {
    const inv = await issuedInvoice();
    const dir = await (await root.getDirectoryHandle('documents')).getDirectoryHandle('issued');
    const writable = await (await dir.getFileHandle('RE-2026-0001.pdf')).createWritable();
    await writable.write(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00]));
    await writable.close();
    const r = await mailFile(sourceInvoice(inv.id), { to: 'einkauf@kunde.example', subject: 'Rechnung', body: 'Text' }, sendCtx());
    expect(r).toEqual({ ok: false, failure: 'changed' });
  });

  it('is refused with the fields that are wrong, and no file is made', async () => {
    const inv = await issuedInvoice();
    const r = await mailFile(sourceInvoice(inv.id), { to: 'kein-mail', subject: '', body: 'Text' }, sendCtx());
    expect(r).toEqual({
      ok: false,
      failure: 'fields',
      problems: [
        { field: 'to', problem: 'email' },
        { field: 'subject', problem: 'required' },
      ],
    });
  });
});

describe('the draft text', () => {
  it('fills the invoice number, its date, the amount and the due date into the template', async () => {
    const inv = await issuedInvoice();
    const draft = mailDefaults(sourceInvoice(inv.id), sendCtx());
    const gross = formatCents(invoiceTotals(inv, false).gross, 'de');
    expect(draft.to).toBe('einkauf@kunde.example');
    expect(draft.subject).toBe('Rechnung RE-2026-0001');
    expect(draft.body).toContain(`anbei erhalten Sie unsere Rechnung RE-2026-0001 vom 31.10.2026 über ${gross}.`);
    expect(draft.body).toContain('bis zum 14.11.2026 fällig');
    expect(draft.body).toContain('Muster Design');
    expect(draft.body).not.toMatch(/\{[^}]*\}/);
  });

  it('a dunning letter says its level, the claim and the date to pay by', async () => {
    const inv = await issuedInvoice();
    const first = await issuedDunning(inv, '2026-11-20');
    const source: SendSource = { kind: 'dunning', documentId: inv.id, dunningId: first.id };
    const draft = mailDefaults(source, sendCtx('2026-11-20'));
    expect(draft.subject).toBe('Zahlungserinnerung zu Rechnung RE-2026-0001');
    expect(draft.body).toContain(`von ${formatCents(claimTotal(first.open, [first]), 'de')} offen`);
    expect(draft.body).toContain('bis zum 04.12.2026');
  });
});

describe('the mail of a dunning', () => {
  it('attaches the letter made from the record, named after its level', async () => {
    const inv = await issuedInvoice();
    const first = await issuedDunning(inv, '2026-11-20');
    const source: SendSource = { kind: 'dunning', documentId: inv.id, dunningId: first.id };
    const mail = await mailFile(source, mailDefaults(source, sendCtx('2026-11-20')), sendCtx('2026-11-20'));
    expect(mail.ok).toBe(true);
    if (!mail.ok) return;
    expect(mail.fileName).toBe('Zahlungserinnerung_RE-2026-0001_Kunde-GmbH.eml');
    expect(text(mail.bytes)).toContain('Content-Type: application/pdf; name="Zahlungserinnerung_RE-2026-0001_Kunde-GmbH.pdf"');
    // the letter is a PDF: the base64 of its first bytes "%PDF-" is in the mail
    expect(text(mail.bytes).replace(/\n/g, '')).toContain(Buffer.from('%PDF-').toString('base64').slice(0, 6));
    // a letter is not a file of the folder, so the log names no stored file
    expect(mail.files).toEqual([]);
  });

  it('is refused once the invoice is cancelled: a letter about a cancelled invoice is not sent', async () => {
    const inv = await issuedInvoice();
    const first = await issuedDunning(inv, '2026-11-20');
    const cancelled = await cancel(inv.id, issueCtx());
    if (!cancelled.ok) throw new Error('cancel failed');
    documents.set(cancelled.document.id, cancelled.document);
    const source: SendSource = { kind: 'dunning', documentId: inv.id, dunningId: first.id };
    expect(await mailFile(source, { to: 'einkauf@kunde.example', subject: 'Mahnung', body: 'Text' }, sendCtx('2026-11-20'))).toEqual({ ok: false, failure: 'cancelled' });
  });
});

describe('the mail of a finalized quote', () => {
  it('attaches the stored quote PDF, named after the quote', async () => {
    const quote = makeQuote(customer.id, sampleQuote());
    documents.set(quote.id, quote);
    must(await repo.saveDocument(quote));
    const finalized = await issueQuote(quote.id, issueCtx());
    if (!finalized.ok) throw new Error(`finalize failed: ${finalized.failure}`);
    documents.set(finalized.document.id, finalized.document);
    const source: SendSource = { kind: 'quote', documentId: quote.id };
    const mail = await mailFile(source, { to: 'einkauf@kunde.example', subject: 'Angebot', body: 'Text' }, sendCtx());
    expect(mail.ok).toBe(true);
    if (!mail.ok) return;
    expect(mail.fileName).toBe('Angebot_AN-2026-0001_Kunde-GmbH.eml');
    expect(mail.files).toEqual([{ file: 'AN-2026-0001.pdf', sha256: finalized.document.issued?.pdf.sha256 }]);
  });
});

describe('the log line of a mail', () => {
  it('says what was prepared, the channel, the recipient and the file it attached', async () => {
    const inv = await issuedInvoice();
    const draft = { to: 'einkauf@kunde.example', subject: 'Rechnung', body: 'Text' };
    const logged = await recordSend(sourceInvoice(inv.id), draft, 'eml', inv.issued ? [inv.issued.pdf] : [], sendCtx());
    expect(logged).toBe(true);
    const dir = await root.getDirectoryHandle('audit');
    const lines = (await (await (await dir.getFileHandle('2026-11.jsonl')).getFile()).text()).trim().split('\n');
    expect(JSON.parse(lines[lines.length - 1] ?? '{}')).toMatchObject({
      action: 'send',
      documentId: inv.id,
      number: 'RE-2026-0001',
      at: '2026-11-02T09:00:00.000Z',
      device: 'device-1',
      files: [{ file: 'RE-2026-0001.pdf', sha256: inv.issued?.pdf.sha256 }],
      send: { kind: 'invoice', channel: 'eml', to: 'einkauf@kunde.example', dunningId: null },
    });
  });
});
