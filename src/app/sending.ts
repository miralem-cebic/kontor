import { toLocalDate } from '../domain/dates';
import { claimTotal } from '../domain/dunning';
import { dueDate, invoiceTotals } from '../domain/invoice';
import { mailtoHref } from '../domain/links';
import { formatCents } from '../domain/money';
import { buildEml, fillTemplate, readMailDraft, type MailDraft, type MailFieldError, type SendChannel, type SendKind } from '../domain/sending';
import type { DocumentId, DunningId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { cancellationOf, type CompanyFile, type DocumentFile, type DunningFile, type InvoiceFile } from '../data/types';
import type { IssuedInfo } from '../domain/invoice';
import { openMailLink, saveFile } from '../lib/browser';
import { DUNNING_LEVEL_KEY } from '../lib/labels';
import { sha256Hex } from '../lib/sha256';
import { fmtIn, tIn, type Lang, type MessageKey } from '../i18n';
import { makeDunningPdf, type LogoImage } from '../pdf/documentPdf';
import { useApp } from '../store/appStore';
import { issuedPdfName, logoImage } from './documentPdf';
import { dunningsOf } from './dunning';
import { deviceId } from './issue';
import { flushWrites, openRepository } from './session';

// Sending a document by e-mail (F04). kontor prepares the mail and never sends one: the mail is an .eml file with the PDF
// attached (it opens as a draft in Outlook or Thunderbird), or a mailto: link with the PDF downloaded beside it. A document
// goes out only as it was issued: its stored PDF, checked against its SHA-256. A dunning letter is made from its record and
// the snapshot of its invoice. Every mail that was prepared is a line of the audit log (`send`). The texts are templates in
// src/i18n, German like the documents for now; the form may change them, and the change is not saved.

/** What a mail is about: an issued invoice, its cancellation, a finalized quote, or a dunning of an invoice */
export type SendSource = { kind: DocumentSendKind; documentId: DocumentId } | { kind: 'dunning'; documentId: DocumentId; dunningId: DunningId };

/** What making a mail needs from the open company */
export interface SendContext {
  repo: Repository;
  company: CompanyFile;
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  dunnings: ReadonlyMap<DunningId, DunningFile>;
  /** The logo of the company, for the letter of a dunning */
  logo: LogoImage | null;
  /** The browser that prepares the mail, for the audit log */
  device: string;
  now: Date;
}

/** Why a mail is not made: the document is not issued, is cancelled, its PDF changed, the letter could not be made, or the storage failed */
export type SendFailure = 'notReady' | 'cancelled' | 'changed' | 'pdf' | StorageErrorKind;

/** The files a mail attaches, as the audit log names them: the stored PDF with its SHA-256; a letter has none */
export type AttachedFiles = { file: string; sha256: string }[];

/** A mail that is not made: `fields` when the text has problems (the form shows them), otherwise the reason of SendFailure */
export type MailFileFailure = { ok: false; failure: 'fields'; problems: MailFieldError[] } | { ok: false; failure: SendFailure };

/** The mail as a file, ready to download */
export type MailFile = { ok: true; fileName: string; bytes: Uint8Array; files: AttachedFiles };

/** A mail that was prepared: its file name, whether the audit line was written, and whether the text fitted into the link */
export type SendOutcome = { ok: true; fileName: string; auditWritten: boolean; bodyIncluded: boolean } | MailFileFailure;

/** The kinds of mail about a document; a dunning is about an invoice and its letter */
type DocumentSendKind = Exclude<SendKind, 'dunning'>;

/** The templates of each kind of mail: a subject and a text, with placeholders in braces */
const TEMPLATE: Record<SendKind, { subject: MessageKey; body: MessageKey }> = {
  invoice: { subject: 'send.tpl.invoiceSubject', body: 'send.tpl.invoiceBody' },
  cancellation: { subject: 'send.tpl.cancellationSubject', body: 'send.tpl.cancellationBody' },
  quote: { subject: 'send.tpl.quoteSubject', body: 'send.tpl.quoteBody' },
  dunning: { subject: 'send.tpl.dunningSubject', body: 'send.tpl.dunningBody' },
};

const dateText = (iso: string, lang: Lang): string => fmtIn(lang, toLocalDate(iso), 'P');

/** Does the document have the kind the source asks for? An invoice is one without a cancellation. */
function fits(kind: DocumentSendKind, doc: DocumentFile): boolean {
  switch (kind) {
    case 'quote':
      return doc.kind === 'quote';
    case 'invoice':
      return doc.kind === 'invoice' && doc.cancels === null;
    case 'cancellation':
      return doc.kind === 'invoice' && doc.cancels !== null;
  }
}

/** The issued document of a source: not deleted, issued, and of the kind the source asks for */
function issuedOf(kind: DocumentSendKind, documentId: DocumentId, documents: ReadonlyMap<DocumentId, DocumentFile>) {
  const doc = documents.get(documentId);
  if (!doc || doc.deletedAt || !doc.issued || !fits(kind, doc)) return null;
  return { ...doc, issued: doc.issued };
}

/** The issued invoice a dunning is about: not deleted, not a cancellation; null when it is not one */
function issuedInvoiceOf(documentId: DocumentId, documents: ReadonlyMap<DocumentId, DocumentFile>): (InvoiceFile & { issued: IssuedInfo }) | null {
  const doc = documents.get(documentId);
  if (!doc || doc.kind !== 'invoice' || doc.deletedAt || !doc.issued || doc.cancels) return null;
  return { ...doc, issued: doc.issued };
}

/** The dunning of a source and the dunnings of its invoice up to and including it; null when it is not there */
function letterOf(documentId: DocumentId, dunningId: DunningId, dunnings: ReadonlyMap<DunningId, DunningFile>): { dunning: DunningFile; upTo: DunningFile[] } | null {
  const dunning = dunnings.get(dunningId);
  if (!dunning || dunning.invoiceId !== documentId) return null;
  const all = dunningsOf(dunnings, documentId);
  const index = all.findIndex((d) => d.id === dunning.id);
  return index < 0 ? null : { dunning, upTo: all.slice(0, index + 1) };
}

/** The placeholders of a template with the values the document has, the address of the customer and its language */
function valuesOf(source: SendSource, state: Pick<SendContext, 'documents' | 'dunnings'>): { kind: SendKind; lang: Lang; values: Record<string, string>; to: string } | null {
  if (source.kind === 'dunning') {
    const invoice = issuedInvoiceOf(source.documentId, state.documents);
    const letter = letterOf(source.documentId, source.dunningId, state.dunnings);
    if (!invoice || !letter) return null;
    const { number, snapshot } = invoice.issued;
    const lang = snapshot.customer.language;
    return {
      kind: 'dunning',
      lang,
      to: snapshot.customer.contact.email,
      values: {
        Schreiben: tIn(lang, DUNNING_LEVEL_KEY[letter.dunning.level]),
        Rechnungsnummer: number,
        Rechnungsdatum: dateText(invoice.date, lang),
        Gesamtforderung: formatCents(claimTotal(letter.dunning.open, letter.upTo), lang),
        'Zahlbar bis': dateText(letter.dunning.payBy, lang),
        Firma: snapshot.company.name,
      },
    };
  }
  const doc = issuedOf(source.kind, source.documentId, state.documents);
  if (!doc) return null;
  const { number, snapshot } = doc.issued;
  const lang = snapshot.customer.language;
  const to = snapshot.customer.contact.email;
  const firm = snapshot.company.name;
  if (doc.kind === 'quote') {
    return { kind: 'quote', lang, to, values: { Angebotsnummer: number, Datum: dateText(doc.date, lang), 'Gültig bis': dateText(doc.validUntil, lang), Firma: firm } };
  }
  if (doc.cancels) {
    return {
      kind: 'cancellation',
      lang,
      to,
      values: { Stornonummer: number, Rechnungsnummer: doc.cancels.number, Rechnungsdatum: dateText(doc.cancels.date, lang), Firma: firm },
    };
  }
  const smallBusiness = snapshot.company.tax.vat.kind === 'smallBusiness';
  return {
    kind: 'invoice',
    lang,
    to,
    values: {
      Rechnungsnummer: number,
      Rechnungsdatum: dateText(doc.date, lang),
      Betrag: formatCents(invoiceTotals(doc, smallBusiness).gross, lang),
      Fälligkeit: dateText(dueDate(doc), lang),
      Firma: firm,
    },
  };
}

/** The recipient, subject and text a mail starts with, filled in from the document; empty when there is nothing to send */
export function mailDefaults(source: SendSource, state: Pick<SendContext, 'documents' | 'dunnings'>): MailDraft {
  const filled = valuesOf(source, state);
  if (!filled) return { to: '', subject: '', body: '' };
  const template = TEMPLATE[filled.kind];
  return {
    to: filled.to,
    subject: fillTemplate(tIn(filled.lang, template.subject), filled.values),
    body: fillTemplate(tIn(filled.lang, template.body), filled.values),
  };
}

/** The PDF a mail attaches: the stored file of an issued document, checked, or the letter of a dunning made now */
async function attachmentOf(source: SendSource, ctx: SendContext): Promise<{ ok: true; name: string; bytes: Uint8Array; files: AttachedFiles } | { ok: false; failure: SendFailure }> {
  if (source.kind === 'dunning') {
    const invoice = issuedInvoiceOf(source.documentId, ctx.documents);
    if (!invoice) return { ok: false, failure: 'notReady' };
    // a letter about an invoice that was cancelled later is not sent
    if (cancellationOf(ctx.documents.values(), invoice.id)) return { ok: false, failure: 'cancelled' };
    const letter = letterOf(source.documentId, source.dunningId, ctx.dunnings);
    if (!letter) return { ok: false, failure: 'notReady' };
    try {
      const pdf = await makeDunningPdf({ invoice, dunning: letter.dunning, dunnings: letter.upTo, lang: invoice.issued.snapshot.customer.language }, ctx.logo, ctx.now);
      return { ok: true, name: pdf.fileName, bytes: pdf.bytes, files: [] };
    } catch (e) {
      console.error('Could not make the letter', e);
      return { ok: false, failure: 'pdf' };
    }
  }

  const doc = issuedOf(source.kind, source.documentId, ctx.documents);
  if (!doc) return { ok: false, failure: 'notReady' };
  const read = await ctx.repo.readIssuedFile(doc.kind, doc.issued.pdf.file);
  if (!read.ok) return { ok: false, failure: read.error.kind };
  // a PDF that changed on disk since it was issued is not sent: the mail would not say what the document says
  if ((await sha256Hex(read.value.slice())) !== doc.issued.pdf.sha256) return { ok: false, failure: 'changed' };
  return { ok: true, name: issuedPdfName(doc, doc.issued), bytes: read.value, files: [{ file: doc.issued.pdf.file, sha256: doc.issued.pdf.sha256 }] };
}

/** A boundary between the parts of a mail: random, letters, digits and "-" only */
function newBoundary(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `kontor-${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The mail as a file (.eml) with its PDF attached; the text is checked first, then the PDF */
export async function mailFile(source: SendSource, draft: MailDraft, ctx: SendContext): Promise<MailFile | MailFileFailure> {
  const checked = readMailDraft(draft);
  if (!checked.ok) return { ok: false, failure: 'fields', problems: checked.error };
  const attached = await attachmentOf(source, ctx);
  if (!attached.ok) return attached;
  const bytes = buildEml({
    to: checked.value.to,
    subject: checked.value.subject,
    body: checked.value.body,
    attachment: { name: attached.name, type: 'application/pdf', data: attached.bytes },
    date: ctx.now,
    boundary: newBoundary(),
  });
  return { ok: true, fileName: `${attached.name.replace(/\.pdf$/, '')}.eml`, bytes, files: attached.files };
}

/** Writes the prepared mail to the audit log: what it is for, the channel, the recipient and the file attached */
export async function recordSend(source: SendSource, draft: Pick<MailDraft, 'to'>, channel: SendChannel, files: AttachedFiles, ctx: SendContext): Promise<boolean> {
  const at = ctx.now.toISOString();
  const doc = ctx.documents.get(source.documentId);
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'send',
    documentId: source.documentId,
    number: doc?.issued?.number ?? '',
    files,
    device: ctx.device,
    send: { kind: source.kind, channel, to: draft.to, dunningId: source.kind === 'dunning' ? source.dunningId : null },
  });
  return audit.ok;
}

/** The context of the open company, after the pending writes; otherwise the reason */
async function openSendContext(): Promise<SendContext | StorageErrorKind> {
  const repo = openRepository();
  const { company, documents, dunnings } = useApp.getState();
  if (!repo || !company) return 'notFound';
  if (!(await flushWrites())) return 'other';
  return { repo, company, documents, dunnings, logo: await logoImage(), device: deviceId(), now: new Date() };
}

/** Prepares the mail as an .eml file and downloads it; a mail program opens it as a draft */
export async function saveMailFile(source: SendSource, draft: MailDraft): Promise<SendOutcome> {
  const ctx = await openSendContext();
  if (typeof ctx === 'string') return { ok: false, failure: ctx };
  const made = await mailFile(source, draft, ctx);
  if (!made.ok) return made;
  saveFile(made.bytes, made.fileName, 'message/rfc822');
  const auditWritten = await recordSend(source, draft, 'eml', made.files, ctx);
  return { ok: true, fileName: made.fileName, auditWritten, bodyIncluded: true };
}

/**
 * Downloads the PDF and opens the mail program with a new mail to the customer, the subject and the text filled in. A
 * mailto: link cannot carry the PDF, so the user attaches it; a text too long for the link is copied by hand.
 */
export async function openMailProgram(source: SendSource, draft: MailDraft): Promise<SendOutcome> {
  const ctx = await openSendContext();
  if (typeof ctx === 'string') return { ok: false, failure: ctx };
  const checked = readMailDraft(draft);
  if (!checked.ok) return { ok: false, failure: 'fields', problems: checked.error };
  const attached = await attachmentOf(source, ctx);
  if (!attached.ok) return attached;
  const link = mailtoHref(checked.value.to, checked.value.subject, checked.value.body);
  if (!link) return { ok: false, failure: 'fields', problems: [{ field: 'to', problem: 'email' }] };
  saveFile(attached.bytes, attached.name, 'application/pdf');
  openMailLink(link.href);
  const auditWritten = await recordSend(source, checked.value, 'mailto', attached.files, ctx);
  return { ok: true, fileName: attached.name, auditWritten, bodyIncluded: link.bodyIncluded };
}

/** The defaults of a mail, read from the open company's store when a form opens */
export function currentMailDefaults(source: SendSource): MailDraft {
  const { documents, dunnings } = useApp.getState();
  return mailDefaults(source, { documents, dunnings });
}
