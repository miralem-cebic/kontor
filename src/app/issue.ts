import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import { invoiceTotals, issueProblems, type IssuedInfo, type IssueSnapshot } from '../domain/invoice';
import { isoDateOf } from '../domain/dates';
import { counterKey, nextCounter, numberFor } from '../domain/numbering';
import { quoteProblems } from '../domain/quote';
import { replacedAlready, versionNumber } from '../domain/quoteVersions';
import { cancellationId, type DocumentId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { makeCancellation, SCHEMA_VERSION } from '../data/schema';
import {
  cancellationOf,
  isQuote,
  type AuditEntry,
  type BankAccount,
  type CompanyFile,
  type ContactFile,
  type DocumentFile,
  type InvoiceFile,
  type NumberingFile,
  type NumberRange,
  type QuoteFile,
  type Reservation,
} from '../data/types';
import { isValidId } from '../data/validate';
import { sha256Hex } from '../lib/sha256';
import { makeDocumentPdf, type LogoImage } from '../pdf/documentPdf';
import { putIssuedDocument, useApp } from '../store/appStore';
import { logoImage } from './documentPdf';
import { flushWrites, openRepository } from './session';

// Issuing an invoice (ADR 0004): the number is reserved in numbering/invoice.json and read back, the PDF is written
// once to documents/issued/<number>.pdf, the invoice gets its number, the snapshot of the master data and the PDF's
// SHA-256, and an entry is appended to audit/<YYYY-MM>.jsonl. A second attempt after a failure in the middle finds its
// own reservation and file and goes on with them, so a number is never given twice and never lost to this invoice.
// Cancelling an issued invoice issues its cancellation invoice the same way. Finalizing a quote ("Angebot
// abschließen") does the same in the quote range: numbering/quote.json and documents/quotes/<number>.pdf.

/**
 * `notReady`: the draft is incomplete (issueProblems, quoteProblems), or the invoice cannot be cancelled (not issued,
 * or a cancellation itself); `numberTaken`: the next number exists already, the range file fell behind
 */
export type IssueFailure = 'notReady' | 'numberTaken' | StorageErrorKind;

type Failed = { ok: false; failure: IssueFailure };

/** The document as written: an issued invoice or cancellation, or a finalized quote */
export type IssueResult<D extends DocumentFile = InvoiceFile> = { ok: true; document: D; auditWritten: boolean } | Failed;

export interface IssueContext {
  repo: Repository;
  company: CompanyFile;
  contacts: ReadonlyMap<string, ContactFile>;
  documents: ReadonlyMap<string, DocumentFile>;
  logo: LogoImage | null;
  /** The browser that issues, for the reservation and the audit log */
  device: string;
  now: Date;
}

/** Reservations the range file keeps; the audit log keeps every one */
const KEEP_RESERVATIONS = 50;

const fail = (failure: IssueFailure): Failed => ({ ok: false, failure });

const companyProfile = (c: CompanyFile): CompanyProfile => ({
  name: c.name,
  owner: c.owner,
  address: c.address,
  contact: c.contact,
  logo: c.logo,
  tax: c.tax,
  invoiceDefaults: c.invoiceDefaults,
});

const contactProfile = (c: ContactFile): ContactProfile => ({
  kind: c.kind,
  roles: c.roles,
  name: c.name,
  nameLine2: c.nameLine2,
  contactPerson: c.contactPerson,
  customerNumber: c.customerNumber,
  address: c.address,
  contact: c.contact,
  vatId: c.vatId,
  leitwegId: c.leitwegId,
  orderReference: c.orderReference,
  paymentTermDays: c.paymentTermDays,
  notes: c.notes,
});

function accountDetails(a: BankAccount): AccountDetails {
  switch (a.kind) {
    case 'bank':
      return { kind: 'bank', name: a.name, holder: a.holder, iban: a.iban, bic: a.bic };
    case 'paypal':
      return { kind: 'paypal', name: a.name, email: a.email };
  }
}

/** The issued documents of a range: invoices (with their cancellations) or quotes */
const issuedIn = (documents: ReadonlyMap<string, DocumentFile>, range: NumberRange): IssuedInfo[] =>
  [...documents.values()].flatMap((d) => (d.kind === range && d.issued ? [d.issued] : []));

/** The number pattern of a range, from the settings */
function patternOf(company: CompanyFile, range: NumberRange): string {
  switch (range) {
    case 'invoice':
      return company.invoiceDefaults.numberPattern;
    case 'quote':
      return company.invoiceDefaults.quotePattern;
  }
}

/** A number with the counter behind it and the counter's key */
interface Slot {
  number: string;
  counter: number;
  key: string;
}

/**
 * The number a document gets: the next counter of its key in the range of its kind; or, for a new version of a quote,
 * the first number with the version as a suffix and the counter of the first version, because a version is no new
 * quote. null when the quote a version replaces is not there as a finalized quote.
 */
function slotFor(doc: DocumentFile, ctx: IssueContext, numbering: NumberingFile, issued: readonly IssuedInfo[]): Slot | null {
  if (doc.kind === 'quote' && doc.revises) {
    const previous = ctx.documents.get(doc.revises.id);
    if (previous?.kind !== 'quote' || !previous.issued) return null;
    return { number: versionNumber(doc.revises.firstNumber, doc.revises.version), counter: previous.issued.counter, key: previous.issued.counterKey };
  }
  const pattern = patternOf(ctx.company, doc.kind);
  const key = counterKey(pattern, doc.date);
  const counter = nextCounter([
    ...numbering.counters.filter((c) => c.key === key).map((c) => c.last),
    ...numbering.reservations.filter((r) => r.counterKey === key).map((r) => r.counter),
    ...issued.filter((i) => i.counterKey === key).map((i) => i.counter),
  ]);
  return { number: numberFor(pattern, doc.date, counter), counter, key };
}

/**
 * The number of the document: its reservation from an earlier attempt, or its next number (slotFor), reserved and read
 * back. Every number known in the range (issued, reserved or as a file) is taken.
 */
async function reserve(doc: DocumentFile, ctx: IssueContext): Promise<{ ok: true; reservation: Reservation; files: string[] } | Failed> {
  const range: NumberRange = doc.kind;
  const read = await ctx.repo.readNumbering(range);
  if (!read.ok) return fail(read.error.kind);
  const listed = await ctx.repo.listIssuedFiles(range);
  if (!listed.ok) return fail(listed.error.kind);
  const numbering: NumberingFile = read.value ?? { schemaVersion: SCHEMA_VERSION, range, counters: [], reservations: [] };
  const own = numbering.reservations.find((r) => r.documentId === doc.id);
  if (own) return { ok: true, reservation: own, files: listed.value };

  const issued = issuedIn(ctx.documents, range);
  const slot = slotFor(doc, ctx, numbering, issued);
  if (!slot) return fail('notReady');
  const { number, counter, key } = slot;
  const taken = new Set([...issued.map((i) => i.number), ...numbering.reservations.map((r) => r.number), ...listed.value.map((f) => f.replace(/\.pdf$/, ''))]);
  if (taken.has(number)) return fail('numberTaken');

  const reservation: Reservation = { number, counterKey: key, counter, documentId: doc.id, device: ctx.device, at: ctx.now.toISOString() };
  const next: NumberingFile = {
    ...numbering,
    // a version keeps the counter of its first number: the highest counter stays
    counters: [...numbering.counters.filter((c) => c.key !== key), { key, last: Math.max(counter, ...numbering.counters.filter((c) => c.key === key).map((c) => c.last)) }],
    reservations: [...numbering.reservations, reservation].slice(-KEEP_RESERVATIONS),
  };
  const written = await ctx.repo.writeNumbering(next);
  if (!written.ok) return fail(written.error.kind);
  // the reservation holds when it is in the file as read back, and no other document holds the same number
  const holders = written.value.reservations.filter((r) => r.number === number);
  if (holders.length !== 1 || holders[0]?.documentId !== doc.id) return fail('conflict');
  return { ok: true, reservation, files: listed.value };
}

/** Issues a saved, complete draft. Calling it again for an issued invoice returns it unchanged. */
export async function issue(id: DocumentId, ctx: IssueContext): Promise<IssueResult> {
  const inv = ctx.documents.get(id);
  if (!inv || inv.kind !== 'invoice' || inv.deletedAt) return fail('notReady');
  if (inv.issued) return { ok: true, document: inv, auditWritten: true };
  const { company } = ctx;
  const customer = ctx.contacts.get(inv.customerId);
  const account = company.bank.accounts.find((a) => a.id === inv.accountId);
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const problems = issueProblems({
    lineCount: inv.lines.length,
    gross: invoiceTotals(inv, smallBusiness).gross,
    taxTreatment: smallBusiness ? 'standard' : inv.taxTreatment,
    customer: customer ?? null,
    ownVatId: company.tax.vatId,
    accountActive: !!account && !account.deletedAt,
  });
  if (problems.length > 0 || !customer || !account) return fail('notReady');
  return finalize(inv, { company: companyProfile(company), customer: contactProfile(customer), account: accountDetails(account) }, ctx);
}

/**
 * Cancels an issued invoice: its cancellation (cancellationContent) is issued at once with the next number of the
 * invoice range, with the master data the invoice was issued with, so that it reverses exactly what the invoice said.
 * The invoice itself does not change; it counts as cancelled because its cancellation exists. Calling it again
 * returns the cancellation issued before; an interrupted attempt is finished by the next one, as when issuing.
 */
export async function cancel(id: DocumentId, ctx: IssueContext): Promise<IssueResult> {
  const original = ctx.documents.get(id);
  if (!original || original.kind !== 'invoice' || !original.issued || original.cancels) return fail('notReady');
  const done = cancellationOf(ctx.documents.values(), original.id);
  if (done) return { ok: true, document: done, auditWritten: true };
  const cancellation = makeCancellation({ ...original, issued: original.issued }, isoDateOf(ctx.now), await cancellationId(original.id));
  return finalize(cancellation, original.issued.snapshot, ctx);
}

/**
 * Finalizes a saved quote ("Angebot abschließen"): it gets the next number of the quote range (a new version: the first
 * number with its version), a snapshot of the master data with the default account (the one its footer shows) and its
 * PDF in documents/quotes/, and stays as it is from then on. Calling it again for a finalized quote returns it unchanged.
 */
export async function issueQuote(id: DocumentId, ctx: IssueContext): Promise<IssueResult<QuoteFile>> {
  const quote = ctx.documents.get(id);
  if (!quote || quote.kind !== 'quote' || quote.deletedAt) return fail('notReady');
  if (quote.issued) return { ok: true, document: quote, auditWritten: true };
  const { company } = ctx;
  const customer = ctx.contacts.get(quote.customerId);
  const account = company.bank.accounts.find((a) => a.id === company.bank.defaultAccountId);
  const newerVersion = replacedAlready([...ctx.documents.values()].filter(isQuote), quote);
  const problems = quoteProblems({ hasCustomer: !!customer, lineCount: quote.lines.length, validUntil: quote.validUntil, newerVersion }, isoDateOf(ctx.now));
  if (problems.length > 0 || !customer || !account) return fail('notReady');
  return finalize(quote, { company: companyProfile(company), customer: contactProfile(customer), account: accountDetails(account) }, ctx);
}

/** What the audit log says about the document: issued, a cancellation, or a finalized quote */
function auditEntry(doc: DocumentFile, base: Omit<AuditEntry, 'action' | 'cancels'>): AuditEntry {
  switch (doc.kind) {
    case 'quote':
      return { ...base, action: 'issueQuote' };
    case 'invoice':
      return doc.cancels ? { ...base, action: 'cancel', cancels: { documentId: doc.cancels.id, number: doc.cancels.number } } : { ...base, action: 'issue' };
  }
}

/** Reserves the number, writes the PDF, saves the document as issued and appends the audit entry */
async function finalize<D extends DocumentFile>(doc: D, snapshot: IssueSnapshot, ctx: IssueContext): Promise<IssueResult<D>> {
  const range: NumberRange = doc.kind;
  const reserved = await reserve(doc, ctx);
  if (!reserved.ok) return reserved;
  const { number, counter, counterKey: key } = reserved.reservation;

  // the PDF is written once; a file of this number from an earlier attempt of this document is kept
  const file = `${number}.pdf`;
  let bytes: Uint8Array;
  if (reserved.files.includes(file)) {
    const existing = await ctx.repo.readIssuedFile(range, file);
    if (!existing.ok) return fail(existing.error.kind);
    bytes = existing.value;
  } else {
    const pdf = await makeDocumentPdf({ company: snapshot.company, document: doc, customer: snapshot.customer, account: snapshot.account, lang: 'de', number }, ctx.logo, ctx.now);
    const written = await ctx.repo.writeIssuedFile(range, file, pdf.bytes);
    if (!written.ok) return fail(written.error.kind);
    bytes = pdf.bytes;
  }
  const sha256 = await sha256Hex(bytes.slice());

  const issued: IssuedInfo = { number, counter, counterKey: key, issuedAt: ctx.now.toISOString(), snapshot, pdf: { file, sha256 } };
  const saved = await ctx.repo.saveDocument({ ...doc, issued });
  if (!saved.ok) return fail(saved.error.kind);
  if (saved.value.kind !== doc.kind || saved.value.issued?.number !== number) return fail('conflict');

  const at = ctx.now.toISOString();
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), auditEntry(doc, { at, documentId: doc.id, number, files: [{ file, sha256 }], device: ctx.device }));
  // the kind was checked above: the saved document is the issued `doc`
  return { ok: true, document: saved.value as D, auditWritten: audit.ok };
}

const DEVICE_KEY = 'kontor.device.v1';
let sessionDevice: string | null = null;

/** A random ID of this browser, kept in localStorage; per session when the storage is not available */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (isValidId(stored)) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return (sessionDevice ??= crypto.randomUUID());
  }
}

/** Runs `step` on the open company: what is pending is written first; the issued document goes into the store */
async function inOpenCompany<D extends DocumentFile>(step: (ctx: IssueContext) => Promise<IssueResult<D>>): Promise<IssueResult<D>> {
  const repo = openRepository();
  if (!repo) return fail('notFound');
  if (!(await flushWrites())) return fail('other');
  const { company, contacts, documents } = useApp.getState();
  if (!company) return fail('notFound');
  let result: IssueResult<D>;
  try {
    result = await step({ repo, company, contacts, documents, logo: await logoImage(), device: deviceId(), now: new Date() });
  } catch (e) {
    // for example the PDF could not be made; a reservation already written is used again by the next attempt
    console.error('Could not issue the document', e);
    return fail('other');
  }
  if (result.ok) putIssuedDocument(result.document);
  return result;
}

/** Issues an invoice draft of the open company */
export const issueInvoice = (id: DocumentId): Promise<IssueResult> => inOpenCompany((ctx) => issue(id, ctx));

/** Cancels an issued invoice of the open company; the result is its cancellation */
export const cancelInvoice = (id: DocumentId): Promise<IssueResult> => inOpenCompany((ctx) => cancel(id, ctx));

/** Finalizes a quote of the open company ("Angebot abschließen") */
export const finalizeQuote = (id: DocumentId): Promise<IssueResult<QuoteFile>> => inOpenCompany((ctx) => issueQuote(id, ctx));
