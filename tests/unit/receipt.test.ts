import { describe, expect, it } from 'vitest';
import { checkReceiptFile, isReceiptFileName, isReceiptLink, isReceiptYear, receiptFileName, receiptPath, receiptTypeOf, RECEIPT_LINK_MAX_LENGTH, RECEIPT_MAX_BYTES, RECEIPT_NAME_MAX_LENGTH } from '../../src/domain/receipt';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('receiptFileName', () => {
  it('starts with the expense and keeps the original name with the extension of its type', () => {
    expect(receiptFileName(ID, 'Rechnung Telekom 2026.pdf', 'application/pdf')).toBe(`${ID}-Rechnung Telekom 2026.pdf`);
    expect(receiptFileName(ID, 'foto.JPEG', 'image/jpeg')).toBe(`${ID}-foto.jpg`);
  });

  it('replaces the characters a file name cannot hold, and the path separators', () => {
    expect(receiptFileName(ID, 'Beleg: Telekom/Okt?.png', 'image/png')).toBe(`${ID}-Beleg_ Telekom_Okt_.png`);
  });

  it('falls back to a plain name when nothing is left of the original, and cuts a long one', () => {
    expect(receiptFileName(ID, '.pdf', 'application/pdf')).toBe(`${ID}-beleg.pdf`);
    const long = receiptFileName(ID, `${'x'.repeat(200)}.pdf`, 'application/pdf');
    expect(long.length).toBeLessThanOrEqual(RECEIPT_NAME_MAX_LENGTH);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('adds a tag when the name is taken by another receipt', () => {
    expect(receiptFileName(ID, 'x.pdf', 'application/pdf', 'ab12cd34')).toBe(`${ID}-ab12cd34-x.pdf`);
  });
});

describe('isReceiptFileName', () => {
  it('accepts the names that receiptFileName makes', () => {
    expect(isReceiptFileName(receiptFileName(ID, 'Beleg: Telekom/Okt?.png', 'image/png'), 'image/png')).toBe(true);
  });

  it('refuses a name that leaves the folder, has the wrong extension or has no name', () => {
    expect(isReceiptFileName('../x.pdf', 'application/pdf')).toBe(false);
    expect(isReceiptFileName(`${ID}-x.exe`, 'application/pdf')).toBe(false);
    expect(isReceiptFileName(`${ID}-x:y.pdf`, 'application/pdf')).toBe(false);
    expect(isReceiptFileName('.pdf', 'application/pdf')).toBe(false);
    expect(isReceiptFileName(`${'x'.repeat(RECEIPT_NAME_MAX_LENGTH)}.pdf`, 'application/pdf')).toBe(false);
  });
});

describe('checkReceiptFile', () => {
  it('refuses an empty file, a file that is too large and a type that is not a receipt', () => {
    expect(checkReceiptFile({ size: 0, type: 'application/pdf' })).toBe('empty');
    expect(checkReceiptFile({ size: RECEIPT_MAX_BYTES + 1, type: 'application/pdf' })).toBe('tooLarge');
    expect(checkReceiptFile({ size: 10, type: 'text/html' })).toBe('type');
  });

  it('accepts a PDF, a PNG or a JPEG of a sensible size', () => {
    expect(checkReceiptFile({ size: RECEIPT_MAX_BYTES, type: 'application/pdf' })).toBeNull();
    expect(receiptTypeOf('image/png')).toBe('image/png');
    expect(receiptTypeOf('image/gif')).toBeNull();
  });
});

describe('isReceiptLink', () => {
  it('accepts an http or https link', () => {
    expect(isReceiptLink('https://cloud.example/beleg.pdf')).toBe(true);
    expect(isReceiptLink('http://intern.example/x')).toBe(true);
  });

  it('refuses any other scheme, an empty text, a text with spaces around it and a link that is too long', () => {
    expect(isReceiptLink('javascript:alert(1)')).toBe(false);
    expect(isReceiptLink('file:///etc/passwd')).toBe(false);
    expect(isReceiptLink('')).toBe(false);
    expect(isReceiptLink(' https://cloud.example/x')).toBe(false);
    expect(isReceiptLink(`https://cloud.example/${'a'.repeat(RECEIPT_LINK_MAX_LENGTH)}`)).toBe(false);
  });
});

describe('receipt location', () => {
  it('is a file of the year of the expense, in belege/', () => {
    expect(receiptPath('2026', 'x.pdf')).toBe('belege/2026/x.pdf');
    expect(isReceiptYear('2026')).toBe(true);
    expect(isReceiptYear('../2026')).toBe(false);
    expect(isReceiptYear('26')).toBe(false);
  });
});
