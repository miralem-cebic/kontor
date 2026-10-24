import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import { invoiceTotals, issueProblems, type IssuedInfo, type IssueSnapshot } from '../domain/invoice';
import { counterKey, nextCounter, numberFor } from '../domain/numbering';
import type { DocumentId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { SCHEMA_VERSION } from '../data/schema';
import type { BankAccount, CompanyFile, ContactFile, DocumentFile, InvoiceFile, NumberingFile, Reservation } from '../data/types';
import { isValidId } from '../data/validate';
import { sha256Hex } from '../lib/sha256';
import { makeDocumentPdf, type LogoImage } from '../pdf/documentPdf';
import { putIssuedInvoice, useApp } from '../store/appStore';
import { logoImage } from './documentPdf';
import { flushWrites, openRepository } from './session';

// Issuing an invoice (ADR 0004): the number is reserved in numbering/invoice.json and read back, the PDF is written
// once to documents/issued/<number>.pdf, the invoice gets its number, the snapshot of the master data and the PDF's
// SHA-256, and an entry is appended to audit/<YYYY-MM>.jsonl. A second attempt after a failure in the middle finds its
// own reservation and file and goes on with them, so a number is never given twice and never lost to this invoice.

/** `notReady`: the draft is incomplete (issueProblems); `numberTaken`: the next number exists already, the range file fell behind */
export type IssueFailure = 'notReady' | 'numberTaken' | StorageErrorKind;

export type IssueResult = { ok: true; invoice: InvoiceFile; auditWritten: boolean } | { ok: false; failure: IssueFailure };

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

const fail = (failure: IssueFailure): IssueResult => ({ ok: false, failure });

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

const issuedInvoices = (documents: ReadonlyMap<string, DocumentFile>): IssuedInfo[] =>
  [...documents.values()].flatMap((d) => (d.kind === 'invoice' && d.issued ? [d.issued] : []));

/**
 * The number of the invoice: its reservation from an earlier attempt, or the next number of its counter, reserved and
 * read back. Every number known (issued, reserved or as a file) is taken.
 */
async function reserve(inv: InvoiceFile, ctx: IssueContext): Promise<{ ok: true; reservation: Reservation; files: string[] } | { ok: false; failure: IssueFailure }> {
  const read = await ctx.repo.readNumbering('invoice');
  if (!read.ok) return { ok: false, failure: read.error.kind };
  const listed = await ctx.repo.listIssuedFiles();
  if (!listed.ok) return { ok: false, failure: listed.error.kind };
  const range: NumberingFile = read.value ?? { schemaVersion: SCHEMA_VERSION, range: 'invoice', counters: [], reservations: [] };
  const own = range.reservations.find((r) => r.documentId === inv.id);
  if (own) return { ok: true, reservation: own, files: listed.value };

  const pattern = ctx.company.invoiceDefaults.numberPattern;
  const key = counterKey(pattern, inv.date);
  const issued = issuedInvoices(ctx.documents);
  const counter = nextCounter([
    ...range.counters.filter((c) => c.key === key).map((c) => c.last),
    ...range.reservations.filter((r) => r.counterKey === key).map((r) => r.counter),
    ...issued.filter((i) => i.counterKey === key).map((i) => i.counter),
  ]);
  const number = numberFor(pattern, inv.date, counter);
  const taken = new Set([...issued.map((i) => i.number), ...range.reservations.map((r) => r.number), ...listed.value.map((f) => f.replace(/\.pdf$/, ''))]);
  if (taken.has(number)) return { ok: false, failure: 'numberTaken' };

  const reservation: Reservation = { number, counterKey: key, counter, documentId: inv.id, device: ctx.device, at: ctx.now.toISOString() };
  const next: NumberingFile = {
    ...range,
    counters: [...range.counters.filter((c) => c.key !== key), { key, last: counter }],
    reservations: [...range.reservations, reservation].slice(-KEEP_RESERVATIONS),
  };
  const written = await ctx.repo.writeNumbering(next);
  if (!written.ok) return { ok: false, failure: written.error.kind };
  // the reservation holds when it is in the file as read back, and no other document holds the same number
  const holders = written.value.reservations.filter((r) => r.number === number);
  if (holders.length !== 1 || holders[0]?.documentId !== inv.id) return { ok: false, failure: 'conflict' };
  return { ok: true, reservation, files: listed.value };
}

/** Issues a saved, complete draft. Calling it again for an issued invoice returns it unchanged. */
export async function issue(id: DocumentId, ctx: IssueContext): Promise<IssueResult> {
  const inv = ctx.documents.get(id);
  if (!inv || inv.kind !== 'invoice' || inv.deletedAt) return fail('notReady');
  if (inv.issued) return { ok: true, invoice: inv, auditWritten: true };
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

  const reserved = await reserve(inv, ctx);
  if (!reserved.ok) return fail(reserved.failure);
  const { number, counter, counterKey: key } = reserved.reservation;
  const snapshot: IssueSnapshot = { company: companyProfile(company), customer: contactProfile(customer), account: accountDetails(account) };

  // the PDF is written once; a file of this number from an earlier attempt of this invoice is kept
  const file = `${number}.pdf`;
  let bytes: Uint8Array;
  if (reserved.files.includes(file)) {
    const existing = await ctx.repo.readIssuedFile(file);
    if (!existing.ok) return fail(existing.error.kind);
    bytes = existing.value;
  } else {
    const pdf = await makeDocumentPdf({ company: snapshot.company, document: inv, customer: snapshot.customer, account: snapshot.account, lang: 'de', number }, ctx.logo, ctx.now);
    const written = await ctx.repo.writeIssuedFile(file, pdf.bytes);
    if (!written.ok) return fail(written.error.kind);
    bytes = pdf.bytes;
  }
  const sha256 = await sha256Hex(bytes.slice());

  const issued: IssuedInfo = { number, counter, counterKey: key, issuedAt: ctx.now.toISOString(), snapshot, pdf: { file, sha256 } };
  const saved = await ctx.repo.saveDocument({ ...inv, issued });
  if (!saved.ok) return fail(saved.error.kind);
  if (saved.value.kind !== 'invoice' || saved.value.issued?.number !== number) return fail('conflict');

  const audit = await ctx.repo.appendAudit(ctx.now.toISOString().slice(0, 7), {
    at: ctx.now.toISOString(),
    action: 'issue',
    documentId: inv.id,
    number,
    files: [{ file, sha256 }],
    device: ctx.device,
  });
  return { ok: true, invoice: saved.value, auditWritten: audit.ok };
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

/** Issues an invoice of the open company: what is pending is written first, then the invoice is issued */
export async function issueInvoice(id: DocumentId): Promise<IssueResult> {
  const repo = openRepository();
  if (!repo) return fail('notFound');
  if (!(await flushWrites())) return fail('other');
  const { company, contacts, documents } = useApp.getState();
  if (!company) return fail('notFound');
  let result: IssueResult;
  try {
    result = await issue(id, { repo, company, contacts, documents, logo: await logoImage(), device: deviceId(), now: new Date() });
  } catch (e) {
    // for example the PDF could not be made; a reservation already written is used again by the next attempt
    console.error('Could not issue the invoice', e);
    return fail('other');
  }
  if (result.ok) putIssuedInvoice(result.invoice);
  return result;
}
