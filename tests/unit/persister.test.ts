import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { emergencyKey, Persister } from '../../src/data/persister';
import { err, must } from '../../src/data/result';
import { makeCompany, nowIso } from '../../src/data/schema';
import * as A from '../../src/store/appStore';
import { MemoryStorage, sampleContact, sampleProfile } from './fixtures';

beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} }, localStorage: new MemoryStorage() });
});

let root: MemDir;
let repo: FsRepository;
let persister: Persister;

beforeEach(async () => {
  root = new MemDir('c');
  repo = new FsRepository(root.asHandle());
  const company = makeCompany(sampleProfile());
  must(await repo.createCompany(company, []));
  A.resetApp();
  A.loadCompany(must(await repo.readCompany()), []);
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
