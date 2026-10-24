import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { BankAccount } from '../../src/data/types';
import { makeDocumentPdf, type PdfSource } from '../../src/pdf/documentPdf';
import { sampleCompany, sampleContact, sampleInvoice } from './fixtures';

const company = sampleCompany();
const customer = makeContact(sampleContact());
const account = company.bank.accounts[0] as BankAccount;
const source = (over: Parameters<typeof sampleInvoice>[0] = {}): PdfSource => ({
  company,
  document: makeInvoice(customer.id, account.id, sampleInvoice(over), null),
  customer,
  account,
  lang: 'de',
  number: null,
});
/** A 1×1 PNG */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('makeDocumentPdf', () => {
  it('writes a PDF with the metadata, the subset fonts and the sRGB output intent', async () => {
    const pdf = await makeDocumentPdf(source(), { type: 'png', bytes: PNG }, new Date('2026-10-24T10:00:00Z'));
    expect(latin1(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.fileName).toBe('Rechnungsentwurf_2026-10-31_Kunde-GmbH.pdf');
    expect(pdf.missing).toEqual([]);
    const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Rechnungsentwurf – Kunde GmbH – 31.10.2026');
    expect(doc.getAuthor()).toBe('Muster Design');
    expect(doc.getCreator()).toBe('kontor');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(doc.catalog.get(PDFName.of('Lang'))?.toString()).toBe('(de-DE)');
    expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeDefined();
    // both fonts are embedded (FontFile2), and only as the subset the document uses: far smaller than 2 × 340 KB
    const descriptors = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
    expect(descriptors).toHaveLength(2);
    expect(pdf.bytes.length).toBeLessThan(40_000);
  });

  it('reports characters the font cannot show', async () => {
    const pdf = await makeDocumentPdf(source({ subject: 'Website 中文 und Ελληνικά' }), null);
    expect(pdf.missing).toEqual(['中', '文']);
  });
});
