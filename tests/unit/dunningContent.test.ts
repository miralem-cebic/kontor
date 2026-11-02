import { describe, expect, it } from 'vitest';
import { newAccountId } from '../../src/data/ids';
import { makeContact, makeDunning, makeInvoice } from '../../src/data/schema';
import type { DunningFile, InvoiceFile } from '../../src/data/types';
import type { IssuedInfo } from '../../src/domain/invoice';
import { claimTotal, interestOn, SPREAD_BP } from '../../src/domain/dunning';
import { cents, formatCents, type Cents } from '../../src/domain/money';
import { invoiceTotals } from '../../src/domain/invoice';
import { dunningContent, type DocumentContent, type DunningSource } from '../../src/pdf/content';
import { makeDunningPdf } from '../../src/pdf/documentPdf';
import { sampleAccount, sampleContact, sampleInvoice, sampleIssued, sampleProfile } from './fixtures';

// The letter of a dunning (F04): what it says is read from the dunning record and the snapshot of the invoice, so a letter
// made again says the same. The claim it states is the one domain/dunning.ts calculates.

/** An issued invoice of the sample: RE-2026-0001, dated 31 October 2026, due on 14 November 2026, to a company or a consumer */
function issuedInvoice(customer: 'company' | 'person' = 'company'): InvoiceFile & { issued: IssuedInfo } {
  const contact = customer === 'person' ? sampleContact({ kind: 'person', nameLine2: '', contactPerson: '', vatId: '' }) : sampleContact();
  const draft = makeInvoice(makeContact(contact).id, newAccountId(), sampleInvoice(), null);
  return { ...draft, issued: sampleIssued('RE-2026-0001', { snapshot: { company: sampleProfile(), customer: contact, account: sampleAccount() } }) };
}

/** A dunning of the invoice as the planning writes it */
const dunningOf = (invoice: InvoiceFile, over: Partial<Omit<DunningFile, 'schemaVersion' | 'id' | 'invoiceId' | 'createdAt'>>): DunningFile =>
  makeDunning(invoice.id, {
    level: 'reminder',
    date: '2026-11-20',
    debtor: 'business',
    open: invoiceTotals(invoice, false).gross,
    interestFrom: '2026-11-15',
    interest: cents(0),
    flatFee: cents(4_000),
    fee: cents(0),
    payBy: '2026-12-04',
    ...over,
  });

const NO_BREAK_SPACE = /\u00a0/g;
/** An amount as the content holds it: no-break spaces read as plain spaces */
const eur = (c: Cents): string => formatCents(c, 'de').replace(NO_BREAK_SPACE, ' ');

/** Two dunnings: the payment reminder with the flat fee, then the first dunning with a fee and the next interest */
function twoDunnings(customerKind: 'company' | 'person' = 'company') {
  const invoice = issuedInvoice(customerKind);
  const gross = invoiceTotals(invoice, false).gross;
  const business = customerKind === 'company';
  const firstInterest = interestOn(gross, '2026-11-15', '2026-11-20', SPREAD_BP[business ? 'business' : 'consumer'])?.amount ?? cents(0);
  const first = dunningOf(invoice, {
    debtor: business ? 'business' : 'consumer',
    interest: firstInterest,
    flatFee: business ? cents(4_000) : cents(0),
    interestFrom: business ? '2026-11-15' : '2026-11-20',
  });
  const second = dunningOf(invoice, {
    level: 'level1',
    date: '2026-11-30',
    debtor: business ? 'business' : 'consumer',
    open: gross,
    interestFrom: '2026-11-21',
    interest: interestOn(gross, '2026-11-21', '2026-11-30', SPREAD_BP[business ? 'business' : 'consumer'])?.amount ?? cents(0),
    flatFee: cents(0),
    fee: cents(500),
    payBy: '2026-12-14',
  });
  return { invoice, first, second };
}

const sourceOf = (invoice: InvoiceFile & { issued: IssuedInfo }, dunning: DunningFile, dunnings: DunningFile[]): DunningSource => ({ invoice, dunning, dunnings, lang: 'de' });

describe('the letter of a dunning', () => {
  it('is titled after its level and names the invoice, its date and the date of the dunning', () => {
    const { invoice, first, second } = twoDunnings();
    const c = plainContent(dunningContent(sourceOf(invoice, second, [first, second])));
    expect(c.title).toBe('1. Mahnung');
    expect(c.subject).toBe('Rechnung RE-2026-0001 vom 31.10.2026');
    expect(c.watermark).toBeNull();
    expect(c.info).toEqual(
      expect.arrayContaining([
        { label: 'Rechnungsnummer', value: 'RE-2026-0001' },
        { label: 'Rechnungsdatum', value: '31.10.2026' },
        { label: 'Fällig am', value: '14.11.2026' },
        { label: 'Datum der Mahnung', value: '30.11.2026' },
        { label: 'Zahlbar bis', value: '14.12.2026' },
      ]),
    );
  });

  it('a first dunning is the payment reminder', () => {
    const { invoice, first } = twoDunnings();
    expect(plainContent(dunningContent(sourceOf(invoice, first, [first]))).title).toBe('Zahlungserinnerung');
  });

  it('states the claim as the open amount plus the interest, fees and flat fees up to this letter', () => {
    const { invoice, first, second } = twoDunnings();
    const c = plainContent(dunningContent(sourceOf(invoice, second, [first, second])));
    const claim = claimTotal(second.open, [first, second]);
    expect(c.totals.at(-1)).toEqual({ label: 'Gesamtforderung', value: eur(claim), grand: true });
    expect(c.totals.find((t) => t.label === 'Offener Rechnungsbetrag')?.value).toBe(eur(second.open));
  });

  it('lists the interest of every dunning, the fee typed in, and the flat fee once', () => {
    const { invoice, first, second } = twoDunnings();
    const labels = plainContent(dunningContent(sourceOf(invoice, second, [first, second]))).totals.map((t) => t.label);
    expect(labels).toContain('Verzugszinsen vom 15.11.2026 bis 20.11.2026');
    expect(labels).toContain('Verzugszinsen vom 21.11.2026 bis 30.11.2026');
    expect(labels).toContain('Mahngebühr vom 30.11.2026');
    expect(labels.filter((l) => l.startsWith('Pauschale'))).toHaveLength(1);
  });

  it('asks for the claim by the pay-by date, and says how the interest is counted', () => {
    const { invoice, first, second } = twoDunnings();
    const c = plainContent(dunningContent(sourceOf(invoice, second, [first, second])));
    const claim = eur(claimTotal(second.open, [first, second]));
    expect(c.notes).toContain(`Bitte überweisen Sie den Gesamtbetrag von ${claim} bis zum 14.12.2026.`);
    expect(c.notes).toContain('Die Verzugszinsen sind nach § 288 BGB berechnet: Basiszinssatz plus 9 Prozentpunkte.');
  });

  it('for a consumer the interest is 5 points above the base rate and the flat fee is not charged', () => {
    const { invoice, first, second } = twoDunnings('person');
    const c = plainContent(dunningContent(sourceOf(invoice, second, [first, second])));
    expect(c.notes).toContain('Die Verzugszinsen sind nach § 288 BGB berechnet: Basiszinssatz plus 5 Prozentpunkte.');
    expect(c.totals.some((t) => t.label.startsWith('Pauschale'))).toBe(false);
  });

  it('is named after its level and the invoice', () => {
    const { invoice, first, second } = twoDunnings();
    expect(plainContent(dunningContent(sourceOf(invoice, second, [first, second]))).meta.fileName).toBe('1-Mahnung_RE-2026-0001_Kunde-GmbH.pdf');
  });
});

describe('makeDunningPdf', () => {
  it('writes the letter as a PDF named after it, with no missing characters', async () => {
    const { invoice, first, second } = twoDunnings();
    const pdf = await makeDunningPdf(sourceOf(invoice, second, [first, second]), null, new Date('2026-11-30T10:00:00Z'));
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.fileName).toBe('1-Mahnung_RE-2026-0001_Kunde-GmbH.pdf');
    expect(pdf.missing).toEqual([]);
  });
});

/** The content with the no-break spaces of amounts read as plain spaces, as the other PDF tests do */
function plainContent(c: DocumentContent): DocumentContent {
  return JSON.parse(JSON.stringify(c).replace(NO_BREAK_SPACE, ' ')) as DocumentContent;
}
