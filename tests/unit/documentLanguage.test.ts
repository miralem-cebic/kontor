import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueDunning, type DunningContext } from '../../src/app/dunning';
import { issue, type IssueContext } from '../../src/app/issue';
import { mailDefaults, mailFile, type SendContext, type SendSource } from '../../src/app/sending';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import type { DocumentId, DunningId } from '../../src/data/ids';
import { must } from '../../src/data/result';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { CompanyFile, ContactFile, DocumentFile, DunningFile, InvoiceFile } from '../../src/data/types';
import { cents } from '../../src/domain/money';
import { sampleCompany, sampleContact, sampleInvoice } from './fixtures';

// The documents of a customer are made in the customer's language (F05): the invoice is issued in English for an English
// customer, and its PDF, its e-mail and the letter of a dunning say so. A German customer keeps the German texts.

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
  customer = makeContact(sampleContact({ language: 'en', contact: { email: 'accounts@kunde.example', phone: '' } }));
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

/** An invoice of the sample to the English customer, issued on 31 October 2026 */
async function issuedInvoice(): Promise<InvoiceFile> {
  const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
  must(await repo.saveDocument(draft));
  documents.set(draft.id, draft);
  const r = await issue(draft.id, issueCtx());
  if (!r.ok) throw new Error(`issue failed: ${r.failure}`);
  documents.set(r.document.id, r.document);
  return r.document as InvoiceFile;
}

describe('an invoice for an English customer', () => {
  it('is issued in English: the customer of its snapshot is English, and its PDF says so', async () => {
    const inv = await issuedInvoice();
    expect(inv.issued?.snapshot.customer.language).toBe('en');
    const bytes = must(await repo.readIssuedFile('invoice', 'RE-2026-0001.pdf'));
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getTitle()).toMatch(/^Invoice – RE-2026-0001 – Kunde GmbH – /);
  });

  it('is mailed in English: the subject, the text and the closing', async () => {
    const inv = await issuedInvoice();
    const source: SendSource = { kind: 'invoice', documentId: inv.id };
    const draft = mailDefaults(source, sendCtx());
    expect(draft.to).toBe('accounts@kunde.example');
    expect(draft.subject).toBe('Invoice RE-2026-0001');
    expect(draft.body).toMatch(/^Dear Sir or Madam,/);
    expect(draft.body).toContain('please find attached our invoice RE-2026-0001 of ');
    expect(draft.body).toContain('Kind regards');
    expect(draft.body).not.toContain('Sehr geehrte');
  });

  it('the mail file is named in English, and it attaches the PDF that was issued', async () => {
    const inv = await issuedInvoice();
    const source: SendSource = { kind: 'invoice', documentId: inv.id };
    const mail = await mailFile(source, mailDefaults(source, sendCtx()), sendCtx());
    expect(mail.ok).toBe(true);
    if (!mail.ok) return;
    expect(mail.fileName).toBe('Invoice_RE-2026-0001_Kunde-GmbH.eml');
    expect(mail.files).toEqual([{ file: 'RE-2026-0001.pdf', sha256: inv.issued?.pdf.sha256 }]);
  });
});

describe('the letter of a dunning for an English customer', () => {
  it('is titled and mailed in English: the level of the letter is named in the subject', async () => {
    const inv = await issuedInvoice();
    const r = await issueDunning(inv.id, { date: '2026-11-20', fee: cents(0) }, {
      repo,
      company,
      documents,
      payments: new Map(),
      dunnings,
      device: 'device-1',
      now: new Date('2026-11-20T10:00:00'),
    } satisfies DunningContext);
    if (!r.ok) throw new Error(`dunning failed: ${JSON.stringify(r)}`);
    dunnings.set(r.dunning.id, r.dunning);
    const source: SendSource = { kind: 'dunning', documentId: inv.id, dunningId: r.dunning.id };
    expect(mailDefaults(source, sendCtx('2026-11-20')).subject).toBe('Payment reminder for invoice RE-2026-0001');
    const mail = await mailFile(source, mailDefaults(source, sendCtx('2026-11-20')), sendCtx('2026-11-20'));
    expect(mail.ok && mail.fileName).toBe('Payment-reminder_RE-2026-0001_Kunde-GmbH.eml');
  });
});
