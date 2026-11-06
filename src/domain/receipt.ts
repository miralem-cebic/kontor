// Receipts (Belege) of expenses, Phase 3 of the roadmap: a receipt is a file the user picks (a PDF, a PNG or a JPEG) that
// is copied into the company folder under belege/<year>/, or a link to a page where the receipt is kept. This module
// holds the rules that do not touch files: the name of a receipt file, the check of a picked file and the check of a
// link. The folder work is in data/fs and app/session.ts.

import { isWebUrl } from './links';

/** The types a receipt can have, with the extension of the file they are kept in */
export const RECEIPT_TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
export type ReceiptType = keyof typeof RECEIPT_TYPES;

/** A receipt up to 10 MB: a scan of one page or a few pages */
export const RECEIPT_MAX_BYTES = 10_000_000;
export const RECEIPT_NAME_MAX_LENGTH = 200;
export const RECEIPT_LINK_MAX_LENGTH = 2_000;
/** The original name, without its extension, is cut to this many characters in the name of the receipt file */
const BASE_MAX_LENGTH = 80;

/** Characters a file name cannot hold: path separators, Windows-reserved characters, and control characters */
const FORBIDDEN = '\\/:*?"<>|';
const isForbidden = (ch: string): boolean => FORBIDDEN.includes(ch) || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f;
const cleanName = (text: string): string => [...text].map((ch) => (isForbidden(ch) ? '_' : ch)).join('');

const isReceiptType = (value: string): value is ReceiptType => Object.hasOwn(RECEIPT_TYPES, value);

/** The receipt type of a MIME type, or null when kontor does not keep such a file as a receipt */
export function receiptTypeOf(mime: string): ReceiptType | null {
  return isReceiptType(mime) ? mime : null;
}

/**
 * The name of a receipt file: the expense's ID, then the original name without its extension, cleaned of the characters a
 * file name cannot hold, with the extension of its type. `tag` is added after the ID when another receipt of the expense
 * has that name already; the tag is the start of the file's SHA-256.
 */
export function receiptFileName(expenseId: string, original: string, type: ReceiptType, tag = ''): string {
  const ext = RECEIPT_TYPES[type];
  const base = [...cleanName(original.replace(/\.[^.]*$/, ''))].slice(0, BASE_MAX_LENGTH).join('').trim() || 'beleg';
  return tag === '' ? `${expenseId}-${base}.${ext}` : `${expenseId}-${tag}-${base}.${ext}`;
}

/** Is the name a receipt file of this type: short enough, no forbidden character, the extension, and a name before it? */
export function isReceiptFileName(name: string, type: ReceiptType): boolean {
  const ext = `.${RECEIPT_TYPES[type]}`;
  return name.length > ext.length && name.length <= RECEIPT_NAME_MAX_LENGTH && name === name.trim() && name.endsWith(ext) && ![...name].some(isForbidden);
}

/** The check of a picked file: empty, not a receipt type, or too large. Null when it can be kept. */
export function checkReceiptFile(file: { size: number; type: string }): 'empty' | 'tooLarge' | 'type' | null {
  if (file.size === 0) return 'empty';
  if (receiptTypeOf(file.type) === null) return 'type';
  if (file.size > RECEIPT_MAX_BYTES) return 'tooLarge';
  return null;
}

/** A link to the receipt: an http or https address, as typed, without spaces around it and not too long */
export function isReceiptLink(url: string): boolean {
  return url.length > 0 && url.length <= RECEIPT_LINK_MAX_LENGTH && url === url.trim() && isWebUrl(url);
}

/** The year folder of a receipt is the year of the expense: four digits, nothing else */
export const isReceiptYear = (text: string): boolean => /^\d{4}$/.test(text);

/** Where a receipt file is kept in the company folder, for display */
export const receiptPath = (year: string, name: string): string => `belege/${year}/${name}`;

/** A receipt of an expense as the expense file keeps it: a file in belege/<year>/ with its type, size and SHA-256, or a link */
export type Receipt = { kind: 'file'; year: string; name: string; type: ReceiptType; size: number; sha256: string } | { kind: 'link'; url: string };
