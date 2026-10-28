import { describe, expect, it } from 'vitest';
import { makeAccount, makeCancellation, makeContact, makeInvoice, makeQuote } from '../../src/data/schema';
import { newDocumentId } from '../../src/data/ids';
import type { BankAccount } from '../../src/data/types';
import { documentContent as contentOf, pdfFileName, recipientLines, type DocumentContent, type PdfSource } from '../../src/pdf/content';
import { sampleCompany, sampleContact, sampleInvoice, sampleIssued, sampleQuote } from './fixtures';

const company = sampleCompany({ invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'AN-{YYYY}-{NNNN}', paymentTermDays: 14, footer: 'Amtsgericht Köln' } });
const customer = makeContact(sampleContact());
const account = company.bank.accounts[0] as BankAccount;
const inAustria = makeContact(sampleContact({ nameLine2: '', contactPerson: '', address: { street: 'Ring 1', postalCode: '1010', city: 'Wien', country: 'AT' }, vatId: 'ATU12345678' }));
const invoice = (over: Parameters<typeof sampleInvoice>[0] = {}, who = customer) => makeInvoice(who.id, account.id, sampleInvoice(over), null);
/** Amounts and rates come with a no-break space before "€" and "%"; the tests read them as plain spaces */
const documentContent = (s: PdfSource): DocumentContent => JSON.parse(JSON.stringify(contentOf(s)).replace(/\u00a0/g, ' ')) as DocumentContent;
const src = (over: Partial<PdfSource>): PdfSource => ({ company, document: invoice(), customer, account, lang: 'de', number: null, ...over });

describe('the content of an invoice', () => {
  const c = documentContent(src({}));

  it('is a draft: the watermark, the title and no number yet', () => {
    expect(c.watermark).toBe('ENTWURF');
    expect(c.title).toBe('Rechnungsentwurf');
    expect(c.info[0]).toEqual({ label: 'Rechnungsnummer', value: 'Entwurf' });
  });

  it('has the return address, the recipient and the information block', () => {
    expect(c.senderLine).toBe('Muster Design · Hauptstraße 1 · 50667 Köln');
    expect(c.recipient).toEqual(['Kunde GmbH', 'Einkauf', 'z. Hd. Max Muster', 'Ringstraße 5', '10115 Berlin']);
    expect(c.info.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Rechnungsnummer: Entwurf',
      'Rechnungsdatum: 31.10.2026',
      'Leistungszeitraum: 01.10.2026 – 31.10.2026',
      'Fällig am: 14.11.2026',
      'Kundennummer: K-1001',
      'Ihre Bestellnummer: PO-4711',
    ]);
  });

  it('lists the lines with VAT and the totals per rate', () => {
    expect(c.table.showRate).toBe(true);
    expect(c.table.rows[0]).toEqual({ pos: '1', name: 'Webdesign', description: '', quantity: '12,5', unit: 'Stunde', price: '85,00 €', rate: '19 %', total: '1.062,50 €' });
    expect(c.totals.map((t) => `${t.label}: ${t.value}${t.grand ? ' (grand)' : ''}`)).toEqual([
      'Summe netto: 1.362,50 €',
      'Umsatzsteuer 7 % auf 300,00 €: 21,00 €',
      'Umsatzsteuer 19 % auf 1.062,50 €: 201,88 €',
      'Gesamtbetrag: 1.585,38 € (grand)',
    ]);
  });

  it('asks for payment by the due date to the chosen account, and has the footer', () => {
    expect(c.notes).toEqual(['Bitte überweisen Sie 1.585,38 € bis zum 14.11.2026 auf das unten genannte Konto.']);
    expect(c.footer).toEqual({
      text: 'Amtsgericht Köln',
      columns: [
        ['Muster Design', 'Erika Mustermann', 'Hauptstraße 1', '50667 Köln'],
        ['Tel. +49 221 123456', 'erika@example.com'],
        ['Steuernummer 12/345/67890', 'USt-IdNr. DE136695976'],
        ['Erika Mustermann', 'IBAN DE89 3704 0044 0532 0130 00', 'BIC COBADEFFXXX'],
      ],
    });
    expect(c.meta).toEqual({ title: 'Rechnungsentwurf – Kunde GmbH – 31.10.2026', author: 'Muster Design', subject: 'Website-Relaunch', fileName: 'Rechnungsentwurf_2026-10-31_Kunde-GmbH.pdf' });
  });

  it('due at once, or paid by PayPal', () => {
    expect(documentContent(src({ document: invoice({ paymentTermDays: 0 }) })).notes).toEqual(['Bitte überweisen Sie 1.585,38 € sofort ohne Abzug auf das unten genannte Konto.']);
    const paypal: BankAccount = makeAccount({ kind: 'paypal', name: '', email: 'erika@example.com' });
    const c2 = documentContent(src({ account: paypal }));
    expect(c2.notes).toEqual(['Bitte zahlen Sie 1.585,38 € bis zum 14.11.2026 per PayPal an erika@example.com.']);
    expect(c2.footer.columns.at(-1)).toEqual(['PayPal erika@example.com']);
  });

  it('reverse charge: no VAT, the note, both VAT IDs, and the country abroad in capitals', () => {
    const c2 = documentContent(src({ document: invoice({ taxTreatment: 'reverseCharge' }, inAustria), customer: inAustria }));
    expect(c2.recipient).toEqual(['Kunde GmbH', 'Ring 1', '1010 Wien', 'ÖSTERREICH']);
    expect(c2.table.showRate).toBe(false);
    expect(c2.table.rows.map((r) => r.rate)).toEqual(['', '']);
    expect(c2.totals).toEqual([{ label: 'Gesamtbetrag', value: '1.362,50 €', grand: true }]);
    expect(c2.notes.slice(0, 2)).toEqual(['Steuerschuldnerschaft des Leistungsempfängers', 'USt-IdNr. des Leistungsempfängers: ATU12345678 · Unsere USt-IdNr.: DE136695976']);
  });

  it('a service not taxable in Germany says so, without VAT IDs', () => {
    const c2 = documentContent(src({ document: invoice({ taxTreatment: 'notTaxable' }) }));
    expect(c2.notes[0]).toBe('Nicht im Inland steuerbare Leistung (Leistungsort im Ausland, § 3a UStG)');
    expect(c2.notes).toHaveLength(2);
  });

  it('in English', () => {
    const c2 = documentContent(src({ lang: 'en' }));
    expect(c2.title).toBe('Draft invoice');
    expect(c2.info[1]).toEqual({ label: 'Invoice date', value: '31/10/2026' });
    expect(c2.totals.at(-1)).toEqual({ label: 'Total', value: '€1,585.38', grand: true });
    expect(c2.pageLabel).toBe('Page {n} of {m}');
  });
});

describe('the content of a cancellation invoice', () => {
  const original = { ...invoice(), issued: sampleIssued('RE-2026-0001') };
  const c = documentContent(src({ document: makeCancellation(original, '2026-11-05', newDocumentId()), number: 'RE-2026-0002' }));

  it('is a cancellation with its own number that names the invoice it cancels, without a due date', () => {
    expect(c.watermark).toBeNull();
    expect(c.title).toBe('Stornorechnung');
    expect(c.info.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Rechnungsnummer: RE-2026-0002',
      'Rechnungsdatum: 05.11.2026',
      'Leistungszeitraum: 01.10.2026 – 31.10.2026',
      'Storno zu: RE-2026-0001',
      'Kundennummer: K-1001',
      'Ihre Bestellnummer: PO-4711',
    ]);
  });

  it('has the lines and totals with the opposite sign and no payment request', () => {
    expect(c.table.rows[0]).toMatchObject({ quantity: '-12,5', price: '85,00 €', total: '-1.062,50 €' });
    expect(c.totals.at(-1)).toEqual({ label: 'Gesamtbetrag', value: '-1.585,38 €', grand: true });
    expect(c.notes).toEqual(['Diese Stornorechnung hebt die Rechnung RE-2026-0001 vom 31.10.2026 vollständig auf.']);
    expect(c.closing).toBe('');
    expect(c.meta.fileName).toBe('Stornorechnung_RE-2026-0002_Kunde-GmbH.pdf');
  });

  it('keeps the VAT note of the invoice', () => {
    const rc = { ...invoice({ taxTreatment: 'reverseCharge' }, inAustria), issued: sampleIssued('RE-2026-0001') };
    const c2 = documentContent(src({ document: makeCancellation(rc, '2026-11-05', newDocumentId()), customer: inAustria, number: 'RE-2026-0002' }));
    expect(c2.notes[0]).toBe('Steuerschuldnerschaft des Leistungsempfängers');
    expect(c2.notes.at(-1)).toBe('Diese Stornorechnung hebt die Rechnung RE-2026-0001 vom 31.10.2026 vollständig auf.');
  });
});

describe('the content of a quote', () => {
  it('a small business: no VAT, the note on § 19 UStG and the validity', () => {
    const small = sampleCompany({ tax: { taxNumber: '12/345/67890', vatId: '', vat: { kind: 'smallBusiness' }, business: { kind: 'freelance' } } });
    const quote = makeQuote(customer.id, sampleQuote());
    const c = documentContent({ company: small, document: quote, customer, account: small.bank.accounts[0] ?? null, lang: 'de', number: null });
    expect(c.title).toBe('Angebotsentwurf');
    expect(c.info.map((r) => r.label)).toEqual(['Angebotsnummer', 'Angebotsdatum', 'Gültig bis', 'Kundennummer']);
    expect(c.totals).toEqual([{ label: 'Gesamtbetrag', value: '1.362,50 €', grand: true }]);
    expect(c.notes).toEqual(['Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', 'Dieses Angebot ist gültig bis zum 21.11.2026.']);
    expect(c.footer.columns[2]).toEqual(['Steuernummer 12/345/67890']);
  });

  it('a finalized quote has its number and no draft marks', () => {
    const quote = makeQuote(customer.id, sampleQuote());
    const c = documentContent({ company, document: quote, customer, account, lang: 'de', number: 'AN-2026-0001' });
    expect(c.watermark).toBeNull();
    expect(c.title).toBe('Angebot');
    expect(c.info[0]).toEqual({ label: 'Angebotsnummer', value: 'AN-2026-0001' });
    expect(c.runningHead).toBe('Angebot · Kunde GmbH');
    expect(c.meta).toMatchObject({ title: 'Angebot – AN-2026-0001 – Kunde GmbH – 22.10.2026', fileName: 'Angebot_AN-2026-0001_Kunde-GmbH.pdf' });
    expect(documentContent({ company, document: quote, customer, account, lang: 'en', number: 'AN-2026-0001' }).title).toBe('Quote');
  });

  it('a new version names the quote it replaces', () => {
    const version = makeQuote(customer.id, sampleQuote(), { id: newDocumentId(), number: 'AN-2026-0001', date: '2026-10-22', firstNumber: 'AN-2026-0001', version: 2 });
    const c = documentContent({ company, document: version, customer, account, lang: 'de', number: 'AN-2026-0001-2' });
    expect(c.info[0]).toEqual({ label: 'Angebotsnummer', value: 'AN-2026-0001-2' });
    expect(c.notes).toEqual(['Dieses Angebot ersetzt unser Angebot AN-2026-0001 vom 22.10.2026.', 'Dieses Angebot ist gültig bis zum 21.11.2026.']);
  });
});

describe('helpers', () => {
  it('the recipient of a person without address, and of a contact that is gone', () => {
    expect(recipientLines(makeContact(sampleContact({ kind: 'person', name: 'Bea Beispiel', nameLine2: '', contactPerson: '', address: null })), 'de')).toEqual(['Bea Beispiel']);
    expect(recipientLines(null, 'de')).toEqual([]);
  });

  it('file names keep letters and digits only', () => {
    expect(pdfFileName(['Rechnungsentwurf', '2026-10-31', 'Müller & Söhne / Köln'])).toBe('Rechnungsentwurf_2026-10-31_Müller-Söhne-Köln.pdf');
    expect(pdfFileName(['../..', '', '  '])).toBe('Dokument.pdf');
    expect(pdfFileName(['x'.repeat(100)])).toBe(`${'x'.repeat(60)}.pdf`);
  });
});
