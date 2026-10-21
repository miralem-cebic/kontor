// Timestamps of changes. Devices have clocks that differ, and a device that runs behind must not make its
// later edits look older than an earlier edit from another device. Every timestamp read from the shared folder
// is observed here, and a new timestamp is never earlier than the newest one seen so far.

let newest = 0;

/** Remember a timestamp that came from a file or another device */
export function observeStamp(iso: string): void {
  const ms = Date.parse(iso);
  if (!Number.isNaN(ms) && ms > newest) newest = ms;
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
