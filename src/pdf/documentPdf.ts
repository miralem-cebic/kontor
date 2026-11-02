import { pdfAssets } from './assets';
import { dunningContent, documentContent, type DunningSource, type PdfSource } from './content';
import { renderPdf, type LogoImage, type RenderedPdf } from './render';

// A quote, an invoice or the letter of a dunning as PDF: what it says (content.ts), where it goes (layout.ts), and the file (render.ts).

export { pdfFileName, type DunningSource, type PdfSource } from './content';
export type { LogoImage } from './render';

export interface DocumentPdf extends RenderedPdf {
  fileName: string;
}

export async function makeDocumentPdf(source: PdfSource, logo: LogoImage | null, now: Date = new Date()): Promise<DocumentPdf> {
  const content = documentContent(source);
  const pdf = await renderPdf(content, pdfAssets(), logo, now);
  return { ...pdf, fileName: content.meta.fileName };
}

export async function makeDunningPdf(source: DunningSource, logo: LogoImage | null, now: Date = new Date()): Promise<DocumentPdf> {
  const content = dunningContent(source);
  const pdf = await renderPdf(content, pdfAssets(), logo, now);
  return { ...pdf, fileName: content.meta.fileName };
}
