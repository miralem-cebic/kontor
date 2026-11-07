import type { PayoutId } from '../data/ids';
import type { Repository } from '../data/repository';
import type { AuditPayoutEntry, PayoutFile } from '../data/types';
import type { PayoutProfile } from '../domain/payout';
import { addPayout, deletePayout, updatePayout, useApp } from '../store/appStore';
import { deviceId } from './issue';
import { flushWrites, openRepository } from './session';

// Payouts (income without an invoice of kontor, see domain/payout.ts). The store changes first and the persister writes
// payouts/<id>.json; then a line is appended to the audit log: `bookPayout` when a payout is booked, `changePayout` when it
// was edited (the line holds the state after the change), `deletePayout` when it was removed (a soft delete, the file
// stays). The form has checked the content (readPayout); the store refuses an account or payer it does not know.

/** `notReady`: no open folder; `notSaved`: the account or payer is not known; `gone`: no such payout, or it is removed already */
export type PayoutFailure = 'notReady' | 'notSaved' | 'gone';

type Failed = { ok: false; failure: PayoutFailure };

/**
 * The payout is in the store; `saved` says whether the file was written (otherwise the emergency copy and the retry of the
 * sidebar hold it), `auditWritten` whether its line was appended.
 */
export type PayoutResult = { ok: true; id: PayoutId; saved: boolean; auditWritten: boolean } | Failed;

export interface PayoutContext {
  repo: Repository;
  /** Writes what is pending; true when everything is saved */
  flush: () => Promise<boolean>;
  /** The browser that books the payout, for the audit log */
  device: string;
  now: Date;
}

const fail = (failure: PayoutFailure): Failed => ({ ok: false, failure });

const current = (id: PayoutId): PayoutFile | null => {
  const payout = useApp.getState().payouts.get(id);
  return payout && !payout.deletedAt ? payout : null;
};

/** Writes the pending files, then appends the line about the payout as it is in the store */
async function logged(action: AuditPayoutEntry['action'], id: PayoutId, ctx: PayoutContext): Promise<PayoutResult> {
  const saved = await ctx.flush();
  const payout = useApp.getState().payouts.get(id);
  if (!payout) return fail('gone');
  const at = ctx.now.toISOString();
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action,
    payout: { id, date: payout.date, amount: payout.amount, payerId: payout.payerId, taxTreatment: payout.taxTreatment },
    device: ctx.device,
  } satisfies AuditPayoutEntry);
  return { ok: true, id, saved, auditWritten: audit.ok };
}

/** Books a payout from a checked profile */
export async function bookPayout(profile: PayoutProfile, ctx: PayoutContext): Promise<PayoutResult> {
  const id = addPayout(profile);
  if (id === null) return fail('notSaved');
  return logged('bookPayout', id, ctx);
}

/** Changes a payout; a change that changes nothing writes no line */
export async function changePayout(id: PayoutId, profile: PayoutProfile, ctx: PayoutContext): Promise<PayoutResult> {
  const before = current(id);
  if (!before) return fail('gone');
  if (!updatePayout(id, profile)) return fail('notSaved');
  if (useApp.getState().payouts.get(id) === before) return { ok: true, id, saved: true, auditWritten: true };
  return logged('changePayout', id, ctx);
}

/** Removes a payout: a soft delete, so the file stays and the payout no longer counts as income */
export async function removePayout(id: PayoutId, ctx: PayoutContext): Promise<PayoutResult> {
  if (!current(id)) return fail('gone');
  deletePayout(id);
  return logged('deletePayout', id, ctx);
}

/** The context of the open company: its folder, the pending writes of the persister and this browser */
function openContext(): PayoutContext | null {
  const repo = openRepository();
  return repo ? { repo, flush: flushWrites, device: deviceId(), now: new Date() } : null;
}

export async function bookPayoutOfOpenCompany(profile: PayoutProfile): Promise<PayoutResult> {
  const ctx = openContext();
  return ctx ? bookPayout(profile, ctx) : fail('notReady');
}

export async function changePayoutOfOpenCompany(id: PayoutId, profile: PayoutProfile): Promise<PayoutResult> {
  const ctx = openContext();
  return ctx ? changePayout(id, profile, ctx) : fail('notReady');
}

export async function removePayoutOfOpenCompany(id: PayoutId): Promise<PayoutResult> {
  const ctx = openContext();
  return ctx ? removePayout(id, ctx) : fail('notReady');
}
