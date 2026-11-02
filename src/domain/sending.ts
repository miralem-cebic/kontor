// Sending a document by e-mail (F04). kontor prepares the mail and never sends one. The mail is a file (.eml) with the PDF
// attached, marked as an unsent draft (X-Unsent: 1), so that Outlook or Thunderbird open it as a draft; or a mailto: link
// (links.ts), for which the PDF is downloaded separately. This module builds the bytes from their parts and is pure: no
// file access, no store, no i18n. The texts come from src/i18n and are filled in by app/sending.ts.

import { Checker, type FieldError } from './check';

export const SEND_KINDS = ['invoice', 'cancellation', 'quote', 'dunning'] as const;
export type SendKind = (typeof SEND_KINDS)[number];

export const SEND_CHANNELS = ['eml', 'mailto'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

/** The longest subject and text of a mail */
export const SEND_LIMITS = { subject: 200, body: 8_000 } as const;

/** The text of a mail as the form holds it: the recipient, the subject and the text */
export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

export type MailField = keyof MailDraft;
export type MailFieldError = FieldError<MailField>;

/**
 * Fills the placeholders "{Name}" of a template in one pass. A value is never filled again, so a name that contains braces
 * stays as it is. A placeholder without a value stays too, so that a missing value shows in the text.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? (values[name] ?? whole) : whole));
}

/** Checks a mail before it is written: a recipient that is an address, a subject and a text within the limits */
export function readMailDraft(d: MailDraft): { ok: true; value: MailDraft } | { ok: false; error: MailFieldError[] } {
  const c = new Checker<MailField>();
  const to = c.email('to', d.to, true);
  // a subject is one line: line breaks and runs of spaces become one space, so no header can start in it
  const subject = c.text('subject', d.subject.replace(/\s+/g, ' '), SEND_LIMITS.subject);
  const body = c.text('body', d.body, SEND_LIMITS.body);
  return c.done(() => ({ to, subject, body }));
}

/** Control characters become spaces: a header value is one line, and no line break can add another header */
export const headerText = (text: string): string => text.replace(/\p{Cc}+/gu, ' ');

/** 45 bytes are 60 base64 characters: an encoded word of "=?UTF-8?B?…?=" is then 72 characters, under the 75 of RFC 2047 */
const ENCODED_WORD_BYTES = 45;

/**
 * A header value as RFC 5322 needs it: ASCII as it is; other text as RFC 2047 encoded words (UTF-8, base64), split between
 * characters so that no word takes more than 75 characters and no character is split.
 */
export function encodeHeader(text: string): string {
  const clean = headerText(text);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk: number[] = [];
  for (const character of clean) {
    const bytes = [...new TextEncoder().encode(character)];
    if (chunk.length + bytes.length > ENCODED_WORD_BYTES) {
      words.push(encodedWord(chunk));
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0) words.push(encodedWord(chunk));
  return words.join(' ');
}

const encodedWord = (bytes: number[]): string => `=?UTF-8?B?${base64(Uint8Array.from(bytes))}?=`;

/** Base64 of bytes; built in pieces, so that a large PDF does not overflow the stack */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Base64 lines of at most 76 characters, as MIME wants them */
const wrap = (text: string): string[] => text.match(/.{1,76}/g) ?? [];

/** A file name for the header that is plain ASCII: other characters and quotes become "_" */
const asciiName = (name: string): string => name.replace(/[^\x20-\x7e]|["\\]/g, '_');

/** RFC 5987 encoding of a parameter value, for the UTF-8 name of an attachment (filename*=) */
const rfc5987 = (value: string): string => encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface MailAttachment {
  /** The name the recipient sees, with its extension */
  name: string;
  /** The media type, for example application/pdf */
  type: string;
  data: Uint8Array;
}

export interface EmlOptions {
  to: string;
  subject: string;
  body: string;
  attachment: MailAttachment;
  /** The date header of the draft */
  date: Date;
  /** Separates the parts; random per mail, made by the caller, letters, digits and "-" only */
  boundary: string;
}

/**
 * The mail as a .eml file: a multipart message with the text (base64, UTF-8) and the attachment (base64), in CRLF lines.
 * X-Unsent: 1 marks it as a draft, which Outlook and Thunderbird open without sending it.
 */
export function buildEml(o: EmlOptions): Uint8Array {
  if (!/^[A-Za-z0-9-]{8,70}$/.test(o.boundary)) throw new Error('A MIME boundary is letters, digits and "-" only');
  const name = asciiName(o.attachment.name);
  const lines = [
    'X-Unsent: 1',
    `To: ${headerText(o.to)}`,
    `Subject: ${encodeHeader(o.subject)}`,
    `Date: ${o.date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${o.boundary}"`,
    '',
    `--${o.boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...wrap(base64(new TextEncoder().encode(o.body.replace(/\r?\n/g, '\r\n')))),
    `--${o.boundary}`,
    `Content-Type: ${o.attachment.type}; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"; filename*=UTF-8''${rfc5987(o.attachment.name)}`,
    'Content-Transfer-Encoding: base64',
    '',
    ...wrap(base64(o.attachment.data)),
    `--${o.boundary}--`,
    '',
  ];
  return new TextEncoder().encode(lines.join('\r\n'));
}
