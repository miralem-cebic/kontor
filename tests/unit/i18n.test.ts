import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/i18n/messages';
import { LANGS } from '../../src/i18n/languages';

const placeholders = (s: string) => [...s.matchAll(/\{([a-z]+)\}/gi)].map((m) => m[1]).sort();

describe('messages', () => {
  it('every text exists in every language', () => {
    for (const [key, tr] of Object.entries(MESSAGES)) for (const l of LANGS) expect(tr[l].trim(), `${key} (${l})`).not.toBe('');
  });

  it('the placeholders are the same in every language', () => {
    for (const [key, tr] of Object.entries(MESSAGES)) expect(placeholders(tr.en), key).toEqual(placeholders(tr.de));
  });
});
