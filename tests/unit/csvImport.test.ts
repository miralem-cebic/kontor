import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeCsv } from '../../src/data/export/csv';
import { CSV_LIMITS, parseCsv } from '../../src/data/import/csv';
import { fcParams as params } from './fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const withBom = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);

/** The rows of a file that parses; fails the test with the problem otherwise */
function rowsOf(bytes: Uint8Array): string[][] {
  const r = parseCsv(bytes);
  if (!r.ok) throw new Error(`expected a file, got ${r.error.kind}`);
  return r.value.rows;
}

describe('parseCsv: encoding', () => {
  it('reads UTF-8 with a byte order mark, and UTF-8 without one, the same way', () => {
    expect(rowsOf(withBom('Name;Ort\r\nMüller;Köln\r\n'))).toEqual([
      ['Name', 'Ort'],
      ['Müller', 'Köln'],
    ]);
    expect(rowsOf(utf8('Name;Ort\nMüller;Köln\n'))).toEqual([
      ['Name', 'Ort'],
      ['Müller', 'Köln'],
    ]);
  });

  it('reads Windows-1252 when the bytes are not valid UTF-8 (the export of an older spreadsheet)', () => {
    // "Müller;Käthe" with ü and ä as single bytes 0xFC and 0xE4
    const bytes = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x4b, 0xe4, 0x74, 0x68, 0x65]);
    const r = parseCsv(bytes);
    expect(r.ok && r.value.encoding).toBe('windows-1252');
    expect(r.ok && r.value.rows).toEqual([['Müller', 'Käthe']]);
  });
});

describe('parseCsv: separator', () => {
  it('finds a comma and a tab as the separator when the header has no semicolon', () => {
    expect(rowsOf(utf8('a,b\n1,2\n'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(rowsOf(utf8('a\tb\n1\t2\n'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('prefers the semicolon on a tie, so a comma in a header text does not change the separator', () => {
    const r = parseCsv(utf8('Name;Notiz, lang\nMüller;ja\n'));
    expect(r.ok && r.value.separator).toBe(';');
    expect(r.ok && r.value.rows[0]).toEqual(['Name', 'Notiz, lang']);
  });
});

describe('parseCsv: quoting and line breaks', () => {
  it('reads quoted cells with separators, doubled quotes and line breaks inside them', () => {
    expect(rowsOf(utf8('a;b\r\n"x;y";"er sagte ""ja"""\r\n"Zeile 1\nZeile 2";z\r\n'))).toEqual([
      ['a', 'b'],
      ['x;y', 'er sagte "ja"'],
      ['Zeile 1\nZeile 2', 'z'],
    ]);
  });

  it('keeps spaces inside a cell and skips empty lines', () => {
    expect(rowsOf(utf8('a;b\r\n\r\n  Name ; \r\n\n'))).toEqual([
      ['a', 'b'],
      ['  Name ', ' '],
    ]);
  });
});

describe('parseCsv: refusals', () => {
  it('refuses an empty file', () => {
    expect(parseCsv(new Uint8Array())).toEqual({ ok: false, error: { kind: 'empty' } });
  });

  it('refuses a file larger than the limit before it reads it', () => {
    expect(parseCsv(new Uint8Array(CSV_LIMITS.bytes + 1))).toEqual({ ok: false, error: { kind: 'tooLarge' } });
  });

  it('refuses more rows than the limit', () => {
    const text = 'a\n' + Array.from({ length: CSV_LIMITS.rows + 1 }, (_, i) => `${i}`).join('\n');
    expect(parseCsv(utf8(text))).toEqual({ ok: false, error: { kind: 'tooManyRows' } });
  });

  it('refuses a row with more columns than the limit', () => {
    const header = Array.from({ length: CSV_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(';');
    expect(parseCsv(utf8(header))).toEqual({ ok: false, error: { kind: 'tooManyColumns' } });
  });

  it('refuses a cell longer than the limit', () => {
    expect(parseCsv(utf8('a\n' + 'x'.repeat(CSV_LIMITS.cellLength + 1)))).toEqual({ ok: false, error: { kind: 'cellTooLong' } });
  });
});

describe('parseCsv reads what encodeCsv writes', () => {
  // a text cell that a spreadsheet would read as a formula is written with an apostrophe in front, so the round trip
  // holds for every cell that does not start with one of those characters
  const cell = fc
    .string({ maxLength: 40 })
    .filter((s) => !/^[=+\-@\t\r]/.test(s) && !s.includes('﻿') && !/[\ud800-\udfff]/.test(s));

  it('gives back the same rows, with quotes, separators and line breaks in them (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 2, maxLength: 4 }), { minLength: 1, maxLength: 8 }), (rows) => {
        const bytes = encodeCsv(rows[0] ?? [], rows.slice(1));
        expect(rowsOf(bytes)).toEqual(rows);
      }),
      params,
    );
  });
});
