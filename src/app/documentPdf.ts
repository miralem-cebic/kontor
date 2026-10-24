import type { DocumentId } from '../data/ids';
import type { BankAccount, InvoiceFile } from '../data/types';
import { tIn } from '../i18n';
import { sha256Hex } from '../lib/sha256';
import { makeDocumentPdf, pdfFileName, type LogoImage } from '../pdf/documentPdf';
import { useApp } from '../store/appStore';
import { openRepository, readLogo } from './session';

// A quote or an invoice as PDF, saved through the browser's download. A draft is made anew each time; an issued
// invoice is the file written when it was issued, checked against its SHA-256. Documents are German for now; a
// language per customer follows with F05.

/** `changed`: the file of an issued invoice no longer matches the SHA-256 it was issued with */
export type PdfResult = { ok: true; fileName: string; missing: string[]; changed: boolean } | { ok: false };

/** The largest size an SVG logo is drawn at, in pixels: the logo box of the PDF (55 × 24 mm) at about 600 dpi */
const MAX_LOGO_PX = { width: 1300, height: 570 };

/** An SVG logo drawn into a PNG, because a PDF cannot embed SVG; null when the browser cannot draw it */
async function svgToPng(svg: Uint8Array): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([svg.slice()], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const w = image.naturalWidth || MAX_LOGO_PX.width;
    const h = image.naturalHeight || MAX_LOGO_PX.height;
    const scale = Math.min(MAX_LOGO_PX.width / w, MAX_LOGO_PX.height / h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ? new Uint8Array(await png.arrayBuffer()) : null;
  } catch (e) {
    console.warn('Could not draw the SVG logo', e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function logoImage(): Promise<LogoImage | null> {
  const logo = await readLogo();
  if (!logo) return null;
  switch (logo.type) {
    case 'image/png':
      return { type: 'png', bytes: logo.bytes };
    case 'image/jpeg':
      return { type: 'jpeg', bytes: logo.bytes };
    case 'image/svg+xml': {
      const png = await svgToPng(logo.bytes);
      return png ? { type: 'png', bytes: png } : null;
    }
  }
}

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // the download has started; the URL is only needed until then
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The file written when the invoice was issued; it is downloaded even when it changed since, and the result says so */
async function downloadIssued(inv: InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> }): Promise<PdfResult> {
  const repo = openRepository();
  if (!repo) return { ok: false };
  const read = await repo.readIssuedFile(inv.issued.pdf.file);
  if (!read.ok) {
    console.error('Could not read the issued PDF', read.error.cause);
    return { ok: false };
  }
  const changed = (await sha256Hex(read.value.slice())) !== inv.issued.pdf.sha256;
  const fileName = pdfFileName([tIn('de', inv.cancels ? 'pdf.cancellation' : 'pdf.invoice'), inv.issued.number, inv.issued.snapshot.customer.name]);
  download(read.value, fileName);
  return { ok: true, fileName, missing: [], changed };
}

/** Makes the PDF of a saved quote or invoice draft, or reads the one of an issued invoice, and downloads it */
export async function downloadDocumentPdf(id: DocumentId): Promise<PdfResult> {
  const { company, documents, contacts } = useApp.getState();
  const doc = documents.get(id);
  if (!company || !doc || doc.deletedAt) return { ok: false };
  if (doc.kind === 'invoice' && doc.issued) return downloadIssued({ ...doc, issued: doc.issued });
  const accountId = doc.kind === 'invoice' ? doc.accountId : company.bank.defaultAccountId;
  const account: BankAccount | null = company.bank.accounts.find((a) => a.id === accountId) ?? null;
  try {
    const pdf = await makeDocumentPdf({ company, document: doc, customer: contacts.get(doc.customerId) ?? null, account, lang: 'de', number: null }, await logoImage());
    download(pdf.bytes, pdf.fileName);
    return { ok: true, fileName: pdf.fileName, missing: pdf.missing, changed: false };
  } catch (e) {
    console.error('Could not make the PDF', e);
    return { ok: false };
  }
}
