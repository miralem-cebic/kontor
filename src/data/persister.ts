import { integrateWrittenCompany, integrateWrittenContact, setSaveStatus, useApp, type AppState } from '../store/appStore';
import type { CompanyId } from './ids';
import { classifyError, type Repository, type StorageError } from './repository';
import { err, ok, type Result } from './result';
import type { CompanyFile, ContactFile } from './types';

// Watches the app state and writes what changed, debounced. Objects that come from the folder or were already
// written are kept in `clean` and do not trigger another write. When a write fails, the change stays in the queue
// and an emergency copy is kept in localStorage until it was written.

export const DEBOUNCE_MS = 400;
export const emergencyKey = (id: CompanyId) => `kontor.unsaved.v1.${id}`;

type Job = () => Promise<Result<void, StorageError>>;

export class Persister {
  private clean = new WeakSet<object>();
  private queue = new Map<string, Job>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private failed = false;

  constructor(private readonly repo: Repository) {}

  /** Starts watching; the state at this moment counts as saved */
  start() {
    const { company, contacts } = useApp.getState();
    if (company) this.clean.add(company);
    for (const c of contacts.values()) this.clean.add(c);
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
    if (next.contacts !== prev.contacts) {
      for (const contact of next.contacts.values()) {
        if (contact !== prev.contacts.get(contact.id) && !this.clean.has(contact)) this.enqueueContact(contact);
      }
    }
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
        if (!r.ok) {
          if (!this.queue.has(key)) this.queue.set(key, job);
          this.failed = true;
          setSaveStatus({ state: 'error', kind: r.error.kind });
          this.writeEmergencyCopy();
          console.warn('Saving failed', key, r.error.cause);
          return;
        }
      }
      setSaveStatus({ state: 'saved' });
      this.clearEmergencyCopy();
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  /** After a failed write: try the queue again */
  retry() {
    setSaveStatus({ state: 'saving' });
    return this.flush();
  }

  /** Copy of the unsaved company and contacts in the browser, in case the folder cannot be reached (also after a crash) */
  writeEmergencyCopy() {
    const { company, contacts } = useApp.getState();
    if (!company) return;
    const dirty = [...contacts.values()].filter((c) => !this.clean.has(c));
    if (this.clean.has(company) && !dirty.length) return;
    try {
      const copy: EmergencyCopy = { at: new Date().toISOString(), company: this.clean.has(company) ? null : company, contacts: dirty };
      localStorage.setItem(emergencyKey(company.id), JSON.stringify(copy));
    } catch {
      /* storage not available */
    }
  }

  private clearEmergencyCopy() {
    const company = useApp.getState().company;
    if (!company) return;
    try {
      localStorage.removeItem(emergencyKey(company.id));
    } catch {
      /* storage not available */
    }
  }
}

/** What the emergency copy holds. Copies written before contacts existed have only `company`. */
export interface EmergencyCopy {
  at: string;
  /** null when only contacts were unsaved */
  company: CompanyFile | null;
  contacts: ContactFile[];
}
