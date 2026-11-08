// One window per company (#97). ADR 0004 assumes one writer per company at a time; two windows of the same browser
// would each keep their own state and race for the next invoice number. While a company is open, its window holds a
// Web Lock named after the company. Another window does not get it and shows that the company is open elsewhere; it
// can take the company over, and then the first window saves what is open, closes the company and says so on the
// session channel, so that the new window loads only after that. This does not guard a second device (still the
// documented assumption), only the most likely accident: a second tab or a double click on index.html.

/** The part of the Web Locks API (navigator.locks) that is used here */
export type LockRequest = Pick<LockManager, 'request'>;

/** A held lock of a company; `release` gives it up when the company is closed */
export interface CompanyLock {
  release(): void;
}

const lockName = (companyId: string) => `kontor.company.${companyId}`;

/** A lock that guards nothing, for a browser without Web Locks: the company opens as before */
const unguarded: CompanyLock = { release: () => undefined };

/**
 * Takes the lock of a company for as long as it is open. Null when another window holds it; with `steal`, the lock is
 * taken from that window, whose `onLost` then runs. `onLost` runs only for a lock that is taken away, not for one that
 * was released. Without Web Locks, or when the browser refuses them, the company opens unguarded.
 */
export function acquireCompanyLock(locks: LockRequest | undefined, companyId: string, opts: { steal: boolean; onLost: () => void }): Promise<CompanyLock | null> {
  if (!locks) return Promise.resolve(unguarded);
  return new Promise((resolve) => {
    let granted = false;
    let released = false;
    let release = () => undefined as void;
    const held = new Promise<void>((done) => (release = done));
    const options: LockOptions = opts.steal ? { steal: true } : { ifAvailable: true };
    locks
      .request(lockName(companyId), options, (lock) => {
        if (!lock) return resolve(null);
        granted = true;
        resolve({
          release: () => {
            released = true;
            release();
          },
        });
        // the lock is held until this promise settles: until the company is closed
        return held;
      })
      .catch((e: unknown) => {
        // taken over by another window (AbortError): the company has to be closed here
        if (granted && !released) return opts.onLost();
        if (!granted) {
          console.warn('Web Locks are not available; the company is not guarded against a second window', e);
          resolve(unguarded);
        }
      });
  });
}

/** What the session channel carries: a window closed a company it had open */
export interface ClosedMessage {
  closed: string;
}

/** The part of a BroadcastChannel that waiting needs */
export interface ChannelLike {
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

/**
 * After taking a company over: waits until the other window says it closed the company (its last writes are done), at
 * most `ms`. True when it said so, false after the timeout or without a channel.
 */
export function waitForClosed(channel: ChannelLike | null, companyId: string, ms: number): Promise<boolean> {
  if (!channel) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (said: boolean) => {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      resolve(said);
    };
    const onMessage = (e: { data: unknown }) => {
      const data = e.data;
      if (typeof data === 'object' && data !== null && (data as Partial<ClosedMessage>).closed === companyId) done(true);
    };
    const timer = setTimeout(() => done(false), ms);
    channel.addEventListener('message', onMessage);
  });
}
