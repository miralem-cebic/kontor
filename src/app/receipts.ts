// Receipts (Belege) of expenses, Phase 3 of the roadmap. A file the person picks is copied into the company folder under
// belege/<year>/ and is never overwritten; a link is kept as the link. The expense records which receipt it has; each
// change appends an audit line. A removed receipt's file stays in the folder. The rules are in domain/receipt.ts; the
// folder is reached through the session.

import type { FsRepository } from '../data/fs/FsRepository';
import type { ExpenseId } from '../data/ids';
import type { StorageErrorKind } from '../data/repository';
import { nowIso } from '../data/schema';
import type { AuditExpenseEntry, AuditReceipt, ExpenseFile } from '../data/types';
import { checkReceiptFile, isReceiptLink, receiptFileName, receiptTypeOf, type Receipt, type ReceiptType } from '../domain/receipt';
import { sha256Hex } from '../lib/sha256';
import { setExpenseReceipt, useApp } from '../store/appStore';
import { deviceId } from './issue';
import { currentRepository } from './session';

/** What can go wrong: no folder, no expense, a file that is not a receipt, a link that is not one, a file that changed, or a folder error */
export type ReceiptFailure = 'notReady' | 'expense' | 'empty' | 'tooLarge' | 'type' | 'link' | 'changed' | 'audit' | StorageErrorKind;

/** A file the person picked */
export interface PickedFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

const current = (id: ExpenseId): ExpenseFile | null => {
  const expense = useApp.getState().expenses.get(id);
  return expense && !expense.deletedAt ? expense : null;
};

/** The receipt as an audit line names it */
const auditOf = (r: Receipt): AuditReceipt => (r.kind === 'file' ? { kind: 'file', year: r.year, name: r.name, sha256: r.sha256 } : { kind: 'link', url: r.url });

/**
 * Sets the receipt of the expense, then appends the audit lines: the removed receipt, then the new one. The change is
 * kept when the audit line cannot be written, and that is reported.
 */
async function commit(id: ExpenseId, receipt: Receipt | null, previous: Receipt | null, repo: FsRepository): Promise<ReceiptFailure | null> {
  setExpenseReceipt(id, receipt);
  const at = nowIso();
  const lines: AuditExpenseEntry[] = [];
  if (previous) lines.push({ at, action: 'detachReceipt', expenseId: id, receipt: auditOf(previous), device: deviceId() });
  if (receipt) lines.push({ at, action: 'attachReceipt', expenseId: id, receipt: auditOf(receipt), device: deviceId() });
  for (const line of lines) {
    const written = await repo.appendAudit(at.slice(0, 7), line);
    if (!written.ok) return 'audit';
  }
  return null;
}

/** Copies a picked file into belege/<year>/ of the expense's year and makes it the receipt of the expense */
export async function attachReceiptFile(id: ExpenseId, file: PickedFile): Promise<ReceiptFailure | null> {
  const repo = currentRepository();
  if (!repo) return 'notReady';
  const expense = current(id);
  if (!expense) return 'expense';
  const problem = checkReceiptFile({ size: file.bytes.length, type: file.type });
  if (problem) return problem;
  const type = receiptTypeOf(file.type);
  if (type === null) return 'type';
  const year = expense.date.slice(0, 4);
  const sha256 = await sha256Hex(file.bytes.slice());
  let name = receiptFileName(id, file.name, type);
  let written = await repo.writeReceipt(year, name, file.bytes);
  // another receipt of this expense has that name: the start of its checksum makes the name of this one
  if (!written.ok && written.error.kind === 'conflict') {
    name = receiptFileName(id, file.name, type, sha256.slice(0, 8));
    written = await repo.writeReceipt(year, name, file.bytes);
  }
  if (!written.ok) return written.error.kind;
  return commit(id, { kind: 'file', year, name, type, size: file.bytes.length, sha256 }, expense.receipt, repo);
}

/** Makes an http or https link the receipt of the expense; the receipt is kept where the link points */
export async function attachReceiptLink(id: ExpenseId, url: string): Promise<ReceiptFailure | null> {
  const repo = currentRepository();
  if (!repo) return 'notReady';
  const expense = current(id);
  if (!expense) return 'expense';
  if (!isReceiptLink(url)) return 'link';
  return commit(id, { kind: 'link', url }, expense.receipt, repo);
}

/** Takes the receipt off the expense. The file of a receipt stays in the folder. */
export async function removeReceipt(id: ExpenseId): Promise<ReceiptFailure | null> {
  const repo = currentRepository();
  if (!repo) return 'notReady';
  const expense = current(id);
  if (!expense) return 'expense';
  if (!expense.receipt) return null;
  return commit(id, null, expense.receipt, repo);
}

/** The file of a receipt for the person to save. Its SHA-256 and size are checked first: a file that changed is not handed out. */
export async function openReceiptFile(id: ExpenseId): Promise<{ bytes: Uint8Array; name: string; type: ReceiptType } | ReceiptFailure> {
  const repo = currentRepository();
  if (!repo) return 'notReady';
  const receipt = current(id)?.receipt;
  if (!receipt || receipt.kind !== 'file') return 'expense';
  const res = await repo.readReceipt(receipt.year, receipt.name);
  if (!res.ok) return res.error.kind;
  const bytes = new Uint8Array(await res.value.arrayBuffer());
  if (bytes.length !== receipt.size || (await sha256Hex(bytes.slice())) !== receipt.sha256) return 'changed';
  return { bytes, name: receipt.name, type: receipt.type };
}
