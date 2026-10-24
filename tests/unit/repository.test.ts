import { beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir, MemFile } from '../../src/data/fs/memoryFs';
import { must } from '../../src/data/result';
import { makeContact, makeInvoice, makeItem, makeQuote, nowIso, SCHEMA_VERSION } from '../../src/data/schema';
import { brandId } from '../../src/data/ids';
import type { CompanyFile } from '../../src/data/types';
import { cents } from '../../src/domain/money';
import { sampleCompany, sampleContact, sampleInvoice, sampleIssued, sampleItem, sampleQuote } from './fixtures';

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
  company = sampleCompany();
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
    const r = await repo.createCompany(sampleCompany(), []);
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
    const accounts = company.bank.accounts.map((a) => (a.kind === 'bank' ? { ...a, bic: 'DEUTDEFF' } : a));
    const mine = edit(company, { bank: { ...company.bank, accounts } }, ['bank']);
    const written = must(await repo.saveCompany(mine));
    expect(written.name).toBe('Changed elsewhere');
    expect(written.bank).toEqual(mine.bank);
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
    const other = sampleCompany({ name: 'Another' });
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
    must(await repo.writeBackup('2026-10-20', { company, contacts: [], items: [], documents: [] }));
    must(await repo.writeBackup('2026-10-21', { company, contacts: [], items: [], documents: [] }));
    expect(must(await repo.listBackups()).map((b) => b.name)).toEqual(['2026-10-21', '2026-10-20']);
    const backups = await root.getDirectoryHandle('backups');
    const backup = JSON.parse(await text(backups, '2026-10-21.json'));
    expect(backup).toMatchObject({ schemaVersion: SCHEMA_VERSION, company: { id: company.id } });
    must(await repo.removeBackup('2026-10-20'));
    expect(must(await repo.listBackups()).map((b) => b.name)).toEqual(['2026-10-21']);
    expect((await repo.writeBackup('../x', { company, contacts: [], items: [], documents: [] })).ok).toBe(false);
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

describe('items in the folder', () => {
  it('saves and loads items, deleted ones included', async () => {
    const a = makeItem(sampleItem({ name: 'A' }));
    const b = { ...makeItem(sampleItem({ name: 'B', number: '' })), deletedAt: nowIso() };
    must(await repo.saveItem(a));
    must(await repo.saveItem(b));
    const { items, issues } = must(await new FsRepository(root.asHandle()).loadItems());
    expect(issues).toEqual([]);
    expect(items.map((i) => i.name).sort()).toEqual(['A', 'B']);
    const dir = await root.getDirectoryHandle('items');
    expect(JSON.parse(await text(dir, `${a.id}.json`))).toMatchObject({ schemaVersion: SCHEMA_VERSION, netPrice: 8500, unit: 'HUR' });
  });

  it('a broken file is reported, the others still load', async () => {
    const good = makeItem(sampleItem());
    must(await repo.saveItem(good));
    const dir = await root.getDirectoryHandle('items');
    const broken = makeItem(sampleItem());
    ((await dir.getFileHandle(`${broken.id}.json`, { create: true })) as MemFile).content = new Blob([JSON.stringify({ ...broken, netPrice: 85.5 })]);
    const { items, issues } = must(await new FsRepository(root.asHandle()).loadItems());
    expect(items.map((i) => i.id)).toEqual([good.id]);
    expect(issues.map((i) => i.file)).toEqual([`items/${broken.id}.json`]);
  });

  it('merges an item changed on another device field by field', async () => {
    const item = makeItem(sampleItem());
    must(await repo.saveItem(item));
    const other = new FsRepository(root.asHandle());
    const [theirs] = must(await other.loadItems()).items;
    must(await other.saveItem({ ...theirs!, netPrice: cents(9500), fieldUpdatedAt: { ...theirs!.fieldUpdatedAt, netPrice: nowIso() } }));
    const mine = { ...item, name: 'Webdesign und Pflege', fieldUpdatedAt: { ...item.fieldUpdatedAt, name: nowIso() } };
    const written = must(await repo.saveItem(mine));
    expect(written).toMatchObject({ name: 'Webdesign und Pflege', netPrice: 9500 });
  });
});

describe('documents in the folder', () => {
  const customer = brandId<'ContactId'>('0f8fad5b-d9cb-469f-a165-70867728950e');

  it('saves and loads quotes, deleted ones included', async () => {
    const a = makeQuote(customer, sampleQuote());
    const b = { ...makeQuote(customer, sampleQuote({ subject: 'B', lines: [] })), deletedAt: nowIso() };
    must(await repo.saveDocument(a));
    must(await repo.saveDocument(b));
    const { documents, issues } = must(await new FsRepository(root.asHandle()).loadDocuments());
    expect(issues).toEqual([]);
    expect(documents.map((d) => d.subject).sort()).toEqual(['B', 'Website-Relaunch']);
    const dir = await root.getDirectoryHandle('documents');
    expect(JSON.parse(await text(dir, `${a.id}.json`))).toMatchObject({ schemaVersion: SCHEMA_VERSION, kind: 'quote', customerId: customer });
  });

  it('merges a quote changed on another device field by field; the lines change as a whole', async () => {
    const quote = makeQuote(customer, sampleQuote());
    must(await repo.saveDocument(quote));
    const other = new FsRepository(root.asHandle());
    const [theirs] = must(await other.loadDocuments()).documents;
    must(await other.saveDocument({ ...theirs!, lines: theirs!.lines.slice(0, 1), fieldUpdatedAt: { ...theirs!.fieldUpdatedAt, lines: nowIso() } }));
    const mine = { ...quote, subject: 'Neu', fieldUpdatedAt: { ...quote.fieldUpdatedAt, subject: nowIso() } };
    const written = must(await repo.saveDocument(mine));
    expect(written.subject).toBe('Neu');
    expect(written.lines).toHaveLength(1);
  });

  it('saves and loads invoices next to quotes', async () => {
    const quote = makeQuote(customer, sampleQuote());
    const invoice = makeInvoice(customer, company.bank.defaultAccountId, sampleInvoice(), quote.id);
    must(await repo.saveDocument(quote));
    must(await repo.saveDocument(invoice));
    const { documents, issues } = must(await new FsRepository(root.asHandle()).loadDocuments());
    expect(issues).toEqual([]);
    expect(documents.map((d) => d.kind).sort()).toEqual(['invoice', 'quote']);
    expect(documents.find((d) => d.kind === 'invoice')).toEqual(invoice);
    const dir = await root.getDirectoryHandle('documents');
    expect(JSON.parse(await text(dir, `${invoice.id}.json`))).toMatchObject({ schemaVersion: SCHEMA_VERSION, kind: 'invoice', quoteId: quote.id, service: sampleInvoice().service });
  });

  it('merges an invoice changed on another device field by field', async () => {
    const invoice = makeInvoice(customer, company.bank.defaultAccountId, sampleInvoice(), null);
    must(await repo.saveDocument(invoice));
    const other = new FsRepository(root.asHandle());
    const [theirs] = must(await other.loadDocuments()).documents;
    must(await other.saveDocument({ ...theirs!, paymentTermDays: 30, fieldUpdatedAt: { ...theirs!.fieldUpdatedAt, paymentTermDays: nowIso() } } as typeof invoice));
    const service = { kind: 'date', date: '2026-10-15' } as const;
    const written = must(await repo.saveDocument({ ...invoice, service, fieldUpdatedAt: { ...invoice.fieldUpdatedAt, service: nowIso() } }));
    expect(written).toMatchObject({ kind: 'invoice', service, paymentTermDays: 30 });
  });

  it('never merges a quote with an invoice of the same ID: the save stops and the file stays', async () => {
    const invoice = makeInvoice(customer, company.bank.defaultAccountId, sampleInvoice(), null);
    must(await repo.saveDocument(invoice));
    const dir = await root.getDirectoryHandle('documents');
    const before = await text(dir, `${invoice.id}.json`);
    const quote = { ...makeQuote(customer, sampleQuote()), id: invoice.id };
    const r = await new FsRepository(root.asHandle()).saveDocument(quote);
    expect(!r.ok && r.error.kind).toBe('invalid');
    expect(await text(dir, `${invoice.id}.json`)).toBe(before);
  });
});

describe('issued invoices in the folder', () => {
  const customer = brandId<'ContactId'>('0f8fad5b-d9cb-469f-a165-70867728950e');
  const draft = () => makeInvoice(customer, company.bank.defaultAccountId, sampleInvoice(), null);

  it('a draft saved on another device never overwrites the issued invoice: it gets the issued one back', async () => {
    const inv = draft();
    must(await repo.saveDocument(inv));
    const other = new FsRepository(root.asHandle());
    const [theirs] = must(await other.loadDocuments()).documents;
    const issued = { ...inv, issued: sampleIssued() };
    must(await repo.saveDocument(issued));
    const dir = await root.getDirectoryHandle('documents');
    const before = await text(dir, `${inv.id}.json`);
    const edited = { ...theirs!, subject: 'Geändert', fieldUpdatedAt: { ...theirs!.fieldUpdatedAt, subject: nowIso() } } as typeof inv;
    const written = must(await other.saveDocument(edited));
    expect(written).toMatchObject({ subject: 'Website-Relaunch', issued: { number: 'RE-2026-0001' } });
    expect(await text(dir, `${inv.id}.json`)).toBe(before);
  });

  it('an invoice issued with another number elsewhere stops the save', async () => {
    const inv = draft();
    must(await repo.saveDocument({ ...inv, issued: sampleIssued('RE-2026-0001') }));
    const r = await new FsRepository(root.asHandle()).saveDocument({ ...inv, issued: sampleIssued('RE-2026-0002') });
    expect(!r.ok && r.error.kind).toBe('conflict');
  });

  it('an issued file is written once and never replaced', async () => {
    must(await repo.writeIssuedFile('RE-2026-0001.pdf', new Uint8Array([37, 80, 68, 70])));
    const again = await repo.writeIssuedFile('RE-2026-0001.pdf', new Uint8Array([1, 2, 3]));
    expect(!again.ok && again.error.kind).toBe('conflict');
    expect([...must(await repo.readIssuedFile('RE-2026-0001.pdf'))]).toEqual([37, 80, 68, 70]);
    expect(must(await repo.listIssuedFiles())).toEqual(['RE-2026-0001.pdf']);
    expect((await repo.writeIssuedFile('../company.json', new Uint8Array([1]))).ok).toBe(false);
    expect((await repo.readIssuedFile('../company.json')).ok).toBe(false);
  });

  it('the range file is read back after it is written', async () => {
    expect(must(await repo.readNumbering('invoice'))).toBeNull();
    const file = {
      schemaVersion: SCHEMA_VERSION,
      range: 'invoice' as const,
      counters: [{ key: '2026', last: 1 }],
      reservations: [{ number: 'RE-2026-0001', counterKey: '2026', counter: 1, documentId: brandId<'DocumentId'>('d1'), device: 'dev-1', at: nowIso() }],
    };
    expect(must(await repo.writeNumbering(file))).toEqual(file);
    expect(must(await new FsRepository(root.asHandle()).readNumbering('invoice'))).toEqual(file);
  });

  it('audit entries are appended as JSON lines', async () => {
    const entry = { at: nowIso(), action: 'issue' as const, documentId: brandId<'DocumentId'>('d1'), number: 'RE-2026-0001', files: [{ file: 'RE-2026-0001.pdf', sha256: 'a'.repeat(64) }], device: 'dev-1' };
    must(await repo.appendAudit('2026-10', entry));
    must(await repo.appendAudit('2026-10', { ...entry, number: 'RE-2026-0002' }));
    const lines = (await text(await root.getDirectoryHandle('audit'), '2026-10.jsonl')).trimEnd().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as { number: string }).number)).toEqual(['RE-2026-0001', 'RE-2026-0002']);
    expect((await repo.appendAudit('../x', entry)).ok).toBe(false);
  });
});
