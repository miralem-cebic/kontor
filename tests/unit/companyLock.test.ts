import { describe, expect, it, vi } from 'vitest';
import { acquireCompanyLock, waitForClosed, type LockRequest } from '../../src/app/companyLock';

// One window per company (#97): the lock of a company is held while it is open in a window; a second window does not get
// it, unless it takes the company over, and then the first window is told.

/** Web Locks as far as the session uses them: ifAvailable, steal, and the release when the callback's promise settles */
class FakeLocks {
  private held = new Map<string, (reason: unknown) => void>();

  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: object | null) => unknown): Promise<unknown> {
    const holder = this.held.get(name);
    if (holder && options.ifAvailable) return Promise.resolve(callback(null));
    if (holder && !options.steal) return Promise.reject(new Error('the fake does not queue requests'));
    if (holder) {
      this.held.delete(name);
      holder(new DOMException('The lock was stolen', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      this.held.set(name, reject);
      Promise.resolve(callback({ name })).then(
        (v) => {
          if (this.held.get(name) === reject) this.held.delete(name);
          resolve(v);
        },
        (e: unknown) => reject(e),
      );
    });
  }
}

const locksOf = (fake: FakeLocks) => fake as unknown as LockRequest;
const noop = () => undefined;

describe('acquireCompanyLock', () => {
  it('the first window gets the lock of a company, a second window does not', async () => {
    const locks = locksOf(new FakeLocks());
    expect(await acquireCompanyLock(locks, 'c1', { steal: false, onLost: noop })).not.toBeNull();
    expect(await acquireCompanyLock(locks, 'c1', { steal: false, onLost: noop })).toBeNull();
    // another company is not affected
    expect(await acquireCompanyLock(locks, 'c2', { steal: false, onLost: noop })).not.toBeNull();
  });

  it('a released lock can be taken again', async () => {
    const locks = locksOf(new FakeLocks());
    const first = await acquireCompanyLock(locks, 'c1', { steal: false, onLost: noop });
    first?.release();
    await Promise.resolve();
    expect(await acquireCompanyLock(locks, 'c1', { steal: false, onLost: noop })).not.toBeNull();
  });

  it('taking the company over gives the lock to the second window and tells the first one', async () => {
    const locks = locksOf(new FakeLocks());
    const lost = vi.fn();
    await acquireCompanyLock(locks, 'c1', { steal: false, onLost: lost });
    expect(await acquireCompanyLock(locks, 'c1', { steal: true, onLost: noop })).not.toBeNull();
    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
  });

  it('a window that released its lock is not told when another one takes the company', async () => {
    const locks = locksOf(new FakeLocks());
    const lost = vi.fn();
    const first = await acquireCompanyLock(locks, 'c1', { steal: false, onLost: lost });
    first?.release();
    await acquireCompanyLock(locks, 'c1', { steal: true, onLost: noop });
    await Promise.resolve();
    expect(lost).not.toHaveBeenCalled();
  });

  it('without Web Locks, or when the browser refuses them, the company still opens (nothing is guarded)', async () => {
    expect(await acquireCompanyLock(undefined, 'c1', { steal: false, onLost: noop })).not.toBeNull();
    const refusing = { request: () => Promise.reject(new DOMException('no locks here', 'SecurityError')) } as unknown as LockRequest;
    expect(await acquireCompanyLock(refusing, 'c1', { steal: false, onLost: noop })).not.toBeNull();
  });
});

describe('waitForClosed', () => {
  /** A BroadcastChannel stand-in: what is posted reaches the listeners of the other instances */
  const channel = () => {
    const listeners = new Set<(e: { data: unknown }) => void>();
    return {
      post: (data: unknown) => listeners.forEach((l) => l({ data })),
      channel: {
        addEventListener: (_: 'message', l: (e: { data: unknown }) => void) => listeners.add(l),
        removeEventListener: (_: 'message', l: (e: { data: unknown }) => void) => listeners.delete(l),
      },
    };
  };

  it('ends when the other window says it closed the company', async () => {
    const { post, channel: ch } = channel();
    const waiting = waitForClosed(ch, 'c1', 3_000);
    post({ closed: 'c2' });
    post({ closed: 'c1' });
    await expect(waiting).resolves.toBe(true);
  });

  it('ends after the timeout when no window answers', async () => {
    vi.useFakeTimers();
    try {
      const { channel: ch } = channel();
      const waiting = waitForClosed(ch, 'c1', 3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(waiting).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a channel there is nothing to wait for', async () => {
    await expect(waitForClosed(null, 'c1', 3_000)).resolves.toBe(false);
  });
});
