import { createHmac, webcrypto } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hmacSha256, hmacSha256Hex, sha256 } from '../../src/lib/hmac';
import { fcParams as params } from './fixtures';

// SHA-256 and HMAC-SHA-256 without Web Crypto, because the emergency copy is signed while the page unloads, when an
// asynchronous digest would not finish (#69). Checked against the published test vectors and against node:crypto.

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (n: number, value: number) => new Uint8Array(n).fill(value);
const text = (s: string) => new TextEncoder().encode(s);

describe('sha256', () => {
  it('gives the digests of FIPS 180-4 (empty, "abc", two blocks)', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(text('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('gives the digest of Web Crypto for any data, around the block boundaries too', async () => {
    const lengths = fc.oneof(fc.constantFrom(0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128), fc.integer({ min: 0, max: 600 }));
    await fc.assert(
      fc.asyncProperty(lengths.chain((n) => fc.uint8Array({ minLength: n, maxLength: n })), async (data) => {
        const expected = new Uint8Array(await webcrypto.subtle.digest('SHA-256', data));
        expect(hex(sha256(data))).toBe(hex(expected));
      }),
      params,
    );
  });
});

describe('hmacSha256', () => {
  // RFC 4231, section 4
  it.each([
    ['1', bytes(20, 0x0b), text('Hi There'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
    ['2', text('Jefe'), text('what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
    ['3', bytes(20, 0xaa), bytes(50, 0xdd), '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe'],
    ['4', Uint8Array.from({ length: 25 }, (_, i) => i + 1), bytes(50, 0xcd), '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b'],
    ['6', bytes(131, 0xaa), text('Test Using Larger Than Block-Size Key - Hash Key First'), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'],
    [
      '7',
      bytes(131, 0xaa),
      text('This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.'),
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    ],
  ])('test case %s of RFC 4231', (_, key, data, expected) => {
    expect(hex(hmacSha256(key, data))).toBe(expected);
  });

  it('gives the HMAC of node:crypto for any key and text, umlauts included', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 200 }), fc.string({ unit: 'grapheme', maxLength: 300 }), (key, message) => {
        expect(hmacSha256Hex(key, message)).toBe(createHmac('sha256', key).update(message, 'utf8').digest('hex'));
      }),
      params,
    );
  });
});
