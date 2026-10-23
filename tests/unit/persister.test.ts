import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { emergencyKey, Persister } from '../../src/data/persister';
import { err, must } from '../../src/data/result';
import { nowIso } from '../../src/data/schema';
import * as A from '../../src/store/appStore';
import { MAX_ACCOUNTS } from '../../src/domain/bankAccount';
import { MemoryStorage, sampleAccount, sampleCompany, sampleContact, sampleInvoice, sampleItem, sampleQuote } from './fixtures';

beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} }, localStorage: new MemoryStorage() });
});

let root: MemDir;
let repo: FsRepository;
let persister: Persister;

beforeEach(async () => {
  root = new MemDir('c');
  repo = new FsRepository(root.asHandle());
  const company = sampleCompany();
  must(await repo.createCompany(company, []));
  A.resetApp();
  A.loadCompany(must(await repo.readCompany()), { contacts: [], items: [], documents: [] });
  persister = new Persister(repo);
  persister.start();
});

afterEach(() => persister.stop());

const onDisk = async () => must(await new FsRepository(root.asHandle()).readCompany());

describe('Persister', () => {
  it('writes nothing when nothing changed', async () => {
    const before = (await root.getFileHandle('company.json')).lastModified;
    await persister.flush();
    expect((await root.getFileHandle('company.json')).lastModified).toBe(before);
  });

  it('writes a change and reports the status', async () => {
    A.updateCompany({ name: 'Neu GmbH' });
    expect(A.useApp.getState().save.state).toBe('saving');
    await persister.flush();
    expect((await onDisk()).name).toBe('Neu GmbH');
    expect(A.useApp.getState().save.state).toBe('saved');
  });

  it('keeps a failed change, writes an emergency copy, and saves it on retry', async () => {
    const orig = repo.saveCompany.bind(repo);
    repo.saveCompany = async () => err({ kind: 'permission', cause: new Error('denied') });
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();
    const s = A.useApp.getState();
    expect(s.save).toEqual({ state: 'error', kind: 'permission' });
    const copy = JSON.parse(localStorage.getItem(emergencyKey(s.company!.id)) ?? 'null');
    expect(copy.company.owner).toBe('Erika M.');

    repo.saveCompany = orig;
    await persister.retry();
    expect((await onDisk()).owner).toBe('Erika M.');
    expect(localStorage.getItem(emergencyKey(s.company!.id))).toBeNull();
  });

  it('takes over a change from another device that was merged while saving', async () => {
    const other = new FsRepository(root.asHandle());
    const theirs = must(await other.readCompany());
    must(await other.saveCompany({ ...theirs, invoiceDefaults: { ...theirs.invoiceDefaults, footer: 'Danke!' }, fieldUpdatedAt: { ...theirs.fieldUpdatedAt, invoiceDefaults: nowIso() } }));
    A.updateCompany({ name: 'Lokal' });
    await persister.flush();
    const state = A.useApp.getState().company!;
    expect(state.name).toBe('Lokal');
    expect(state.invoiceDefaults.footer).toBe('Danke!');
    expect(await onDisk()).toEqual(state);
    // the merged state counts as saved: no further write
    expect(persister.pending).toBe(false);
  });
});

describe('updateCompany', () => {
  it('stamps only the fields that changed', () => {
    const before = A.useApp.getState().company!;
    A.updateCompany({ name: before.name, owner: 'Someone else' });
    const after = A.useApp.getState().company!;
    expect(after.fieldUpdatedAt.name).toBe(before.fieldUpdatedAt.name);
    expect(after.fieldUpdatedAt.owner! > before.fieldUpdatedAt.owner!).toBe(true);
  });

  it('keeps the same object when nothing changed', () => {
    const before = A.useApp.getState().company;
    A.updateCompany({ name: before!.name, bank: { ...before!.bank } });
    expect(A.useApp.getState().company).toBe(before);
  });
});

describe('bank accounts', () => {
  const bank = () => A.useApp.getState().company!.bank;
  const paypal = { kind: 'paypal', name: 'PayPal', email: 'erika@example.com' } as const;

  it('adds an account, stamps the field and writes it', async () => {
    const before = A.useApp.getState().company!;
    const id = A.addAccount(paypal);
    expect(bank().accounts.map((a) => a.id)).toEqual([before.bank.defaultAccountId, id]);
    expect(bank().defaultAccountId).toBe(before.bank.defaultAccountId);
    expect(A.useApp.getState().company!.fieldUpdatedAt.bank! > before.fieldUpdatedAt.bank!).toBe(true);
    await persister.flush();
    expect((await onDisk()).bank).toEqual(bank());
  });

  it('changes the details of an account, but not its kind', () => {
    const id = bank().defaultAccountId;
    A.updateAccount(id, sampleAccount({ bic: 'DEUTDEFF' }));
    expect(bank().accounts[0]).toMatchObject({ id, kind: 'bank', bic: 'DEUTDEFF', deletedAt: null });
    const before = bank();
    A.updateAccount(id, paypal);
    expect(bank()).toBe(before);
  });

  it('the default can move to another account; the default itself cannot be removed', () => {
    const first = bank().defaultAccountId;
    const id = A.addAccount(paypal)!;
    A.deleteAccount(first);
    expect(bank().accounts.every((a) => a.deletedAt === null)).toBe(true);
    A.setDefaultAccount(id);
    A.deleteAccount(first);
    expect(bank().defaultAccountId).toBe(id);
    expect(bank().accounts.find((a) => a.id === first)?.deletedAt).toBeTruthy();
  });

  it('a removed account stays in the list; it cannot become the default or be changed again', () => {
    const id = A.addAccount(paypal)!;
    A.deleteAccount(id);
    const before = bank();
    A.setDefaultAccount(id);
    A.updateAccount(id, { ...paypal, name: 'Neu' });
    A.deleteAccount(id);
    expect(bank()).toBe(before);
    expect(before.accounts).toHaveLength(2);
  });

  it('stops at the limit, removed accounts included', () => {
    for (let i = bank().accounts.length; i < MAX_ACCOUNTS; i++) expect(A.addAccount({ ...paypal, email: `p${i}@example.com` })).not.toBeNull();
    expect(A.addAccount(paypal)).toBeNull();
    expect(bank().accounts).toHaveLength(MAX_ACCOUNTS);
  });
});

describe('Persister with contacts', () => {
  const contactsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadContacts()).contacts;

  it('writes a new contact, its changes and its deletion', async () => {
    const id = A.addContact(sampleContact());
    await persister.flush();
    expect((await contactsOnDisk()).map((c) => c.name)).toEqual(['Kunde GmbH']);

    A.updateContact(id, sampleContact({ name: 'Kunde AG' }));
    const stamped = A.useApp.getState().contacts.get(id)!;
    expect(stamped.fieldUpdatedAt.name! > stamped.createdAt).toBe(true);
    await persister.flush();
    expect((await contactsOnDisk())[0]?.name).toBe('Kunde AG');

    A.deleteContact(id);
    await persister.flush();
    const [deleted] = await contactsOnDisk();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.fieldUpdatedAt.deletedAt).toBe(deleted?.deletedAt);
  });

  it('keeps unsaved contacts in the emergency copy', async () => {
    const orig = repo.saveContact.bind(repo);
    repo.saveContact = async () => err({ kind: 'quota', cause: new Error('full') });
    const id = A.addContact(sampleContact({ name: 'Unsaved' }));
    await persister.flush();
    const company = A.useApp.getState().company!;
    const copy = JSON.parse(localStorage.getItem(emergencyKey(company.id)) ?? 'null');
    expect(copy.company).toBeNull();
    expect(copy.contacts.map((c: { id: string }) => c.id)).toEqual([id]);
    repo.saveContact = orig;
    await persister.retry();
    expect((await contactsOnDisk()).map((c) => c.name)).toEqual(['Unsaved']);
  });
});

describe('Persister with items', () => {
  const itemsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadItems()).items;

  it('writes a new item, its changes and its deletion', async () => {
    const id = A.addItem(sampleItem());
    await persister.flush();
    expect((await itemsOnDisk()).map((i) => i.name)).toEqual(['Webdesign']);

    A.updateItem(id, sampleItem({ name: 'Webentwicklung' }));
    const stamped = A.useApp.getState().items.get(id)!;
    expect(stamped.fieldUpdatedAt.name! > stamped.createdAt).toBe(true);
    expect(stamped.fieldUpdatedAt.netPrice).toBe(stamped.createdAt);
    await persister.flush();
    expect((await itemsOnDisk())[0]?.name).toBe('Webentwicklung');

    A.deleteItem(id);
    await persister.flush();
    const [deleted] = await itemsOnDisk();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.fieldUpdatedAt.deletedAt).toBe(deleted?.deletedAt);
  });

  it('keeps unsaved items in the emergency copy', async () => {
    const orig = repo.saveItem.bind(repo);
    repo.saveItem = async () => err({ kind: 'quota', cause: new Error('full') });
    const id = A.addItem(sampleItem({ name: 'Unsaved' }));
    await persister.flush();
    const company = A.useApp.getState().company!;
    const copy = JSON.parse(localStorage.getItem(emergencyKey(company.id)) ?? 'null');
    expect(copy.company).toBeNull();
    expect(copy.contacts).toEqual([]);
    expect(copy.items.map((i: { id: string }) => i.id)).toEqual([id]);
    repo.saveItem = orig;
    await persister.retry();
    expect((await itemsOnDisk()).map((i) => i.name)).toEqual(['Unsaved']);
  });
});

describe('Persister with quotes', () => {
  const documentsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadDocuments()).documents;

  it('writes a new quote, its changes and its deletion', async () => {
    const customer = A.addContact(sampleContact());
    const id = A.addQuote(customer, sampleQuote());
    await persister.flush();
    expect((await documentsOnDisk()).map((d) => d.subject)).toEqual(['Website-Relaunch']);

    A.updateQuote(id, customer, sampleQuote({ subject: 'Relaunch 2027' }));
    const stamped = A.useApp.getState().documents.get(id)!;
    expect(stamped.fieldUpdatedAt.subject! > stamped.createdAt).toBe(true);
    expect(stamped.fieldUpdatedAt.lines).toBe(stamped.createdAt);
    await persister.flush();
    expect((await documentsOnDisk())[0]?.subject).toBe('Relaunch 2027');

    A.deleteDocument(id);
    A.updateQuote(id, customer, sampleQuote({ subject: 'after delete' }));
    await persister.flush();
    const [deleted] = await documentsOnDisk();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.subject).toBe('Relaunch 2027');
  });

  it('keeps unsaved quotes in the emergency copy', async () => {
    const orig = repo.saveDocument.bind(repo);
    repo.saveDocument = async () => err({ kind: 'permission', cause: new Error('denied') });
    const customer = A.addContact(sampleContact());
    const id = A.addQuote(customer, sampleQuote());
    await persister.flush();
    const company = A.useApp.getState().company!;
    const copy = JSON.parse(localStorage.getItem(emergencyKey(company.id)) ?? 'null');
    expect(copy.documents.map((d: { id: string }) => d.id)).toEqual([id]);
    repo.saveDocument = orig;
    await persister.retry();
    expect((await documentsOnDisk()).map((d) => d.id)).toEqual([id]);
  });
});

describe('Persister with invoices', () => {
  const documentsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadDocuments()).documents;

  it('writes a new invoice from a quote, its changes and its deletion', async () => {
    const customer = A.addContact(sampleContact());
    const account = A.useApp.getState().company!.bank.defaultAccountId;
    const quoteId = A.addQuote(customer, sampleQuote());
    const id = A.addInvoice(customer, account, sampleInvoice(), quoteId);
    await persister.flush();
    expect((await documentsOnDisk()).find((d) => d.id === id)).toMatchObject({ kind: 'invoice', quoteId, accountId: account });

    A.updateInvoice(id, customer, account, sampleInvoice({ paymentTermDays: 30 }));
    const stamped = A.useApp.getState().documents.get(id)!;
    expect(stamped.kind === 'invoice' && stamped.fieldUpdatedAt.paymentTermDays! > stamped.createdAt).toBe(true);
    expect(stamped.kind === 'invoice' && stamped.fieldUpdatedAt.service).toBe(stamped.createdAt);
    await persister.flush();
    expect((await documentsOnDisk()).find((d) => d.id === id)).toMatchObject({ paymentTermDays: 30 });

    A.deleteDocument(id);
    await persister.flush();
    expect((await documentsOnDisk()).find((d) => d.id === id)?.deletedAt).toBeTruthy();
  });

  it('an invoice is not changed as a quote, nor a quote as an invoice', () => {
    const customer = A.addContact(sampleContact());
    const account = A.useApp.getState().company!.bank.defaultAccountId;
    const quoteId = A.addQuote(customer, sampleQuote());
    const invoiceId = A.addInvoice(customer, account, sampleInvoice(), null);
    const before = A.useApp.getState().documents;
    A.updateQuote(invoiceId, customer, sampleQuote({ subject: 'X' }));
    A.updateInvoice(quoteId, customer, account, sampleInvoice({ subject: 'X' }));
    expect(A.useApp.getState().documents).toBe(before);
  });
});
