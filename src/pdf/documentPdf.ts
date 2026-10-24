import { pdfAssets } from './assets';
import { documentContent, type PdfSource } from './content';
import { renderPdf, type LogoImage, type RenderedPdf } from './render';

// A quote or an invoice as PDF: what it says (content.ts), where it goes (layout.ts), and the file (render.ts).

export { pdfFileName, type PdfSource } from './content';
export type { LogoImage } from './render';

export interface DocumentPdf extends RenderedPdf {
  fileName: string;
}

export async function makeDocumentPdf(source: PdfSource, logo: LogoImage | null, now: Date = new Date()): Promise<DocumentPdf> {
  const content = documentContent(source);
  const pdf = await renderPdf(content, pdfAssets(), logo, now);
  return { ...pdf, fileName: content.meta.fileName };
}
