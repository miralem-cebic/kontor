// Links to pages outside kontor. Only http: and https: may become an href (CLAUDE.md, "Links"): other schemes such as
// javascript:, data: or file: could run code or open local files. The one exception is the mailto: link of the sending
// feature (mailtoHref, F04): it is built here from a checked address and percent-encoded parts, never from raw text.

import { isEmailAddress } from './check';

/** Is the text an absolute http: or https: URL? */
export function isWebUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** The longest mailto: link a mail program takes reliably (Outlook stops at about 2,000 characters) */
export const MAILTO_MAX_LENGTH = 2_000;

/**
 * A mailto: link that opens a new mail with the recipient, subject and text. Null when the address is not one. The text is
 * left out when the link would be longer than MAILTO_MAX_LENGTH (`bodyIncluded: false`); the subject stays.
 */
export function mailtoHref(to: string, subject: string, body: string): { href: string; bodyIncluded: boolean } | null {
  if (!isEmailAddress(to)) return null;
  const head = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}`;
  const full = `${head}&body=${encodeURIComponent(body)}`;
  return full.length <= MAILTO_MAX_LENGTH ? { href: full, bodyIncluded: true } : { href: head, bodyIncluded: false };
}
