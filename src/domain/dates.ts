// Calendar dates as ISO strings ("2026-10-22"), the form documents store and <input type="date"> uses.
// They are days, not points in time: no time zone takes part in comparing or adding them.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Is the text a real calendar date in the form YYYY-MM-DD (years 1900 to 9999)? */
export function isIsoDate(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The local calendar day of a point in time, for example today */
export const isoDateOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day `days` days after a valid ISO date */
export function addDays(iso: string, days: number): string {
  const [y = 0, mo = 1, d = 1] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** The local Date at midnight of a valid ISO date, for formatting */
export function toLocalDate(iso: string): Date {
  const [y = 0, mo = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d);
}
