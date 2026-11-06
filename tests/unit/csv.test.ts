import { describe, expect, it } from 'vitest';
import { encodeCsv, num, protectText } from '../../src/data/export/csv';

/** The file as text, without its byte order mark */
const text = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');

describe('encodeCsv', () => {
  it('writes a UTF-8 file with a byte order mark, semicolons and CRLF line ends', () => {
    const bytes = encodeCsv(['Nummer', 'Name'], [['A-1', 'Müller']]);
    expect(bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(text(bytes)).toBe('Nummer;Name\r\nA-1;Müller\r\n');
  });

  it('quotes a cell with a separator, a quote or a line break, and doubles its quotes', () => {
    const bytes = encodeCsv(['Notiz'], [['eins; zwei'], ['er sagte "ja"'], ['Zeile 1\nZeile 2']]);
    expect(text(bytes)).toBe('Notiz\r\n"eins; zwei"\r\n"er sagte ""ja"""\r\n"Zeile 1\nZeile 2"\r\n');
  });

  it('writes an empty cell as nothing, so the number of columns stays the same', () => {
    expect(text(encodeCsv(['a', 'b', 'c'], [['1', '', '3']]))).toBe('a;b;c\r\n1;;3\r\n');
  });
});

describe('formula protection', () => {
  it('writes a text that a spreadsheet could read as a formula with a leading apostrophe', () => {
    expect(protectText('=SUMME(A1:A2)')).toBe("'=SUMME(A1:A2)");
    expect(protectText('+49 30 1234')).toBe("'+49 30 1234");
    expect(protectText('-Rabatt')).toBe("'-Rabatt");
    expect(protectText('@web')).toBe("'@web");
    expect(protectText('\tTab')).toBe("'\tTab");
  });

  it('leaves other text as it is', () => {
    expect(protectText('Webdesign')).toBe('Webdesign');
    expect(protectText('A=B')).toBe('A=B');
    expect(protectText('')).toBe('');
  });

  it('protects text cells in the file', () => {
    expect(text(encodeCsv(['Name'], [['=1+1']]))).toBe("Name\r\n'=1+1\r\n");
  });

  it('never protects a number, not even a negative one, so that a credit note still adds up', () => {
    expect(text(encodeCsv(['Betrag'], [[num('-12,50')]]))).toBe('Betrag\r\n-12,50\r\n');
  });
});
