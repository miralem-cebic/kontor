import { describe, expect, it } from 'vitest';
import { formatNumber, patternProblem } from '../../src/domain/numbering';

describe('number patterns', () => {
  const parts = { year: 2026, month: 3, counter: 7 };

  it.each([
    ['RE-{YYYY}-{NNNN}', 'RE-2026-0007'],
    ['{YY}{MM}-{NNN}', '2603-007'],
    ['R_{N}', 'R_7'],
    ['{NNNNNNNNNN}', '0000000007'],
  ])('%s → %s', (pattern, expected) => expect(formatNumber(pattern, parts)).toBe(expected));

  it('a counter larger than the padding is longer, never cut', () => expect(formatNumber('RE-{NN}', { ...parts, counter: 1234 })).toBe('RE-1234'));

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['RE-{YYYY}', 'noCounter'],
    ['{NNN}-{NN}', 'multipleCounters'],
    ['RE/{NNNN}', 'invalidCharacter'],
    ['RE {NNNN}', 'invalidCharacter'],
    ['RE.{NNNN}', 'invalidCharacter'],
    ['{NNNN}}', 'invalidCharacter'],
    ['{DD}-{NNNN}', 'unknownToken'],
    ['{NNNNNNNNNNN}', 'unknownToken'],
    ['{yyyy}-{NNNN}', 'unknownToken'],
    ['A'.repeat(41) + '{N}', 'tooLong'],
    ['../{NNNN}', 'invalidCharacter'],
  ])('rejects %j (%s)', (pattern, problem) => expect(patternProblem(pattern)).toBe(problem));

  it('refuses to format an invalid pattern', () => expect(() => formatNumber('RE/{N}', parts)).toThrow());

  it('every valid pattern gives a safe file name', () => {
    for (const p of ['RE-{YYYY}-{NNNN}', '{YY}{MM}{NN}', 'x_{N}']) expect(formatNumber(p, parts)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
