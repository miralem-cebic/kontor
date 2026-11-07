// Timestamps of changes. Devices have clocks that differ, and a device that runs behind must not make its
// later edits look older than an earlier edit from another device. Every timestamp read from the shared folder
// is observed here, and a new timestamp is never earlier than the newest one seen so far.

let newest = 0;

/**
 * How far ahead of this device's clock a timestamp from a file may be: a device whose clock runs ahead (wrong date
 * after a battery failure, a time zone mistake) must stay readable, but one value such as the year 9999 must not move
 * the clock of every later edit, nor win every merge. Longer than a year ahead is not a clock mistake worth keeping.
 */
export const MAX_STAMP_AHEAD_MS = 366 * 86_400_000;

/** The canonical form `YYYY-MM-DDTHH:mm:ss.sssZ` (what `Date#toISOString` writes), which also sorts as a string */
export function isCanonicalStamp(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  const ms = Date.parse(v);
  // the round trip rejects impossible dates (February 30) and 24:00
  return !Number.isNaN(ms) && new Date(ms).toISOString() === v;
}

/** A canonical timestamp that is not further ahead of the clock than MAX_STAMP_AHEAD_MS */
export const isPlausibleStamp = (v: string): boolean => isCanonicalStamp(v) && Date.parse(v) <= Date.now() + MAX_STAMP_AHEAD_MS;

/** Remember a timestamp that came from a file or another device; an implausible one is ignored */
export function observeStamp(iso: string): void {
  if (!isPlausibleStamp(iso)) return;
  const ms = Date.parse(iso);
  if (ms > newest) newest = ms;
}

/** The newest timestamp seen in this thread (the parse worker has its own clock and reports it back) */
export function newestSeenIso(): string | null {
  return newest > 0 ? new Date(newest).toISOString() : null;
}

/** A timestamp for a new change: the clock, but at least one millisecond after the newest one seen */
export function stampNow(): string {
  const ms = Math.max(Date.now(), newest + 1);
  newest = ms;
  return new Date(ms).toISOString();
}
