import { describe, expect, it } from 'vitest';
import { pdfAssets } from '../../src/pdf/assets';

describe('pdf assets', () => {
  it('decodes the fonts and the ICC profile', () => {
    const { regular, semiBold, srgb } = pdfAssets();
    // a TrueType font starts with the version 1.0 (0x00010000), an ICC profile has "acsp" at offset 36
    expect([...regular.slice(0, 4)]).toEqual([0, 1, 0, 0]);
    expect([...semiBold.slice(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(new TextDecoder().decode(srgb.slice(36, 40))).toBe('acsp');
    expect(srgb.length).toBe(736);
  });
});
