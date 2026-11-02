import { describe, expect, it } from 'vitest';
import { buildEml, encodeHeader, fillTemplate, readMailDraft, SEND_LIMITS } from '../../src/domain/sending';

// Sending (F04): the mail is prepared as a file or a mailto: link; kontor never sends it. These tests read the .eml bytes
// back the way a mail program does: header lines, base64 parts and RFC 2047 encoded words.

const BOUNDARY = 'kontor-test';
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x80]);

const decodeText = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

/**
 * Decodes the RFC 2047 encoded words of a header value (base64, UTF-8). Whitespace between two adjacent encoded words is
 * not part of the text, so it goes first.
 */
const decodeHeader = (value: string) =>
  value.replace(/(\?=) +(?==\?UTF-8\?B\?)/g, '$1').replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, b64: string) => decodeText(b64));

/** The lines of the header block: everything before the first empty line */
const headerLines = (text: string) => text.slice(0, text.indexOf('\r\n\r\n')).split('\r\n');

/** The parts of a multipart message: each one's header block and its body, read as the base64 they are */
function parts(text: string): { headers: string; body: string }[] {
  return text
    .split(`--${BOUNDARY}`)
    .slice(1, -1)
    .map((part) => {
      const cut = part.indexOf('\r\n\r\n');
      return { headers: part.slice(0, cut), body: part.slice(cut + 4).replace(/\r\n/g, '') };
    });
}

const eml = (over: Partial<Parameters<typeof buildEml>[0]> = {}) =>
  new TextDecoder().decode(
    buildEml({
      to: 'einkauf@kunde.example',
      subject: 'Rechnung RE-2026-0001',
      body: 'Sehr geehrte Damen und Herren,\r\nvielen Dank.',
      attachment: { name: 'Rechnung_RE-2026-0001.pdf', type: 'application/pdf', data: PDF },
      date: new Date('2026-11-02T09:00:00Z'),
      boundary: BOUNDARY,
      ...over,
    }),
  );

describe('fillTemplate', () => {
  it('replaces every placeholder with its value', () => {
    expect(fillTemplate('Rechnung {Rechnungsnummer} vom {Rechnungsdatum}', { Rechnungsnummer: 'RE-2026-0001', Rechnungsdatum: '31.10.2026' })).toBe(
      'Rechnung RE-2026-0001 vom 31.10.2026',
    );
  });

  it('leaves a placeholder it has no value for as it is', () => {
    expect(fillTemplate('{Unbekannt} und {Betrag}', { Betrag: '5,00 €' })).toBe('{Unbekannt} und 5,00 €');
  });

  it('fills a value that contains braces only once, so a customer name cannot change the text', () => {
    expect(fillTemplate('{Kunde} {Betrag}', { Kunde: '{Betrag}', Betrag: '5,00 €' })).toBe('{Betrag} 5,00 €');
  });

  it('does not take the names of object properties as placeholders', () => {
    expect(fillTemplate('{constructor} {__proto__}', { Betrag: '1' })).toBe('{constructor} {__proto__}');
  });
});

describe('readMailDraft', () => {
  const draft = { to: 'einkauf@kunde.example', subject: 'Rechnung RE-2026-0001', body: 'Guten Tag' };

  it('accepts a mail with an address, a subject and a text', () => {
    expect(readMailDraft(draft)).toEqual({ ok: true, value: draft });
  });

  it('needs an address that looks like one', () => {
    expect(readMailDraft({ ...draft, to: '' })).toEqual({ ok: false, error: [{ field: 'to', problem: 'required' }] });
    expect(readMailDraft({ ...draft, to: 'kein-mail' })).toEqual({ ok: false, error: [{ field: 'to', problem: 'email' }] });
  });

  it('needs a subject and a text, and limits both', () => {
    expect(readMailDraft({ ...draft, subject: '  ', body: '' })).toEqual({
      ok: false,
      error: [
        { field: 'subject', problem: 'required' },
        { field: 'body', problem: 'required' },
      ],
    });
    expect(readMailDraft({ ...draft, subject: 'x'.repeat(SEND_LIMITS.subject + 1) })).toEqual({ ok: false, error: [{ field: 'subject', problem: 'tooLong' }] });
    expect(readMailDraft({ ...draft, body: 'x'.repeat(SEND_LIMITS.body + 1) })).toEqual({ ok: false, error: [{ field: 'body', problem: 'tooLong' }] });
  });

  it('keeps the subject on one line: a line break in it would start a new header', () => {
    expect(readMailDraft({ ...draft, subject: 'Rechnung\r\nBcc: spam@example.com' })).toEqual({
      ok: true,
      value: { ...draft, subject: 'Rechnung Bcc: spam@example.com' },
    });
  });
});

describe('encodeHeader', () => {
  it('keeps ASCII text as it is', () => {
    expect(encodeHeader('Rechnung RE-2026-0001')).toBe('Rechnung RE-2026-0001');
  });

  it('encodes other text as RFC 2047 words of at most 75 characters that decode to the whole text', () => {
    const subject = 'Zahlungserinnerung zu Rechnung RE-2026-0001 – Müller & Söhne, Größe 中文 Ελληνικά und mehr Text in einer langen Betreffzeile';
    const encoded = encodeHeader(subject);
    const words = encoded.split(' ');
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.startsWith('=?UTF-8?B?')).toBe(true);
      expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeHeader(encoded)).toBe(subject);
  });
});

describe('buildEml', () => {
  it('is a draft: X-Unsent comes first, then the address, the subject and the date, in CRLF lines', () => {
    const text = eml();
    expect(headerLines(text)).toEqual([
      'X-Unsent: 1',
      'To: einkauf@kunde.example',
      'Subject: Rechnung RE-2026-0001',
      'Date: Mon, 02 Nov 2026 09:00:00 GMT',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,
    ]);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('has the text as base64 UTF-8 and the PDF as an attachment with exactly its bytes', () => {
    const [text, pdf] = parts(eml({ body: 'Sehr geehrte Damen und Herren,\r\nvielen Dank für Ihren Auftrag.' }));
    expect(text?.headers).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(text?.headers).toContain('Content-Transfer-Encoding: base64');
    expect(decodeText(text?.body ?? '')).toBe('Sehr geehrte Damen und Herren,\r\nvielen Dank für Ihren Auftrag.');

    expect(pdf?.headers).toContain('Content-Type: application/pdf; name="Rechnung_RE-2026-0001.pdf"');
    expect(pdf?.headers).toContain('Content-Disposition: attachment; filename="Rechnung_RE-2026-0001.pdf"');
    expect(Buffer.from(pdf?.body ?? '', 'base64')).toEqual(Buffer.from(PDF));
  });

  it('wraps the base64 lines at 76 characters', () => {
    const text = eml({ attachment: { name: 'gross.pdf', type: 'application/pdf', data: new Uint8Array(500).fill(7) } });
    const lines = text.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]+$/.test(l) && l.length > 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('encodes a subject with umlauts so that it reads back as the same text', () => {
    const subject = 'Zahlungserinnerung zu Rechnung RE-2026-0001 – Müller & Söhne';
    const subjectLine = headerLines(eml({ subject })).find((l) => l.startsWith('Subject: ')) ?? '';
    expect(subjectLine.startsWith('Subject: =?UTF-8?B?')).toBe(true);
    expect(decodeHeader(subjectLine.slice('Subject: '.length))).toBe(subject);
  });

  it('cannot add a header through the subject or the address', () => {
    const text = eml({ subject: 'Hallo\r\nBcc: spam@example.com', to: 'a@b.de' });
    const lines = headerLines(text);
    expect(lines.some((l) => l.startsWith('Bcc:'))).toBe(false);
    expect(lines.filter((l) => l.startsWith('To:'))).toHaveLength(1);
  });

  it('names an attachment with umlauts in ASCII and as UTF-8 (RFC 2231), so the name survives', () => {
    const text = eml({ attachment: { name: 'Mahnung_Müller.pdf', type: 'application/pdf', data: PDF } });
    const disposition = parts(text)[1]?.headers.split('\r\n').find((l) => l.startsWith('Content-Disposition')) ?? '';
    expect(disposition).toBe(`Content-Disposition: attachment; filename="Mahnung_M_ller.pdf"; filename*=UTF-8''Mahnung_M%C3%BCller.pdf`);
  });
});
