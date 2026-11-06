import { beforeEach, describe, expect, it } from 'vitest';
import { cancellationOf } from '../../src/data/types';
import { encodeCsv } from '../../src/data/export/csv';
import { makeCancellation, makeContact, makeExpense, makeInvoice, makeItem, makeQuote } from '../../src/data/schema';
import type { ContactFile, DocumentFile, InvoiceFile, ItemFile, QuoteFile } from '../../src/data/types';
import { basisPoints, cents } from '../../src/domain/money';
import { expensesTable, invoicesTable, contactsTable, itemsTable, quotesTable, type Table } from '../../src/app/csvExport';
import { accountName } from '../../src/lib/labels';
import { usePrefs } from '../../src/store/prefs';
import { sampleCompany, sampleContact, sampleExpense, sampleIssued, sampleInvoice, sampleItem, sampleQuote } from './fixtures';

beforeEach(() => usePrefs.setState({ language: 'de' }));

/** The file as text, without the byte order mark: what a spreadsheet gets */
const csvText = (table: Table): string => new TextDecoder().decode(encodeCsv(table.header, table.rows)).replace(/^\uFEFF/, '');

/** The cells of one line of the file (the tests use no separator inside a cell, except where they say so) */
const cellsOf = (table: Table, line: number): string[] => csvText(table).split('\r\n')[line]!.split(';');

const COMPANY = sampleCompany();
const ACCOUNT_ID = COMPANY.bank.defaultAccountId;

describe('itemsTable', () => {
  it('lists the active items by name, with the price in euros with a comma and the VAT rate as a number', () => {
    const items = [makeItem(sampleItem()), makeItem(sampleItem({ number: 'B-1', name: 'Buchsatz', description: '', netPrice: cents(125_000), vatRate: basisPoints(700) }))];
    expect(csvText(itemsTable(items))).toBe(
      'Artikelnummer;Bezeichnung;Beschreibung;Einheit;Nettopreis;USt-Satz\r\n' +
        'B-1;Buchsatz;;Stunde;1250,00;7\r\n' +
        'L-100;Webdesign;"Gestaltung und Umsetzung\nnach Aufwand";Stunde;85,00;19\r\n',
    );
  });

  it('leaves out deleted items', () => {
    const item: ItemFile = { ...makeItem(sampleItem()), deletedAt: '2026-10-30T10:00:00.000Z' };
    expect(csvText(itemsTable([item]))).toBe('Artikelnummer;Bezeichnung;Beschreibung;Einheit;Nettopreis;USt-Satz\r\n');
  });
});

describe('contactsTable', () => {
  it('writes the kind and the roles in words, and the address in its own columns', () => {
    const contact: ContactFile = makeContact(
      sampleContact({
        name: 'Kunde GmbH',
        roles: { customer: true, supplier: true },
        address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' },
        contact: { email: 'buchhaltung@kunde.example', phone: '' },
        customerNumber: 'K-0001',
        paymentTermDays: 14,
      }),
    );
    const table = contactsTable([contact]);
    const header = table.header;
    const cells = cellsOf(table, 1);
    const at = (name: string) => cells[header.indexOf(name)];
    expect(at('Kundennummer')).toBe('K-0001');
    expect(at('Art')).toBe('Firma oder Organisation');
    expect(at('Rollen')).toBe('Kunde und Lieferant');
    expect(at('Name')).toBe('Kunde GmbH');
    expect(at('Straße')).toBe('Hauptstraße 1');
    expect(at('PLZ')).toBe('50667');
    expect(at('Ort')).toBe('Köln');
    expect(at('Land')).toBe('DE');
    expect(at('E-Mail')).toBe('buchhaltung@kunde.example');
    expect(at('Zahlungsziel (Tage)')).toBe('14');
  });
});

describe('expensesTable', () => {
  it('lists the expenses oldest first, with the VAT inside each amount and the account by name', () => {
    const later = makeExpense({ ...sampleExpense(), accountId: ACCOUNT_ID });
    const earlier = makeExpense(sampleExpense({ date: '2026-10-01', gross: cents(11_900), taxTreatment: 'euReverseCharge', vatRate: basisPoints(0), accountId: null, category: '', supplier: 'Druckerei Ost' }));
    const table = expensesTable([later, earlier], COMPANY.bank.accounts);
    const first = cellsOf(table, 1);
    const second = cellsOf(table, 2);
    expect(first.slice(0, 2)).toEqual(['2026-10-01', 'Druckerei Ost']);
    expect(first[4]).toBe('119,00');
    expect(first[5]).toBe('Lieferant aus der EU (Reverse-Charge)');
    expect(first[7]).toBe('0,00');
    expect(second.slice(0, 2)).toEqual(['2026-10-28', 'Telekom']);
    expect(second[4]).toBe('49,99');
    expect(second[7]).toBe('7,98');
    expect(second[8]).toBe(accountName(COMPANY.bank.accounts[0]!));
  });
});

describe('quotesTable and invoicesTable', () => {
  const contacts = new Map<ContactFile['id'], ContactFile>();
  const customer = makeContact(sampleContact({ name: 'Kunde GmbH' }));
  contacts.set(customer.id, customer);

  it('a draft has no number and the status Entwurf; an issued invoice has its number and the customer from its snapshot', () => {
    const draft: InvoiceFile = makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ subject: 'Entwurf-Betreff' }), null);
    const issued: InvoiceFile = { ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ subject: 'Webdesign' }), null), issued: sampleIssued('RE-2026-0001') };
    const table = invoicesTable([draft, issued], false, contacts);
    expect(cellsOf(table, 1).slice(0, 5)).toEqual(['', draft.date, 'Kunde GmbH', 'Entwurf-Betreff', 'Entwurf']);
    expect(cellsOf(table, 2).slice(0, 5)).toEqual(['RE-2026-0001', issued.date, 'Kunde GmbH', 'Webdesign', 'Ausgestellt']);
  });

  it('a cancellation has negative amounts that stay numbers, and the invoice it cancels shows as cancelled', () => {
    const original: InvoiceFile = { ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice(), null), issued: sampleIssued('RE-2026-0001') };
    const cancellation = makeCancellation(original as InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> }, '2026-11-01', original.id);
    const docs: DocumentFile[] = [original, cancellation];
    expect(cancellationOf(docs, original.id)).toBe(cancellation);
    const table = invoicesTable(docs, false, contacts);
    const originalRow = cellsOf(table, 1);
    const cancelRow = cellsOf(table, 2);
    expect(originalRow[4]).toBe('Storniert');
    expect(cancelRow[4]).toBe('Stornorechnung');
    expect(cancelRow[9]).toBe('RE-2026-0001');
    expect(cancelRow[8].startsWith('-')).toBe(true);
    expect(cancelRow[8]).not.toMatch(/^'/);
  });

  it('a small business has no VAT in its invoices: the VAT is 0,00 and the gross amount equals the net amount', () => {
    const base = sampleIssued().snapshot.company;
    const smallBusinessCompany = { ...base, tax: { ...base.tax, vat: { kind: 'smallBusiness' as const } } };
    const issued: InvoiceFile = { ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice(), null), issued: sampleIssued('RE-2026-0002', { snapshot: { company: smallBusinessCompany, customer: sampleContact(), account: sampleIssued().snapshot.account } }) };
    const table = invoicesTable([issued], false, contacts);
    const cells = cellsOf(table, 1);
    expect(cells[7]).toBe('0,00');
    expect(cells[6]).toBe(cells[8]);
  });

  it('a quote is a draft or finalized, with the date it is valid until', () => {
    const draft: QuoteFile = makeQuote(customer.id, sampleQuote({ subject: 'Website' }));
    const final: QuoteFile = { ...makeQuote(customer.id, sampleQuote({ subject: 'Relaunch' })), issued: sampleIssued('AN-2026-0001') };
    const table = quotesTable([draft, final], false, contacts);
    expect(cellsOf(table, 1).slice(0, 5)).toEqual(['', draft.date, draft.validUntil, 'Kunde GmbH', 'Website']);
    expect(cellsOf(table, 1)[5]).toBe('Entwurf');
    expect(cellsOf(table, 2)[5]).toBe('Abgeschlossen');
    expect(cellsOf(table, 2)[0]).toBe('AN-2026-0001');
  });
});
