import { integrateWrittenCompany, integrateWrittenContact, integrateWrittenDocument, integrateWrittenDunning, integrateWrittenExpense, integrateWrittenItem, integrateWrittenPayment, integrateWrittenPayout, integrateWrittenQuoteStatus, setEmergencyCopyFailed, setSaveStatus, setUnsaved, useApp, type AppState } from '../store/appStore';
import { hmacSha256Hex, sameDigest } from '../lib/hmac';
import type { CompanyId } from './ids';
import { classifyError, type Repository, type StorageError, type StorageErrorKind } from './repository';
import { err, ok, type Result } from './result';
import type { CompanyFile, ContactFile, DocumentFile, DunningFile, ExpenseFile, ItemFile, PaymentFile, PayoutFile, QuoteStatusFile } from './types';

// Watches the app state and writes what changed, debounced. Objects that come from the folder or were already
// written are kept in `clean` and do not trigger another write. When a write fails, the change stays in the queue
// and an emergency copy is kept in localStorage until it was written. A change the folder refuses for good (a newer or
// damaged file, a conflict) waits apart in `stuck`: the other records are still written, the status is "saved", and
// the change is listed until it is written ("Try again", a new change of it) or discarded.

export const DEBOUNCE_MS = 400;
/** After a failure that may pass by itself (a file in use, an unexpected error), the queue is tried again after these delays */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000, 30_000, 60_000, 120_000];
/** Failures that can pass without the person doing anything; the others wait for "Try again" or a new change */
const RETRIED: readonly StorageErrorKind[] = ['locked', 'other'];
/** Failures of one record that trying again does not fix: the record waits apart and does not hold up the others */
const PERMANENT: readonly StorageErrorKind[] = ['newerSchema', 'invalid', 'conflict'];

/** The collection of the store a persister key (`contact:<id>`) belongs to; `company` is the company itself */
const COLLECTIONS = {
  contact: 'contacts',
  item: 'items',
  document: 'documents',
  payment: 'payments',
  dunning: 'dunnings',
  quoteStatus: 'quoteStatuses',
  expense: 'expenses',
  payout: 'payouts',
} as const satisfies Record<string, keyof AppState>;

/** The record of the store a persister key stands for, or undefined */
function recordOf(state: AppState, key: string): object | null | undefined {
  if (key === 'company') return state.company;
  const at = key.indexOf(':');
  const collection = COLLECTIONS[key.slice(0, at) as keyof typeof COLLECTIONS] as (typeof COLLECTIONS)[keyof typeof COLLECTIONS] | undefined;
  if (at < 0 || !collection) return undefined;
  return (state[collection] as ReadonlyMap<string, object>).get(key.slice(at + 1));
}
/**
 * Where the emergency copy of a company is kept: `<signature>.<copy as JSON>`, the signature an HMAC-SHA-256 with the key
 * of the folder (#69). Every page under file:// shares this storage, so a copy is used only with the folder's signature.
 */
export const emergencyKey = (id: CompanyId) => `kontor.unsaved.v2.${id}`;
/** The unsigned copies of earlier versions: never used, only removed */
export const legacyEmergencyKey = (id: CompanyId) => `kontor.unsaved.v1.${id}`;

const SIGNED = /^([0-9a-f]{64})\.([\s\S]*)$/;

/** The copy as it is stored: the signature over the JSON, a dot, and the JSON */
export const signCopy = (json: string, key: Uint8Array): string => `${hmacSha256Hex(key, json)}.${json}`;

/** A stored copy, if it carries the signature of the folder's key; its content is still unchecked data */
export function readEmergencyCopy(raw: string, key: Uint8Array): { ok: true; copy: unknown } | { ok: false } {
  const m = SIGNED.exec(raw);
  if (!m || !sameDigest(m[1] as string, hmacSha256Hex(key, m[2] as string))) return { ok: false };
  try {
    return { ok: true, copy: JSON.parse(m[2] as string) };
  } catch {
    return { ok: false };
  }
}

type Job = () => Promise<Result<void, StorageError>>;

export class Persister {
  private clean = new WeakSet<object>();
  private queue = new Map<string, Job>();
  /** Changes the folder refused for good, by key; they are not in the queue */
  private stuck = new Map<string, { job: Job; kind: StorageErrorKind }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private failed = false;
  /** The kind of the last failed write, null after a flush that wrote everything */
  private lastFailure: StorageErrorKind | null = null;
  /** How many automatic retries were made since the last success or "Try again" */
  private retries = 0;

  /** `copyKey` signs the emergency copy (Repository.copyKey); without it, no copy is kept and the person is told */
  constructor(
    private readonly repo: Repository,
    private readonly copyKey: Uint8Array | null,
  ) {}

  /** Starts watching; the state at this moment counts as saved */
  start() {
    const { company, contacts, items, documents, payments, dunnings, quoteStatuses, expenses, payouts } = useApp.getState();
    if (company) this.clean.add(company);
    for (const c of contacts.values()) this.clean.add(c);
    for (const i of items.values()) this.clean.add(i);
    for (const d of documents.values()) this.clean.add(d);
    for (const p of payments.values()) this.clean.add(p);
    for (const d of dunnings.values()) this.clean.add(d);
    for (const q of quoteStatuses.values()) this.clean.add(q);
    for (const e of expenses.values()) this.clean.add(e);
    for (const p of payouts.values()) this.clean.add(p);
    this.unsubscribe = useApp.subscribe((next, prev) => this.diff(next, prev));
    window.addEventListener('beforeunload', this.onUnload);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('beforeunload', this.onUnload);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get pending() {
    return this.queue.size > 0 || !!this.running;
  }

  private onUnload = (e: BeforeUnloadEvent) => {
    if (!this.pending) return;
    this.writeEmergencyCopy();
    e.preventDefault();
  };

  private diff(next: AppState, prev: AppState) {
    this.diffRecords(next.contacts, prev.contacts, (c) => this.enqueueContact(c));
    this.diffRecords(next.items, prev.items, (i) => this.enqueueItem(i));
    this.diffRecords(next.documents, prev.documents, (d) => this.enqueueDocument(d));
    this.diffRecords(next.payments, prev.payments, (p) => this.enqueuePayment(p));
    this.diffRecords(next.dunnings, prev.dunnings, (d) => this.enqueueDunning(d));
    this.diffRecords(next.quoteStatuses, prev.quoteStatuses, (q) => this.enqueueQuoteStatus(q));
    this.diffRecords(next.expenses, prev.expenses, (e) => this.enqueueExpense(e));
    this.diffRecords(next.payouts, prev.payouts, (p) => this.enqueuePayout(p));
    const company = next.company;
    if (!company || company === prev.company || this.clean.has(company)) return;
    this.enqueue('company', async () => {
      const r = await this.repo.saveCompany(company);
      if (!r.ok) return r;
      if (r.value === company) this.clean.add(company);
      else {
        // merged with a change from another device: the merged state is what the folder holds now. Local edits
        // made during the write are merged on top and written again by the next diff.
        this.clean.add(r.value);
        integrateWrittenCompany(company, r.value);
      }
      return ok(undefined);
    });
  }

  /** Queues every record of a collection that changed and was not written yet */
  private diffRecords<K, T extends { id: K }>(next: ReadonlyMap<K, T>, prev: ReadonlyMap<K, T>, enqueue: (record: T) => void) {
    if (next === prev) return;
    for (const record of next.values()) {
      if (record !== prev.get(record.id) && !this.clean.has(record)) enqueue(record);
    }
  }

  private enqueueExpense(expense: ExpenseFile) {
    this.enqueue(`expense:${expense.id}`, async () => {
      const r = await this.repo.saveExpense(expense);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== expense) integrateWrittenExpense(expense, r.value);
      return ok(undefined);
    });
  }

  private enqueuePayout(payout: PayoutFile) {
    this.enqueue(`payout:${payout.id}`, async () => {
      const r = await this.repo.savePayout(payout);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== payout) integrateWrittenPayout(payout, r.value);
      return ok(undefined);
    });
  }

  private enqueueItem(item: ItemFile) {
    this.enqueue(`item:${item.id}`, async () => {
      const r = await this.repo.saveItem(item);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== item) integrateWrittenItem(item, r.value);
      return ok(undefined);
    });
  }

  private enqueueDocument(document: DocumentFile) {
    this.enqueue(`document:${document.id}`, async () => {
      const r = await this.repo.saveDocument(document);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== document) integrateWrittenDocument(document, r.value);
      return ok(undefined);
    });
  }

  private enqueueDunning(dunning: DunningFile) {
    this.enqueue(`dunning:${dunning.id}`, async () => {
      const r = await this.repo.saveDunning(dunning);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== dunning) integrateWrittenDunning(dunning, r.value);
      return ok(undefined);
    });
  }

  private enqueueQuoteStatus(quoteStatus: QuoteStatusFile) {
    this.enqueue(`quoteStatus:${quoteStatus.id}`, async () => {
      const r = await this.repo.saveQuoteStatus(quoteStatus);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== quoteStatus) integrateWrittenQuoteStatus(quoteStatus, r.value);
      return ok(undefined);
    });
  }

  private enqueuePayment(payment: PaymentFile) {
    this.enqueue(`payment:${payment.id}`, async () => {
      const r = await this.repo.savePayment(payment);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== payment) integrateWrittenPayment(payment, r.value);
      return ok(undefined);
    });
  }

  private enqueueContact(contact: ContactFile) {
    this.enqueue(`contact:${contact.id}`, async () => {
      const r = await this.repo.saveContact(contact);
      if (!r.ok) return r;
      this.clean.add(r.value);
      if (r.value !== contact) integrateWrittenContact(contact, r.value);
      return ok(undefined);
    });
  }

  private enqueue(key: string, job: Job) {
    this.queue.set(key, job); // a newer version replaces an older one
    if (this.stuck.delete(key)) this.publishStuck(); // and is tried again
    if (useApp.getState().save.state !== 'error') setSaveStatus({ state: 'saving' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Runs all pending writes now. Failed ones stay in the queue. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      await this.running;
      if (this.queue.size && !this.failed) return this.flush();
      return;
    }
    this.running = (async () => {
      this.failed = false;
      for (const [key, job] of this.queue) {
        this.queue.delete(key);
        // a failed result is the normal case; an exception in the job itself counts as a failure too
        const r: Result<void, StorageError> = await job().catch((cause: unknown) => err({ kind: classifyError(cause), cause }));
        if (!r.ok && PERMANENT.includes(r.error.kind)) {
          // trying again does not help: the record waits apart (unless it changed meanwhile) and the others go on
          if (!this.queue.has(key)) this.stuck.set(key, { job, kind: r.error.kind });
          console.warn('The folder refused a change', key, r.error.cause);
          continue;
        }
        if (!r.ok) {
          if (!this.queue.has(key)) this.queue.set(key, job);
          this.failed = true;
          this.lastFailure = r.error.kind;
          setSaveStatus({ state: 'error', kind: r.error.kind });
          this.publishStuck();
          this.writeEmergencyCopy();
          console.warn('Saving failed', key, r.error.cause);
          this.scheduleRetry(r.error.kind);
          return;
        }
      }
      this.lastFailure = null;
      this.retries = 0;
      setSaveStatus({ state: 'saved' });
      this.publishStuck();
      // the stuck changes stay in the copy; without them, there is nothing to keep
      this.writeEmergencyCopy();
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  /** A failure that may pass by itself is tried again later, with growing delays; a new change flushes earlier */
  private scheduleRetry(kind: StorageErrorKind) {
    const delay = RETRY_DELAYS_MS[this.retries];
    if (!RETRIED.includes(kind) || delay === undefined || this.timer) return;
    this.retries++;
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /**
   * "Try again" after a failed write. When the folder refused access, `requestAccess` asks for the permission first;
   * it must run from the click, which is the user gesture the browser needs. Refused again, nothing is written.
   */
  async retry(requestAccess?: () => Promise<boolean>): Promise<void> {
    if (requestAccess && (this.lastFailure === 'permission' || this.lastFailure === 'notFound')) {
      const granted = await requestAccess().catch(() => false);
      if (!granted) return;
    }
    this.retries = 0;
    // the changes the folder refused are tried again too: the file may have been fixed in the meantime
    for (const [key, { job }] of this.stuck) if (!this.queue.has(key)) this.queue.set(key, job);
    this.stuck.clear();
    setSaveStatus({ state: 'saving' });
    return this.flush();
  }

  /**
   * Drops a change the folder refused: it is not written, and it leaves the list and the emergency copy. The store
   * still holds it; the session reads the company from the folder again afterwards.
   */
  discard(key: string) {
    if (!this.stuck.delete(key)) return;
    const record = recordOf(useApp.getState(), key);
    if (record) this.clean.add(record);
    this.publishStuck();
    this.writeEmergencyCopy();
  }

  private publishStuck() {
    const unsaved = [...this.stuck].map(([key, { kind }]) => ({ key, kind }));
    const current = useApp.getState().unsaved;
    if (unsaved.length || current.length) setUnsaved(unsaved);
  }

  /** Copy of the unsaved company and records in the browser, in case the folder cannot be reached (also after a crash) */
  writeEmergencyCopy() {
    const { company, contacts, items, documents, payments, dunnings, quoteStatuses, expenses, payouts } = useApp.getState();
    if (!company) return;
    const dirty = <T extends object>(records: ReadonlyMap<unknown, T>) => [...records.values()].filter((r) => !this.clean.has(r));
    const copy: EmergencyCopy = {
      at: new Date().toISOString(),
      company: this.clean.has(company) ? null : company,
      contacts: dirty(contacts),
      items: dirty(items),
      documents: dirty(documents),
      payments: dirty(payments),
      dunnings: dirty(dunnings),
      quoteStatuses: dirty(quoteStatuses),
      expenses: dirty(expenses),
      payouts: dirty(payouts),
    };
    // nothing unsaved: an older copy has nothing left to keep
    if (!copy.company && !copy.contacts.length && !copy.items.length && !copy.documents.length && !copy.payments.length && !copy.dunnings.length && !copy.quoteStatuses.length && !copy.expenses.length && !copy.payouts.length) return this.clearEmergencyCopy();
    try {
      // an unsigned copy would be thrown away when it is read: without the key, there is none
      if (!this.copyKey) throw new Error('No key of the folder to sign the emergency copy with');
      localStorage.setItem(emergencyKey(company.id), signCopy(JSON.stringify(copy), this.copyKey));
      setEmergencyCopyFailed(false);
    } catch (e) {
      // the storage is full (about 5 MB) or blocked: the changes are only in this window, and the person is told so
      console.warn('Could not keep the emergency copy', e);
      setEmergencyCopyFailed(true);
    }
  }

  private clearEmergencyCopy() {
    const company = useApp.getState().company;
    if (!company) return;
    setEmergencyCopyFailed(false);
    try {
      localStorage.removeItem(emergencyKey(company.id));
    } catch {
      /* storage not available */
    }
  }
}

/** What the emergency copy holds. Copies written before contacts, items, documents, payments, expenses or payouts existed lack those lists. */
export interface EmergencyCopy {
  at: string;
  /** null when only records were unsaved */
  company: CompanyFile | null;
  contacts: ContactFile[];
  items: ItemFile[];
  documents: DocumentFile[];
  payments: PaymentFile[];
  dunnings: DunningFile[];
  quoteStatuses: QuoteStatusFile[];
  expenses: ExpenseFile[];
  payouts: PayoutFile[];
}
