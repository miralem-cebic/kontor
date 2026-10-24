// Draws a laid-out document with pdf-lib: the fonts embedded as subsets, the logo, the metadata (title, author,
// language) and an sRGB output intent, which PDF/A requires; the e-invoice (ZUGFeRD, PDF/A-3) builds on this file in
// Phase 2, see ADR 0005. Making the file PDF/A conformant and checking it with veraPDF comes with that phase.

import fontkit from '@cantoo/fontkit';
import { degrees, PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from '@cantoo/pdf-lib';
import type { PdfAssets } from './assets';
import type { DocumentContent } from './content';
import { layoutDocument, type FontKind, type Item, type Layout, type Tone } from './layout';

export interface LogoImage {
  type: 'png' | 'jpeg';
  bytes: Uint8Array;
}

export interface RenderedPdf {
  bytes: Uint8Array;
  /** Characters of the document that the font cannot show; they appear as empty boxes */
  missing: string[];
}

const TONES: Record<Tone, RGB> = {
  text: rgb(0.1, 0.11, 0.13),
  muted: rgb(0.38, 0.41, 0.45),
  rule: rgb(0.78, 0.8, 0.83),
  watermark: rgb(0.93, 0.94, 0.95),
};

const LANGUAGE_TAG = { de: 'de-DE', en: 'en-GB' } as const;

function draw(page: PDFPage, item: Item, fonts: Record<FontKind, PDFFont>, logo: PDFImage | null) {
  const height = page.getHeight();
  switch (item.kind) {
    case 'text':
      page.drawText(item.text, { x: item.x, y: height - item.y, size: item.size, font: fonts[item.font], color: TONES[item.tone] });
      return;
    case 'rule':
      page.drawLine({ start: { x: item.x1, y: height - item.y1 }, end: { x: item.x2, y: height - item.y2 }, thickness: item.width, color: TONES[item.tone] });
      return;
    case 'logo': {
      if (!logo) return;
      // fitted into the box, keeping its proportions, at the top right of the box
      const scale = Math.min(item.width / logo.width, item.height / logo.height);
      const w = logo.width * scale;
      const h = logo.height * scale;
      page.drawImage(logo, { x: item.x + item.width - w, y: height - item.y - h, width: w, height: h });
      return;
    }
    case 'watermark': {
      // centred on the page, rising at 45°
      const font = fonts.bold;
      const w = font.widthOfTextAtSize(item.text, item.size);
      const h = font.heightAtSize(item.size, { descender: false });
      const angle = Math.PI / 4;
      const x = page.getWidth() / 2 - (w / 2) * Math.cos(angle) + (h / 2) * Math.sin(angle);
      const y = height / 2 - (w / 2) * Math.sin(angle) - (h / 2) * Math.cos(angle);
      page.drawText(item.text, { x, y, size: item.size, font, color: TONES.watermark, rotate: degrees(45) });
      return;
    }
  }
}

/** The characters of the layout that a font cannot show */
function missingCharacters(layout: Layout, fonts: Record<FontKind, PDFFont>): string[] {
  const sets: Record<FontKind, Set<number>> = { regular: new Set(fonts.regular.getCharacterSet()), bold: new Set(fonts.bold.getCharacterSet()) };
  const missing = new Set<string>();
  for (const page of layout.pages) {
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      for (const ch of item.text) {
        const code = ch.codePointAt(0) ?? 0;
        if (!/\s/u.test(ch) && !sets[item.font].has(code)) missing.add(ch);
      }
    }
  }
  return [...missing];
}

/** sRGB as the output intent of the document (PDF/A, ISO 19005, 6.2.3) */
function addOutputIntent(doc: PDFDocument, profile: Uint8Array) {
  const ctx = doc.context;
  const stream = ctx.register(ctx.flateStream(profile, { N: 3 }));
  const intent = ctx.register(
    ctx.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
      Info: PDFString.of('sRGB IEC61966-2.1'),
      DestOutputProfile: stream,
    }),
  );
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
}

/** The PDF of a document. `now` is its creation date. */
export async function renderPdf(content: DocumentContent, assets: PdfAssets, logo: LogoImage | null, now: Date): Promise<RenderedPdf> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Record<FontKind, PDFFont> = {
    regular: await doc.embedFont(assets.regular, { subset: true }),
    bold: await doc.embedFont(assets.semiBold, { subset: true }),
  };
  const image = logo ? await (logo.type === 'png' ? doc.embedPng(logo.bytes) : doc.embedJpg(logo.bytes)) : null;
  const layout = layoutDocument(content, { width: (text, font, size) => fonts[font].widthOfTextAtSize(text, size) }, { logo: image !== null });
  for (const p of layout.pages) {
    const page = doc.addPage([layout.width, layout.height]);
    for (const item of p.items) draw(page, item, fonts, image);
  }

  const { meta } = content;
  doc.setTitle(meta.title, { showInWindowTitleBar: true });
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setLanguage(LANGUAGE_TAG[content.lang]);
  doc.setCreator('kontor');
  doc.setProducer('kontor');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  addOutputIntent(doc, assets.srgb);
  return { bytes: await doc.save(), missing: missingCharacters(layout, fonts) };
}
