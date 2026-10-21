import { describe, expect, it } from 'vitest';
import { parsePrefs } from '../../src/store/prefs';

describe('parsePrefs', () => {
  it('reads known values', () => expect(parsePrefs('{"language":"en","lastCompany":"abc-1"}')).toEqual({ language: 'en', lastCompany: 'abc-1' }));
  it.each([null, '', 'nope', '[]', '{"language":"fr"}', '{"lastCompany":"__proto__"}', '{"lastCompany":"../x"}'])('drops what it does not know: %j', (raw) =>
    expect(parsePrefs(raw)).toEqual({}),
  );
});
