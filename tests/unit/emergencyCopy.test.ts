import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recoverEmergencyCopy } from '../../src/app/session';
import { emergencyKey, legacyEmergencyKey, signCopy } from '../../src/data/persister';
import { makeContact, makeInvoice, makePayment, makeItem, SCHEMA_VERSION } from '../../src/data/schema';
import type { CompanyFile } from '../../src/data/types';
import { cents } from '../../src/domain/money';
import type { CompanyRecords } from '../../src/store/appStore';
import { MemoryStorage, sampleCompany, sampleContact, sampleInvoice, sampleIssued, sampleItem } from './fixtures';

// Every page under file:// shares the browser's storage (#69): another local HTML file can read and write the emergency
// copy. It is used only with the signature of the folder's key, and even then never for issued documents, payments,
// dunnings or decisions on quotes, which are written to the folder before they reach the store.

const KEY = new Uint8Array(32).fill(3);
const none: CompanyRecords = { contacts: [], items: [], documents: [], payments: [], dunnings: [], quoteStatuses: [], expenses: [], payouts: [] };
let company: CompanyFile;

beforeAll(() => {
  Object.assign(globalThis, { localStorage: new MemoryStorage() });
});

beforeEach(() => {
  localStorage.clear();
  company = sampleCompany();
});

const keep = (copy: object, key = KEY) => localStorage.setItem(emergencyKey(company.id), signCopy(JSON.stringify({ at: new Date().toISOString(), company: null, contacts: [], items: [], documents: [], payments: [], dunnings: [], quoteStatuses: [], expenses: [], payouts: [], ...copy }), key));
const stamped = <T extends object>(record: T) => ({ ...record, schemaVersion: SCHEMA_VERSION });

describe('recoverEmergencyCopy', () => {
  it('takes the records of a copy signed with the key of the folder', () => {
    const contact = makeContact(sampleContact({ name: 'Gerettet GmbH' }));
    keep({ contacts: [stamped(contact)] });
    const { recovered, rejected } = recoverEmergencyCopy(company, none, KEY);
    expect(rejected).toBe(false);
    expect(recovered?.contacts.map((c) => c.name)).toEqual(['Gerettet GmbH']);
  });

  it('refuses and removes a copy signed with another key or changed after signing', () => {
    keep({ contacts: [stamped(makeContact(sampleContact()))] }, new Uint8Array(32).fill(4));
    expect(recoverEmergencyCopy(company, none, KEY)).toEqual({ recovered: null, rejected: true });
    expect(localStorage.getItem(emergencyKey(company.id))).toBeNull();

    keep({ contacts: [stamped(makeContact(sampleContact({ name: 'Echt' })))] });
    localStorage.setItem(emergencyKey(company.id), localStorage.getItem(emergencyKey(company.id))!.replace('Echt', 'Falsch'));
    expect(recoverEmergencyCopy(company, none, KEY)).toEqual({ recovered: null, rejected: true });
  });

  it('removes the unsigned copy of an earlier version without using it', () => {
    localStorage.setItem(legacyEmergencyKey(company.id), JSON.stringify({ at: '2026-11-01T00:00:00.000Z', company: null, contacts: [stamped(makeContact(sampleContact()))] }));
    expect(recoverEmergencyCopy(company, none, KEY)).toEqual({ recovered: null, rejected: true });
    expect(localStorage.getItem(legacyEmergencyKey(company.id))).toBeNull();
  });

  it('never takes an issued document from a copy, only drafts', () => {
    const customer = makeContact(sampleContact());
    const draft = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice({ subject: 'Entwurf' }), null);
    const issued = { ...makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice({ subject: 'Untergeschoben' }), null), issued: sampleIssued('RE-2026-0042') };
    keep({ documents: [stamped(draft), stamped(issued)] });
    const { recovered } = recoverEmergencyCopy(company, none, KEY);
    expect(recovered?.documents.map((d) => d.subject)).toEqual(['Entwurf']);
  });

  it('takes no payments, dunnings or decisions on quotes: the folder has them already', () => {
    const customer = makeContact(sampleContact());
    const invoice = makeInvoice(customer.id, company.bank.defaultAccountId, sampleInvoice(), null);
    const payment = makePayment(invoice.id, { date: '2026-11-02', amount: cents(5_000), accountId: company.bank.defaultAccountId, note: '' });
    keep({ payments: [stamped(payment)], items: [stamped(makeItem(sampleItem()))] });
    const { recovered } = recoverEmergencyCopy(company, none, KEY);
    expect(recovered?.payments).toEqual([]);
    expect(recovered?.items).toHaveLength(1);
  });

  it('without the key of the folder, the copy is neither used nor removed: it is checked at a later start', () => {
    keep({ contacts: [stamped(makeContact(sampleContact()))] });
    expect(recoverEmergencyCopy(company, none, null)).toEqual({ recovered: null, rejected: false });
    expect(localStorage.getItem(emergencyKey(company.id))).not.toBeNull();
  });
});
