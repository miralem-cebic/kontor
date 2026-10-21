import { beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir, MemFile } from '../../src/data/fs/memoryFs';
import { must } from '../../src/data/result';
import { makeCompany, makeContact, nowIso, SCHEMA_VERSION } from '../../src/data/schema';
import type { CompanyFile } from '../../src/data/types';
import { sampleContact, sampleProfile } from './fixtures';

let root: MemDir;
let repo: FsRepository;
let company: CompanyFile;

const text = async (dir: MemDir, name: string) => (await (await dir.getFileHandle(name)).getFile()).text();
const edit = (c: CompanyFile, patch: Partial<CompanyFile>, fields: (keyof CompanyFile['fieldUpdatedAt'])[]): CompanyFile => {
  const at = nowIso();
  return { ...c, ...patch, fieldUpdatedAt: { ...c.fieldUpdatedAt, ...Object.fromEntries(fields.map((f) => [f, at])) } };
};

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  company = makeCompany(sampleProfile());
  must(await repo.createCompany(company, []));
});

describe('FsRepository', () => {
  it('creates and reads a company', async () => {
    expect(root.children.has('company.json')).toBe(true);
    expect(JSON.parse(await text(root, 'company.json')).schemaVersion).toBe(SCHEMA_VERSION);
    expect(must(await new FsRepository(root.asHandle()).readCompany())).toEqual(company);
    expect(must(await repo.hasCompany())).toBe(true);
    expect(must(await repo.isEmpty())).toBe(false);
  });

  it('an empty folder has no company', async () => {
    const empty = new FsRepository(new MemDir('x').asHandle());
    expect(must(await empty.hasCompany())).toBe(false);
    expect(must(await empty.isEmpty())).toBe(true);
    expect((await empty.readCompany()).ok).toBe(false);
  });

  it('does not create a second company in the same folder', async () => {
    const r = await repo.createCompany(makeCompany(sampleProfile()), []);
    expect(r.ok || r.error.kind).toBe('invalid');
  });

  it('writes assets first and company.json last', async () => {
    const dir = new MemDir('new');
    const order: string[] = [];
    const getFile = dir.getFileHandle.bind(dir);
    const getDir = dir.getDirectoryHandle.bind(dir);
    dir.getFileHandle = async (name, opts) => (opts?.create && order.push(name), getFile(name, opts));
    dir.getDirectoryHandle = async (name, opts) => (opts?.create && order.push(`${name}/`), getDir(name, opts));
    must(await new FsRepository(dir.asHandle()).createCompany(company, [{ name: 'logo-0123456789abcdef.png', data: new Blob(['png']) }]));
    expect(order).toEqual(['assets/', 'company.json']);
  });

  it('merges a change made by another device field by field', async () => {
    const other = new FsRepository(root.asHandle());
    const theirs = must(await other.readCompany());
    must(await other.saveCompany(edit(theirs, { name: 'Changed elsewhere' }, ['name'])));
    // this device still has the old state and changes another field
    const mine = edit(company, { bank: { ...company.bank, bic: 'DEUTDEFF' } }, ['bank']);
    const written = must(await repo.saveCompany(mine));
    expect(written.name).toBe('Changed elsewhere');
    expect(written.bank.bic).toBe('DEUTDEFF');
    expect(must(await other.readCompany())).toEqual(written);
  });

  it('the later edit of a field wins, whichever device writes first', async () => {
    const mine = edit(company, { name: 'Mine, later' }, ['name']);
    await new Promise((r) => setTimeout(r, 2));
    const other = new FsRepository(root.asHandle());
    must(await other.readCompany());
    must(await other.saveCompany(edit(company, { name: 'Theirs, earlier' }, ['name'])));
    // "theirs" has the later stamp (it was made after "mine"), so it wins
    expect(must(await repo.saveCompany(mine)).name).toBe('Theirs, earlier');
  });

  it('returns the same object when nothing had to be merged', async () => {
    const mine = edit(company, { owner: 'E. Mustermann' }, ['owner']);
    expect(must(await repo.saveCompany(mine))).toBe(mine);
  });

  it('never overwrites company.json of another company or a newer version', async () => {
    const other = makeCompany(sampleProfile({ name: 'Another' }));
    const file = (await root.getFileHandle('company.json')) as MemFile;
    file.content = new Blob([JSON.stringify(other)]);
    file.lastModified += 10;
    const r = await repo.saveCompany(edit(company, { name: 'x' }, ['name']));
    expect(r.ok).toBe(false);
    expect(JSON.parse(await text(root, 'company.json')).name).toBe('Another');

    file.content = new Blob([JSON.stringify({ ...company, schemaVersion: SCHEMA_VERSION + 1 })]);
    file.lastModified += 10;
    const newer = await repo.saveCompany(company);
    expect(!newer.ok && newer.error.kind).toBe('newerSchema');
  });

  it('keeps an existing asset and refuses unsafe names', async () => {
    must(await repo.writeAsset({ name: 'logo-0123456789abcdef.png', data: new Blob(['first']) }));
    must(await repo.writeAsset({ name: 'logo-0123456789abcdef.png', data: new Blob(['second']) }));
    expect(await must(await repo.readAsset('logo-0123456789abcdef.png')).text()).toBe('first');
    for (const name of ['../company.json', 'a/b', '..', '']) {
      expect((await repo.writeAsset({ name, data: new Blob(['x']) })).ok).toBe(false);
      const read = await repo.readAsset(name);
      expect(!read.ok && read.error.kind).toBe('invalid');
    }
  });

  it('writes, lists and removes backups', async () => {
    must(await repo.writeBackup('2026-10-20', { company, contacts: [] }));
    must(await repo.writeBackup('2026-10-21', { company, contacts: [] }));
    expect(must(await repo.listBackups()).map((b) => b.name)).toEqual(['2026-10-21', '2026-10-20']);
    const backups = await root.getDirectoryHandle('backups');
    const backup = JSON.parse(await text(backups, '2026-10-21.json'));
    expect(backup).toMatchObject({ schemaVersion: SCHEMA_VERSION, company: { id: company.id } });
    must(await repo.removeBackup('2026-10-20'));
    expect(must(await repo.listBackups()).map((b) => b.name)).toEqual(['2026-10-21']);
    expect((await repo.writeBackup('../x', { company, contacts: [] })).ok).toBe(false);
  });
});

describe('contacts in the folder', () => {
  const contactsDir = async () => root.getDirectoryHandle('contacts', { create: true });

  it('saves and loads contacts, deleted ones included', async () => {
    const a = makeContact(sampleContact({ name: 'A' }));
    const b = { ...makeContact(sampleContact({ name: 'B', customerNumber: '' })), deletedAt: nowIso() };
    must(await repo.saveContact(a));
    must(await repo.saveContact(b));
    const { contacts, issues } = must(await new FsRepository(root.asHandle()).loadContacts());
    expect(issues).toEqual([]);
    expect(contacts.map((c) => c.name).sort()).toEqual(['A', 'B']);
    expect(JSON.parse(await text(await contactsDir(), `${a.id}.json`)).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('a broken file is reported, the others still load; conflict copies are not read', async () => {
    const ok1 = makeContact(sampleContact());
    must(await repo.saveContact(ok1));
    const dir = await contactsDir();
    const broken = makeContact(sampleContact());
    ((await dir.getFileHandle(`${broken.id}.json`, { create: true })) as MemFile).content = new Blob(['{ "id": 1 }']);
    const renamed = makeContact(sampleContact());
    ((await dir.getFileHandle('0f8fad5b-d9cb-469f-a165-70867728950e.json', { create: true })) as MemFile).content = new Blob([JSON.stringify(renamed)]);
    ((await dir.getFileHandle(`${ok1.id}-LAPTOP.json`, { create: true })) as MemFile).content = new Blob([JSON.stringify(ok1)]);
    const { contacts, issues } = must(await new FsRepository(root.asHandle()).loadContacts());
    expect(contacts.map((c) => c.id)).toEqual([ok1.id]);
    expect(issues.map((i) => i.file).sort()).toEqual([`contacts/${broken.id}.json`, 'contacts/0f8fad5b-d9cb-469f-a165-70867728950e.json'].sort());
  });

  it('merges a contact changed on another device, and a deletion survives a later edit elsewhere', async () => {
    const c = makeContact(sampleContact());
    must(await repo.saveContact(c));
    const other = new FsRepository(root.asHandle());
    const [theirs] = must(await other.loadContacts()).contacts;
    must(await other.saveContact({ ...theirs!, deletedAt: nowIso(), fieldUpdatedAt: { ...theirs!.fieldUpdatedAt, deletedAt: nowIso() } }));
    const mine = { ...c, notes: 'later note', fieldUpdatedAt: { ...c.fieldUpdatedAt, notes: nowIso() } };
    const written = must(await repo.saveContact(mine));
    expect(written.notes).toBe('later note');
    expect(written.deletedAt).not.toBeNull();
  });
});
