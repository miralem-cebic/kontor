import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { emergencyKey, Persister, RETRY_DELAYS_MS } from '../../src/data/persister';
import { err, must } from '../../src/data/result';
import { brandId } from '../../src/data/ids';
import { makePayment, nowIso } from '../../src/data/schema';
import { cents } from '../../src/domain/money';
import * as A from '../../src/store/appStore';
import { MAX_ACCOUNTS } from '../../src/domain/bankAccount';
import { MemoryStorage, sampleAccount, sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued, sampleItem, samplePayout, sampleQuote } from './fixtures';

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
  A.loadCompany(must(await repo.readCompany()), { contacts: [], items: [], documents: [], payments: [], dunnings: [], quoteStatuses: [], expenses: [], payouts: [] });
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

describe('Persister: trying again (#94)', () => {
  const denied = () => err({ kind: 'permission' as const, cause: new DOMException('denied', 'NotAllowedError') });

  it('"Try again" after a permission failure asks for the permission first, and saves when it is granted', async () => {
    const orig = repo.saveCompany.bind(repo);
    repo.saveCompany = async () => denied();
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();
    expect(A.useApp.getState().save).toEqual({ state: 'error', kind: 'permission' });

    repo.saveCompany = orig;
    const requestAccess = vi.fn(async () => true);
    await persister.retry(requestAccess);
    expect(requestAccess).toHaveBeenCalledOnce();
    expect((await onDisk()).owner).toBe('Erika M.');
    expect(A.useApp.getState().save).toEqual({ state: 'saved' });
  });

  it('a permission that is refused again keeps the change and the error, without writing', async () => {
    const save = vi.fn(async () => denied());
    repo.saveCompany = save;
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();
    save.mockClear();
    await persister.retry(async () => false);
    expect(save).not.toHaveBeenCalled();
    expect(A.useApp.getState().save).toEqual({ state: 'error', kind: 'permission' });
    expect(persister.pending).toBe(true);
  });

  it('does not ask for a permission after another kind of failure', async () => {
    const orig = repo.saveCompany.bind(repo);
    repo.saveCompany = async () => err({ kind: 'quota', cause: new DOMException('full', 'QuotaExceededError') });
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();
    repo.saveCompany = orig;
    const requestAccess = vi.fn(async () => true);
    await persister.retry(requestAccess);
    expect(requestAccess).not.toHaveBeenCalled();
    expect((await onDisk()).owner).toBe('Erika M.');
  });

  describe('a file in use by another program', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is tried again by itself, after 2 s, then 10 s, …', async () => {
      const orig = repo.saveCompany.bind(repo);
      let failures = 2;
      repo.saveCompany = async (c) => (failures-- > 0 ? err({ kind: 'locked', cause: new DOMException('in use', 'NoModificationAllowedError') }) : orig(c));
      A.updateCompany({ owner: 'Erika M.' });
      await persister.flush();
      expect(A.useApp.getState().save).toEqual({ state: 'error', kind: 'locked' });

      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
      expect(A.useApp.getState().save).toEqual({ state: 'error', kind: 'locked' });
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]!);
      expect(A.useApp.getState().save).toEqual({ state: 'saved' });
      expect((await onDisk()).owner).toBe('Erika M.');
    });

    it('gives up after the last delay; "Try again" starts over', async () => {
      const save = vi.fn(async () => err({ kind: 'other' as const, cause: new DOMException('busy', 'NotReadableError') }));
      repo.saveCompany = save;
      A.updateCompany({ owner: 'Erika M.' });
      await persister.flush();
      for (const ms of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(ms);
      expect(save).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(save).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
      await persister.retry();
      expect(save).toHaveBeenCalledTimes(2 + RETRY_DELAYS_MS.length);
    });

    it('a failure that waits for the person is not tried again by itself', async () => {
      const save = vi.fn(async () => denied());
      repo.saveCompany = save;
      A.updateCompany({ owner: 'Erika M.' });
      await persister.flush();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(save).toHaveBeenCalledOnce();
    });
  });
});

describe('Persister: a record the folder refuses for good (#95)', () => {
  const contactsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadContacts()).contacts;
  const newer = () => err({ kind: 'newerSchema' as const, cause: new Error('written by a newer kontor') });
  const copyOf = () => JSON.parse(localStorage.getItem(emergencyKey(A.useApp.getState().company!.id)) ?? 'null');

  it('waits apart: the other records are written, the status is saved, and the record is listed as unsaved', async () => {
    const orig = repo.saveContact.bind(repo);
    const stuckId = A.addContact(sampleContact({ name: 'Neuer auf der Platte' }));
    repo.saveContact = async (c) => (c.id === stuckId ? newer() : orig(c));
    const otherId = A.addContact(sampleContact({ name: 'Andere GmbH', customerNumber: 'K-0002' }));
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();

    expect((await contactsOnDisk()).map((c) => c.id)).toEqual([otherId]);
    expect((await onDisk()).owner).toBe('Erika M.');
    expect(A.useApp.getState().save).toEqual({ state: 'saved' });
    expect(A.useApp.getState().unsaved).toEqual([{ key: `contact:${stuckId}`, kind: 'newerSchema' }]);
    expect(persister.pending).toBe(false);
    // the change is kept in the browser until it is written or discarded
    expect(copyOf().contacts.map((c: { id: string }) => c.id)).toEqual([stuckId]);
  });

  it('is not tried again on every flush, but on "Try again" and when it changes again', async () => {
    const orig = repo.saveContact.bind(repo);
    const save = vi.fn(async () => newer());
    repo.saveContact = save;
    const id = A.addContact(sampleContact());
    await persister.flush();
    A.updateCompany({ owner: 'Erika M.' });
    await persister.flush();
    expect(save).toHaveBeenCalledOnce();

    A.updateContact(id, sampleContact({ name: 'Kunde AG' }));
    await persister.flush();
    expect(save).toHaveBeenCalledTimes(2);

    repo.saveContact = orig;
    await persister.retry();
    expect((await contactsOnDisk()).map((c) => c.name)).toEqual(['Kunde AG']);
    expect(A.useApp.getState().unsaved).toEqual([]);
    expect(localStorage.getItem(emergencyKey(A.useApp.getState().company!.id))).toBeNull();
  });

  it('can be discarded: it leaves the list and the emergency copy and is not written again', async () => {
    const save = vi.fn(async () => newer());
    repo.saveContact = save;
    const id = A.addContact(sampleContact());
    await persister.flush();
    persister.discard(`contact:${id}`);
    expect(A.useApp.getState().unsaved).toEqual([]);
    expect(localStorage.getItem(emergencyKey(A.useApp.getState().company!.id))).toBeNull();
    await persister.retry();
    expect(save).toHaveBeenCalledOnce();
    expect(persister.pending).toBe(false);
  });

  it('a discarded record leaves the other unsaved ones in the emergency copy', async () => {
    const orig = repo.saveContact.bind(repo);
    const discarded = A.addContact(sampleContact({ name: 'Weg damit' }));
    const kept = A.addContact(sampleContact({ name: 'Behalten', customerNumber: 'K-0002' }));
    repo.saveContact = async (c) => (c.id === discarded ? newer() : err({ kind: 'invalid', cause: new Error('foreign file') }));
    await persister.flush();
    expect(A.useApp.getState().unsaved.map((u) => u.key).sort()).toEqual([`contact:${discarded}`, `contact:${kept}`].sort());
    persister.discard(`contact:${discarded}`);
    expect(copyOf().contacts.map((c: { id: string }) => c.id)).toEqual([kept]);
    repo.saveContact = orig;
  });
});

describe('Persister: the emergency copy (#95)', () => {
  it('a copy the browser cannot keep (storage full) is reported, not dropped silently', async () => {
    repo.saveCompany = async () => err({ kind: 'permission', cause: new Error('denied') });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      A.updateCompany({ owner: 'Erika M.' });
      await persister.flush();
      expect(A.useApp.getState().emergencyCopyFailed).toBe(true);
    } finally {
      setItem.mockRestore();
    }
    persister.writeEmergencyCopy();
    expect(A.useApp.getState().emergencyCopyFailed).toBe(false);
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

describe('Persister with expenses', () => {
  const expensesOnDisk = async () => must(await new FsRepository(root.asHandle()).loadExpenses()).expenses;

  it('writes a new expense, its changes and its deletion', async () => {
    const id = A.addExpense(sampleExpense());
    await persister.flush();
    expect((await expensesOnDisk()).map((e) => e.supplier)).toEqual(['Telekom']);

    A.updateExpense(id, sampleExpense({ supplier: 'Telekom AG' }));
    const stamped = A.useApp.getState().expenses.get(id)!;
    expect(stamped.fieldUpdatedAt.supplier! > stamped.createdAt).toBe(true);
    expect(stamped.fieldUpdatedAt.gross).toBe(stamped.createdAt);
    await persister.flush();
    expect((await expensesOnDisk())[0]?.supplier).toBe('Telekom AG');

    A.deleteExpense(id);
    await persister.flush();
    const [deleted] = await expensesOnDisk();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.fieldUpdatedAt.deletedAt).toBe(deleted?.deletedAt);
  });

  it('keeps the account of the company the money left, so that the file names it', async () => {
    const accountId = A.useApp.getState().company!.bank.defaultAccountId;
    A.addExpense(sampleExpense({ accountId }));
    await persister.flush();
    expect((await expensesOnDisk())[0]?.accountId).toBe(accountId);
  });

  it('keeps unsaved expenses in the emergency copy', async () => {
    const orig = repo.saveExpense.bind(repo);
    repo.saveExpense = async () => err({ kind: 'quota', cause: new Error('full') });
    const id = A.addExpense(sampleExpense({ supplier: 'Unsaved' }));
    await persister.flush();
    const company = A.useApp.getState().company!;
    const copy = JSON.parse(localStorage.getItem(emergencyKey(company.id)) ?? 'null');
    expect(copy.expenses.map((e: { id: string }) => e.id)).toEqual([id]);
    repo.saveExpense = orig;
    await persister.retry();
    expect((await expensesOnDisk()).map((e) => e.supplier)).toEqual(['Unsaved']);
  });
});

describe('Persister with payouts', () => {
  const payoutsOnDisk = async () => must(await new FsRepository(root.asHandle()).loadPayouts()).payouts;
  const accountId = () => A.useApp.getState().company!.bank.defaultAccountId;
  const profile = (over = {}) => samplePayout(accountId(), A.addContact(sampleContact({ name: 'Apple', customerNumber: '' })), over);

  it('writes a new payout, its changes and its deletion; every changed field is stamped', async () => {
    const base = profile();
    const id = A.addPayout(base)!;
    expect(id).toBeTruthy();
    await persister.flush();
    expect((await payoutsOnDisk()).map((p) => p.amount)).toEqual([123_456]);

    expect(A.updatePayout(id, { ...base, note: 'Oktober' })).toBe(true);
    const stamped = A.useApp.getState().payouts.get(id)!;
    expect(stamped.fieldUpdatedAt.note! > stamped.createdAt).toBe(true);
    expect(stamped.fieldUpdatedAt.amount).toBe(stamped.createdAt);
    await persister.flush();
    expect((await payoutsOnDisk())[0]?.note).toBe('Oktober');

    A.deletePayout(id);
    await persister.flush();
    const [deleted] = await payoutsOnDisk();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.fieldUpdatedAt.deletedAt).toBe(deleted?.deletedAt);
    expect(A.updatePayout(id, { ...base, note: 'after delete' })).toBe(false);
  });

  it('does not book a payout whose payer or account is not known', () => {
    expect(A.addPayout(samplePayout(accountId(), 'no-such-contact'))).toBeNull();
    expect(A.addPayout(samplePayout('no-such-account', A.addContact(sampleContact({ customerNumber: '' }))))).toBeNull();
    expect(A.useApp.getState().payouts.size).toBe(0);
  });

  it('keeps unsaved payouts in the emergency copy', async () => {
    const orig = repo.savePayout.bind(repo);
    repo.savePayout = async () => err({ kind: 'quota', cause: new Error('full') });
    const id = A.addPayout(profile({ note: 'Unsaved' }))!;
    await persister.flush();
    const company = A.useApp.getState().company!;
    const copy = JSON.parse(localStorage.getItem(emergencyKey(company.id)) ?? 'null');
    expect(copy.payouts.map((p: { id: string }) => p.id)).toEqual([id]);
    repo.savePayout = orig;
    await persister.retry();
    expect((await payoutsOnDisk()).map((p) => p.note)).toEqual(['Unsaved']);
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

describe('issued invoices in the store', () => {
  it('can be neither changed nor deleted', () => {
    const customer = A.addContact(sampleContact());
    const account = A.useApp.getState().company!.bank.defaultAccountId;
    const id = A.addInvoice(customer, account, sampleInvoice(), null);
    const draft = A.useApp.getState().documents.get(id);
    if (draft?.kind !== 'invoice') throw new Error('expected an invoice');
    A.putIssuedDocument({ ...draft, issued: sampleIssued() });
    const issued = A.useApp.getState().documents.get(id);
    A.updateInvoice(id, customer, account, sampleInvoice({ subject: 'X' }));
    A.deleteDocument(id);
    expect(A.useApp.getState().documents.get(id)).toBe(issued);
  });

  it('neither can a finalized quote', () => {
    const customer = A.addContact(sampleContact());
    const id = A.addQuote(customer, sampleQuote());
    const draft = A.useApp.getState().documents.get(id);
    if (draft?.kind !== 'quote') throw new Error('expected a quote');
    expect(draft.issued).toBeNull();
    A.putIssuedDocument({ ...draft, issued: sampleIssued('AN-2026-0001') });
    const finalized = A.useApp.getState().documents.get(id);
    A.updateQuote(id, customer, sampleQuote({ subject: 'X' }));
    A.deleteDocument(id);
    expect(A.useApp.getState().documents.get(id)).toBe(finalized);
    expect(finalized?.issued?.number).toBe('AN-2026-0001');
  });

  it('a new version knows the quote it replaces, also after a change', () => {
    const customer = A.addContact(sampleContact());
    const revises = { id: brandId<'DocumentId'>('q1'), number: 'AN-2026-0001', date: '2026-10-22', firstNumber: 'AN-2026-0001', version: 2 };
    const id = A.addQuote(customer, sampleQuote(), revises);
    A.updateQuote(id, customer, sampleQuote({ subject: 'Geändert' }));
    expect(A.useApp.getState().documents.get(id)).toMatchObject({ subject: 'Geändert', issued: null, revises });
  });
});

describe('payments', () => {
  const invoiceId = brandId<'DocumentId'>('1b4e28ba-2fa1-41d2-883f-0016d3cca427');
  const payment = () => makePayment(invoiceId, { date: '2026-11-02', amount: cents(5_000), accountId: A.useApp.getState().company!.bank.defaultAccountId, note: '' });

  it('writes a payment that was put into the store to payments/', async () => {
    const p = payment();
    A.putWrittenPayment(p);
    await persister.flush();
    expect(must(await new FsRepository(root.asHandle()).loadPayments()).payments).toEqual([p]);
  });

  it('keeps a payment that cannot be written in the emergency copy until it is saved', async () => {
    const orig = repo.savePayment.bind(repo);
    repo.savePayment = async () => err({ kind: 'permission', cause: new Error('denied') });
    const p = payment();
    A.putWrittenPayment(p);
    await persister.flush();
    const copy = JSON.parse(localStorage.getItem(emergencyKey(A.useApp.getState().company!.id)) ?? 'null');
    expect(copy.payments.map((x: { id: string }) => x.id)).toEqual([p.id]);

    repo.savePayment = orig;
    await persister.flush();
    expect(must(await new FsRepository(root.asHandle()).loadPayments()).payments.map((x) => x.id)).toEqual([p.id]);
  });
});
