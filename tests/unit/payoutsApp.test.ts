import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookPayout, changePayout, removePayout, type PayoutContext } from '../../src/app/payouts';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { Persister } from '../../src/data/persister';
import { err, must } from '../../src/data/result';
import type { ContactId } from '../../src/data/ids';
import { cents } from '../../src/domain/money';
import * as A from '../../src/store/appStore';
import { MemoryStorage, sampleCompany, sampleContact, samplePayout } from './fixtures';

// Booking a payout: the store changes, the persister writes the file, and the audit log gets a line
// (`bookPayout`, `changePayout`, `deletePayout`). The form has checked the content already (readPayout).

beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} }, localStorage: new MemoryStorage() });
});

let root: MemDir;
let repo: FsRepository;
let persister: Persister;
let payerId: ContactId;
let accountId: string;

beforeEach(async () => {
  root = new MemDir('Muster Design');
  repo = new FsRepository(root.asHandle());
  must(await repo.createCompany(sampleCompany(), []));
  A.resetApp();
  A.loadCompany(must(await repo.readCompany()), { contacts: [], items: [], documents: [], payments: [], dunnings: [], quoteStatuses: [], expenses: [], payouts: [] });
  persister = new Persister(repo, new Uint8Array(32));
  persister.start();
  payerId = A.addContact(sampleContact({ name: 'Apple Distribution International', customerNumber: '' }));
  accountId = A.useApp.getState().company!.bank.defaultAccountId;
  await persister.flush();
});

afterEach(() => persister.stop());

const ctx = (day = '2026-11-03'): PayoutContext => ({
  repo,
  flush: async () => {
    await persister.flush();
    return A.useApp.getState().save.state === 'saved';
  },
  device: 'device-1',
  now: new Date(`${day}T10:00:00Z`),
});

const auditLines = async (month: string) => {
  const dir = await root.getDirectoryHandle('audit');
  const text = await (await (await dir.getFileHandle(`${month}.jsonl`)).getFile()).text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { at: string; action: string; payout: { id: string; date: string; amount: number; payerId: string; taxTreatment: string }; device: string });
};

const onDisk = async () => must(await new FsRepository(root.asHandle()).loadPayouts()).payouts;

describe('bookPayout', () => {
  it('writes the file and a bookPayout line with what the books count and the treatment the person chose', async () => {
    const r = await bookPayout(samplePayout(accountId, payerId), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.auditWritten).toBe(true);
    const [file] = await onDisk();
    expect(file?.id).toBe(r.id);
    expect(await auditLines('2026-11')).toEqual([
      { at: '2026-11-03T10:00:00.000Z', action: 'bookPayout', payout: { id: r.id, date: '2026-11-03', amount: 123_456, payerId, taxTreatment: 'euB2bNotTaxable' }, device: 'device-1' },
    ]);
  });

  it('refuses a payout whose payer is not a contact, and writes nothing', async () => {
    const r = await bookPayout(samplePayout(accountId, 'no-such-contact'), ctx());
    expect(r).toEqual({ ok: false, failure: 'notSaved' });
    expect(await onDisk()).toEqual([]);
    await expect(auditLines('2026-11')).rejects.toThrow();
  });

  it('keeps the payout when the audit line cannot be written, and says so', async () => {
    const orig = repo.appendAudit.bind(repo);
    repo.appendAudit = async () => err({ kind: 'quota', cause: new Error('full') });
    const r = await bookPayout(samplePayout(accountId, payerId), ctx());
    repo.appendAudit = orig;
    expect(r).toMatchObject({ ok: true, auditWritten: false });
    expect(await onDisk()).toHaveLength(1);
  });
});

describe('changePayout and removePayout', () => {
  it('a change is logged with the state after it; nothing is logged when nothing changed', async () => {
    const base = samplePayout(accountId, payerId);
    const booked = await bookPayout(base, ctx());
    if (!booked.ok) throw new Error('not booked');
    expect(await changePayout(booked.id, base, ctx('2026-11-04'))).toMatchObject({ ok: true, auditWritten: true });
    expect(await auditLines('2026-11')).toHaveLength(1);

    const changed = await changePayout(booked.id, { ...base, amount: cents(100_000), taxTreatment: 'thirdCountryB2bNotTaxable' }, ctx('2026-11-04'));
    expect(changed).toMatchObject({ ok: true, auditWritten: true });
    const lines = await auditLines('2026-11');
    expect(lines.map((l) => l.action)).toEqual(['bookPayout', 'changePayout']);
    expect(lines[1]?.payout).toMatchObject({ id: booked.id, amount: 100_000, taxTreatment: 'thirdCountryB2bNotTaxable' });
    expect((await onDisk())[0]?.amount).toBe(100_000);
  });

  it('removing is a soft delete that is logged; the file stays', async () => {
    const booked = await bookPayout(samplePayout(accountId, payerId), ctx());
    if (!booked.ok) throw new Error('not booked');
    expect(await removePayout(booked.id, ctx('2026-12-01'))).toMatchObject({ ok: true, auditWritten: true });
    const [file] = await onDisk();
    expect(file?.deletedAt).toBeTruthy();
    expect((await auditLines('2026-12')).map((l) => l.action)).toEqual(['deletePayout']);
    // twice is gone
    expect(await removePayout(booked.id, ctx('2026-12-01'))).toEqual({ ok: false, failure: 'gone' });
  });

  it('a payout that is gone cannot be changed', async () => {
    const booked = await bookPayout(samplePayout(accountId, payerId), ctx());
    if (!booked.ok) throw new Error('not booked');
    await removePayout(booked.id, ctx());
    expect(await changePayout(booked.id, samplePayout(accountId, payerId, { note: 'x' }), ctx())).toEqual({ ok: false, failure: 'gone' });
  });
});
