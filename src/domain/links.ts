// Links to pages outside kontor. Only http: and https: may become an href (CLAUDE.md, "Links"): other schemes such as
// javascript:, data: or file: could run code or open local files.

/** Is the text an absolute http: or https: URL? */
export function isWebUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
