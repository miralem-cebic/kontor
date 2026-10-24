import type { DocumentId } from '../data/ids';
import type { BankAccount } from '../data/types';
import { makeDocumentPdf, type LogoImage } from '../pdf/documentPdf';
import { useApp } from '../store/appStore';
import { readLogo } from './session';

// A quote or an invoice as PDF, saved through the browser's download. Documents are German for now; a language per
// customer follows with F05.

export type PdfResult = { ok: true; fileName: string; missing: string[] } | { ok: false };

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

async function logoImage(): Promise<LogoImage | null> {
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

/** Makes the PDF of a saved quote or invoice and downloads it */
export async function downloadDocumentPdf(id: DocumentId): Promise<PdfResult> {
  const { company, documents, contacts } = useApp.getState();
  const doc = documents.get(id);
  if (!company || !doc || doc.deletedAt) return { ok: false };
  const accountId = doc.kind === 'invoice' ? doc.accountId : company.bank.defaultAccountId;
  const account: BankAccount | null = company.bank.accounts.find((a) => a.id === accountId) ?? null;
  try {
    const pdf = await makeDocumentPdf({ company, document: doc, customer: contacts.get(doc.customerId) ?? null, account, lang: 'de' }, await logoImage());
    download(pdf.bytes, pdf.fileName);
    return { ok: true, fileName: pdf.fileName, missing: pdf.missing };
  } catch (e) {
    console.error('Could not make the PDF', e);
    return { ok: false };
  }
}
