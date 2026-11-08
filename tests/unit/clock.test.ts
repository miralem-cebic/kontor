import { describe, expect, it } from 'vitest';
import { newestSeenIso, observeStamp, stampNow } from '../../src/data/clock';

describe('clock', () => {
  it('a new stamp is never earlier than the newest one seen, so a device that runs behind keeps its order', () => {
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    observeStamp(ahead);
    expect(stampNow() > ahead).toBe(true);
  });

  it('a stamp far in the future does not move the clock', () => {
    const before = newestSeenIso();
    for (const far of ['9999-12-31T00:00:00.000Z', '3000-01-01T00:00:00.000Z', new Date(Date.now() + 400 * 86_400_000).toISOString()]) observeStamp(far);
    expect(newestSeenIso()).toBe(before);
    expect(stampNow() < '2100').toBe(true);
  });
});
