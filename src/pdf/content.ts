// What a quote or an invoice says on paper: the texts of every part of the page, formatted in the language of the
// document. Where things go on the page is decided by layout.ts; this module only decides what is written.

import { documentTotals, lineTotal, type DocumentLine, type DocumentTotals } from '../domain/document';
import { toLocalDate } from '../domain/dates';
import { formatIban } from '../domain/iban';
import { dueDate, invoiceTotals, vatNote, type IssuedInfo } from '../domain/invoice';
import { claimTotal, SPREAD_BP } from '../domain/dunning';
import { formatCents, formatQuantity, formatRate, negate, type TaxTotals } from '../domain/money';
import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import type { DocumentFile, DunningFile, InvoiceFile, QuoteFile } from '../data/types';
import { fmtIn, tIn, type Lang, type MessageKey } from '../i18n';
import { DUNNING_LEVEL_KEY, unitTextIn } from '../lib/labels';

/** The master data come as profiles: the current ones for a draft, the snapshot for an issued invoice */
export interface PdfSource {
  company: CompanyProfile;
  document: DocumentFile;
  /** The document's customer; null when the contact is gone */
  customer: ContactProfile | null;
  /** The account the invoice is paid to; for a quote the company's default account */
  account: AccountDetails | null;
  /** The language of the document */
  lang: Lang;
  /** The number of an issued invoice or a finalized quote; null for a draft, which is marked as such */
  number: string | null;
}

export interface InfoRow {
  label: string;
  value: string;
}

export interface TableRow {
  pos: string;
  name: string;
  /** Longer text below the name; empty when there is none */
  description: string;
  quantity: string;
  unit: string;
  price: string;
  /** Empty when the document charges no VAT */
  rate: string;
  total: string;
}

export interface TotalRow {
  label: string;
  value: string;
  /** The amount to pay */
  grand: boolean;
}

export interface DocumentContent {
  lang: Lang;
  /** Big text across the page that marks a draft, or null for an issued document */
  watermark: string | null;
  /** Company name at the top of the first page */
  letterhead: string;
  /** Return address above the recipient (DIN 5008) */
  senderLine: string;
  recipient: string[];
  /** Number, dates and references on the right of the first page */
  info: InfoRow[];
  /** "Rechnung", "Stornorechnung" or "Angebot"; a draft is marked as such */
  title: string;
  subject: string;
  intro: string;
  table: {
    headers: Omit<TableRow, 'description'>;
    /** False when the document charges no VAT: then there is no rate column */
    showRate: boolean;
    rows: TableRow[];
  };
  totals: TotalRow[];
  /** Paragraphs after the totals: the note on VAT, payment, the cancelled invoice, the replaced quote or validity */
  notes: string[];
  closing: string;
  footer: { text: string; columns: string[][] };
  /** Top of the following pages, for example "Rechnungsentwurf · Kunde GmbH" */
  runningHead: string;
  /** "Seite {n} von {m}" in the language of the document */
  pageLabel: string;
  meta: { title: string; author: string; subject: string; fileName: string };
}

const nonEmpty = (lines: readonly string[]): string[] => lines.filter((l) => l.trim() !== '');

/** The column headings of the line table, in the language of the document */
const tableHeaders = (lang: Lang): Omit<TableRow, 'description'> => ({
  pos: tIn(lang, 'pdf.colPos'),
  name: tIn(lang, 'pdf.colName'),
  quantity: tIn(lang, 'pdf.colQuantity'),
  unit: tIn(lang, 'pdf.colUnit'),
  price: tIn(lang, 'pdf.colPrice'),
  rate: tIn(lang, 'pdf.colRate'),
  total: tIn(lang, 'pdf.colTotal'),
});

/** The name of a country in the given language, in capitals as on international mail (DIN 5008) */
const countryLine = (country: string, lang: Lang): string => (new Intl.DisplayNames([lang], { type: 'region' }).of(country) ?? country).toLocaleUpperCase(lang);

/** The recipient's address field: name lines, contact person, street, town and, abroad, the country */
export function recipientLines(customer: ContactProfile | null, lang: Lang): string[] {
  if (!customer) return [];
  const { address } = customer;
  return nonEmpty([
    customer.name,
    customer.nameLine2,
    customer.contactPerson ? tIn(lang, 'pdf.attention', { name: customer.contactPerson }) : '',
    address?.street ?? '',
    address ? `${address.postalCode} ${address.city}` : '',
    address && address.country !== 'DE' ? countryLine(address.country, lang) : '',
  ]);
}

/** A file name for the download: letters and digits of the parts, joined by "_" */
export function pdfFileName(parts: readonly string[]): string {
  const clean = parts.map((p) => p.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)).filter(Boolean);
  return `${clean.join('_') || 'Dokument'}.pdf`;
}

const accountLines = (account: AccountDetails | null, lang: Lang): string[] => {
  if (!account) return [];
  switch (account.kind) {
    case 'bank':
      return nonEmpty([account.holder, `${tIn(lang, 'pdf.iban')} ${formatIban(account.iban)}`, account.bic ? `${tIn(lang, 'pdf.bic')} ${account.bic}` : '']);
    case 'paypal':
      return [`PayPal ${account.email}`];
  }
};

function footerColumns(company: CompanyProfile, account: AccountDetails | null, lang: Lang): string[][] {
  const { address, contact, tax } = company;
  return [
    nonEmpty([company.name, company.owner !== company.name ? company.owner : '', address.street, `${address.postalCode} ${address.city}`]),
    nonEmpty([contact.phone ? `${tIn(lang, 'pdf.phone')} ${contact.phone}` : '', contact.email]),
    nonEmpty([tax.taxNumber ? `${tIn(lang, 'pdf.taxNumber')} ${tax.taxNumber}` : '', tax.vatId ? `${tIn(lang, 'pdf.vatId')} ${tax.vatId}` : '']),
    accountLines(account, lang),
  ].filter((column) => column.length > 0);
}

const NOTE_KEY = {
  smallBusiness: 'totals.smallBusiness',
  reverseCharge: 'totals.reverseCharge',
  intraCommunitySupply: 'totals.intraCommunitySupply',
  notTaxable: 'totals.notTaxable',
} as const satisfies Record<NonNullable<ReturnType<typeof vatNote>>, MessageKey>;

/** With a discount, the lines are shown before it, then the net amount (F23) */
function totalRows(totals: DocumentTotals, withVat: boolean, lang: Lang): TotalRow[] {
  const money = (c: TaxTotals['net']) => formatCents(c, lang);
  const discount: TotalRow[] =
    totals.discount === 0
      ? []
      : [
          { label: tIn(lang, 'pdf.subtotal'), value: money(totals.subtotal), grand: false },
          { label: tIn(lang, 'pdf.discount'), value: money(negate(totals.discount)), grand: false },
        ];
  if (!withVat) return [...discount, { label: tIn(lang, 'pdf.total'), value: money(totals.gross), grand: true }];
  return [
    ...discount,
    { label: tIn(lang, 'pdf.net'), value: money(totals.net), grand: false },
    ...totals.byRate.map((r) => ({ label: tIn(lang, 'pdf.vatOn', { rate: formatRate(r.rate, lang), net: money(r.net) }), value: money(r.tax), grand: false })),
    { label: tIn(lang, 'pdf.total'), value: money(totals.gross), grand: true },
  ];
}

/** The discount of a line, printed under its description: "Rabatt 10 %" or "Rabatt 2,00 €" */
function lineDiscountText(l: DocumentLine, lang: Lang): string {
  const { discount } = l;
  if (discount.kind === 'none') return '';
  return tIn(lang, 'pdf.lineDiscount', { discount: discount.kind === 'percent' ? formatRate(discount.rate, lang) : formatCents(discount.amount, lang) });
}

/** The payment request of an invoice: amount, due date and account */
function paymentNote(inv: InvoiceFile, gross: TaxTotals['gross'], account: AccountDetails | null, number: string | null, lang: Lang): string | null {
  if (gross <= 0 || !account) return null;
  const amount = formatCents(gross, lang);
  const date = formatDate(dueDate(inv), lang);
  const now = inv.paymentTermDays === 0;
  const reference = number ? ` ${tIn(lang, 'pdf.payReference', { number })}` : '';
  switch (account.kind) {
    case 'bank':
      return tIn(lang, now ? 'pdf.payNow' : 'pdf.payBy', { amount, date }) + reference;
    case 'paypal':
      return tIn(lang, now ? 'pdf.payPaypalNow' : 'pdf.payPaypalBy', { amount, date, email: account.email }) + reference;
  }
}

const formatDate = (iso: string, lang: Lang) => fmtIn(lang, toLocalDate(iso), 'P');

/** Everything a quote or an invoice says, in the language of the document. Drafts are marked as such. */
export function documentContent(src: PdfSource): DocumentContent {
  const { company, document: doc, customer, account, lang, number } = src;
  const isInvoice = doc.kind === 'invoice';
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const note = isInvoice ? vatNote(doc.taxTreatment, smallBusiness) : smallBusiness ? 'smallBusiness' : null;
  const totals = isInvoice ? invoiceTotals(doc, smallBusiness) : documentTotals(doc.lines, smallBusiness, doc.discount);
  const cancels = isInvoice ? doc.cancels : null;
  const title = tIn(lang, cancels ? 'pdf.cancellation' : isInvoice ? (number ? 'pdf.invoice' : 'pdf.invoiceDraft') : number ? 'pdf.quote' : 'pdf.quoteDraft');
  const date = formatDate(doc.date, lang);
  const customerName = customer?.name ?? '';

  const rows: TableRow[] = doc.lines.map((l, i) => ({
    pos: String(i + 1),
    name: l.name,
    description: nonEmpty([l.description, lineDiscountText(l, lang)]).join(' · '),
    quantity: formatQuantity(l.quantity, lang),
    unit: unitTextIn(lang, l.unit),
    price: formatCents(l.unitPrice, lang),
    rate: note ? '' : formatRate(l.vatRate, lang),
    total: formatCents(lineTotal(l), lang),
  }));

  const notes: string[] = [];
  if (note) notes.push(tIn(lang, NOTE_KEY[note]));
  if (note === 'reverseCharge' || note === 'intraCommunitySupply') {
    notes.push(nonEmpty([customer?.vatId ? tIn(lang, 'pdf.customerVatId', { id: customer.vatId }) : '', company.tax.vatId ? tIn(lang, 'pdf.ownVatId', { id: company.tax.vatId }) : '']).join(' · '));
  }
  if (cancels) notes.push(tIn(lang, 'pdf.cancellationNote', { number: cancels.number, date: formatDate(cancels.date, lang) }));
  else if (isInvoice) {
    const payment = paymentNote(doc, totals.gross, account, number, lang);
    if (payment) notes.push(payment);
  } else {
    if (doc.revises) notes.push(tIn(lang, 'pdf.quoteReplaces', { number: doc.revises.number, date: formatDate(doc.revises.date, lang) }));
    notes.push(tIn(lang, 'pdf.quoteValid', { date: formatDate(doc.validUntil, lang) }));
  }

  return {
    lang,
    watermark: number ? null : tIn(lang, 'pdf.watermark'),
    letterhead: company.name,
    senderLine: [company.name, company.address.street, `${company.address.postalCode} ${company.address.city}`].join(' · '),
    recipient: recipientLines(customer, lang),
    info: isInvoice ? invoiceInfo(doc, customer, number, lang) : quoteInfo(doc, customer, number, lang),
    title,
    subject: doc.subject,
    intro: doc.introText,
    table: {
      headers: tableHeaders(lang),
      showRate: !note,
      rows,
    },
    totals: totalRows(totals, !note, lang),
    notes: nonEmpty(notes),
    closing: doc.closingText,
    footer: { text: company.invoiceDefaults.footer, columns: footerColumns(company, account, lang) },
    runningHead: nonEmpty([title, customerName]).join(' · '),
    pageLabel: tIn(lang, 'pdf.page'),
    meta: {
      title: nonEmpty([title, number ?? '', customerName, date]).join(' – '),
      author: company.name,
      subject: doc.subject || title,
      fileName: pdfFileName(number ? [title, number, customerName] : [title, doc.date, customerName]),
    },
  };
}

function quoteInfo(q: QuoteFile, customer: ContactProfile | null, number: string | null, lang: Lang): InfoRow[] {
  return [
    { label: tIn(lang, 'pdf.quoteNumber'), value: number ?? tIn(lang, 'pdf.draftNumber') },
    { label: tIn(lang, 'pdf.quoteDate'), value: formatDate(q.date, lang) },
    { label: tIn(lang, 'pdf.validUntil'), value: formatDate(q.validUntil, lang) },
    ...(customer?.customerNumber ? [{ label: tIn(lang, 'pdf.customerNumber'), value: customer.customerNumber }] : []),
  ];
}

function invoiceInfo(inv: InvoiceFile, customer: ContactProfile | null, number: string | null, lang: Lang): InfoRow[] {
  const service =
    inv.service.kind === 'date'
      ? { label: tIn(lang, 'pdf.serviceDate'), value: formatDate(inv.service.date, lang) }
      : { label: tIn(lang, 'pdf.servicePeriod'), value: `${formatDate(inv.service.start, lang)} – ${formatDate(inv.service.end, lang)}` };
  const optional = (label: MessageKey, value: string): InfoRow[] => (value ? [{ label: tIn(lang, label), value }] : []);
  // a cancellation names the invoice it cancels instead of a due date
  const reference = inv.cancels ? { label: tIn(lang, 'pdf.cancels'), value: inv.cancels.number } : { label: tIn(lang, 'pdf.dueDate'), value: formatDate(dueDate(inv), lang) };
  return [
    { label: tIn(lang, 'pdf.invoiceNumber'), value: number ?? tIn(lang, 'pdf.draftNumber') },
    { label: tIn(lang, 'pdf.invoiceDate'), value: formatDate(inv.date, lang) },
    service,
    reference,
    ...optional('pdf.customerNumber', customer?.customerNumber ?? ''),
    ...optional('pdf.orderReference', inv.orderReference),
    ...optional('pdf.leitwegId', inv.leitwegId),
  ];
}

/** A dunning and what it is about: the invoice as it was issued, with its snapshot, and the dunnings up to this one */
export interface DunningSource {
  invoice: InvoiceFile & { issued: IssuedInfo };
  /** The dunning the letter is for */
  dunning: DunningFile;
  /** The dunnings of the invoice up to and including this one, in the order they were issued */
  dunnings: readonly DunningFile[];
  lang: Lang;
}

/**
 * The letter of a dunning. It is made from the record and the snapshot of the invoice, so a letter made again says the
 * same. The claim is the open amount of the dunning plus the interest, the fee and the flat fee of every dunning up to it
 * (domain/dunning.ts); the totals show each part.
 */
export function dunningContent(src: DunningSource): DocumentContent {
  const { invoice, dunning, dunnings, lang } = src;
  const { number, snapshot } = invoice.issued;
  const { company, customer, account } = snapshot;
  const title = tIn(lang, DUNNING_LEVEL_KEY[dunning.level]);
  const invoiceDate = formatDate(invoice.date, lang);
  const claim = claimTotal(dunning.open, dunnings);

  const totals: TotalRow[] = [{ label: tIn(lang, 'pdf.dunningOpen'), value: formatCents(dunning.open, lang), grand: false }];
  for (const d of dunnings) {
    if (d.interest > 0) {
      totals.push({ label: tIn(lang, 'pdf.dunningInterest', { from: formatDate(d.interestFrom, lang), to: formatDate(d.date, lang) }), value: formatCents(d.interest, lang), grand: false });
    }
    if (d.fee > 0) totals.push({ label: tIn(lang, 'pdf.dunningFee', { date: formatDate(d.date, lang) }), value: formatCents(d.fee, lang), grand: false });
    if (d.flatFee > 0) totals.push({ label: tIn(lang, 'pdf.dunningFlat'), value: formatCents(d.flatFee, lang), grand: false });
  }
  totals.push({ label: tIn(lang, 'pdf.dunningTotal'), value: formatCents(claim, lang), grand: true });

  const notes = [tIn(lang, 'pdf.dunningPayNote', { amount: formatCents(claim, lang), date: formatDate(dunning.payBy, lang) })];
  if (dunnings.some((d) => d.interest > 0)) notes.push(tIn(lang, 'pdf.dunningInterestNote', { points: String(SPREAD_BP[dunning.debtor] / 100) }));

  return {
    lang,
    watermark: null,
    letterhead: company.name,
    senderLine: [company.name, company.address.street, `${company.address.postalCode} ${company.address.city}`].join(' · '),
    recipient: recipientLines(customer, lang),
    info: [
      { label: tIn(lang, 'pdf.invoiceNumber'), value: number },
      { label: tIn(lang, 'pdf.invoiceDate'), value: invoiceDate },
      { label: tIn(lang, 'pdf.dueDate'), value: formatDate(dueDate(invoice), lang) },
      { label: tIn(lang, 'pdf.dunningDate'), value: formatDate(dunning.date, lang) },
      { label: tIn(lang, 'pdf.dunningPayBy'), value: formatDate(dunning.payBy, lang) },
      ...(customer.customerNumber ? [{ label: tIn(lang, 'pdf.customerNumber'), value: customer.customerNumber }] : []),
    ],
    title,
    subject: tIn(lang, 'pdf.dunningSubject', { number, date: invoiceDate }),
    intro: tIn(lang, 'pdf.dunningIntro'),
    table: { headers: tableHeaders(lang), showRate: false, rows: [] },
    totals,
    notes: nonEmpty(notes),
    closing: tIn(lang, 'pdf.dunningRegards'),
    footer: { text: company.invoiceDefaults.footer, columns: footerColumns(company, account, lang) },
    runningHead: nonEmpty([title, customer.name]).join(' · '),
    pageLabel: tIn(lang, 'pdf.page'),
    meta: {
      title: nonEmpty([title, number, customer.name, invoiceDate]).join(' – '),
      author: company.name,
      subject: tIn(lang, 'pdf.dunningSubject', { number, date: invoiceDate }),
      fileName: pdfFileName([title, number, customer.name]),
    },
  };
}
