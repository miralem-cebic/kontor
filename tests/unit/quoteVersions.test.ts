import { describe, expect, it } from 'vitest';
import type { DocumentLine } from '../../src/domain/document';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import { changeStats, lineChanges, replacedAlready, versionChain, versionNumber, type VersionInfo } from '../../src/domain/quoteVersions';
import { sampleLine } from './fixtures';

describe('version numbers', () => {
  it('a version keeps the first number, with its version as a suffix', () => {
    expect(versionNumber('AN-2026-0012', 2)).toBe('AN-2026-0012-2');
    expect(versionNumber('0012', 10)).toBe('0012-10');
  });
});

describe('what changed between two versions', () => {
  const web = sampleLine();
  const edit = sampleLine({ name: 'Lektorat', quantity: quantity(1000), unit: 'LS', unitPrice: cents(30000), vatRate: basisPoints(700) });

  it('nothing, when the lines are the same; the order alone is no change', () => {
    expect(lineChanges([web, edit], [web, edit])).toEqual([]);
    expect(lineChanges([web, edit], [edit, web])).toEqual([]);
  });

  it('lines added and removed, matched by their name', () => {
    const hosting = sampleLine({ name: 'Hosting' });
    expect(lineChanges([web, edit], [web, hosting])).toEqual([
      { kind: 'added', line: hosting },
      { kind: 'removed', line: edit },
    ]);
    // a line with another name is another line
    const renamed = { ...edit, name: 'Korrektorat' };
    expect(lineChanges([edit], [renamed])).toEqual([
      { kind: 'added', line: renamed },
      { kind: 'removed', line: edit },
    ]);
  });

  it('the quantity, price, unit, rate and description of a line', () => {
    const more = { ...web, quantity: quantity(15_000), unitPrice: cents(9000) };
    expect(lineChanges([web], [more])).toEqual([{ kind: 'changed', before: web, after: more, fields: ['quantity', 'unitPrice'] }]);
    const other: DocumentLine = { ...web, description: 'Neu', unit: 'DAY', vatRate: basisPoints(700) };
    expect(lineChanges([web], [other])).toEqual([{ kind: 'changed', before: web, after: other, fields: ['description', 'unit', 'vatRate'] }]);
  });

  it('lines of the same name are matched in their order', () => {
    const a = sampleLine({ quantity: quantity(1000) });
    const b = sampleLine({ quantity: quantity(2000) });
    expect(lineChanges([a, b], [a])).toEqual([{ kind: 'removed', line: b }]);
    expect(lineChanges([a], [a, b])).toEqual([{ kind: 'added', line: b }]);
  });
});

const quote = (id: string, over: Partial<VersionInfo> = {}): VersionInfo => ({ id, customerId: 'c1', deletedAt: null, issued: { number: id.toUpperCase() }, revises: null, ...over });

describe('version chains', () => {
  it('the versions of a quote from the first to the latest, found from any of them', () => {
    const quotes = [quote('a'), quote('x'), quote('b', { revises: { id: 'a' } }), quote('c', { revises: { id: 'b' }, issued: null })];
    for (const id of ['a', 'b', 'c']) expect(versionChain(quotes, id).map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(versionChain(quotes, 'x').map((v) => v.id)).toEqual(['x']);
    expect(versionChain(quotes, 'nope')).toEqual([]);
  });

  it('a deleted draft is no version; a finalized version wins over a draft of the same quote', () => {
    const deleted = quote('b', { revises: { id: 'a' }, issued: null, deletedAt: '2026-10-28T10:00:00.000Z' });
    expect(versionChain([quote('a'), deleted, quote('c', { revises: { id: 'a' }, issued: null })], 'a').map((v) => v.id)).toEqual(['a', 'c']);
    // two devices made a version of the same quote
    expect(versionChain([quote('a'), quote('d', { revises: { id: 'a' }, issued: null }), quote('e', { revises: { id: 'a' } })], 'a').map((v) => v.id)).toEqual(['a', 'e']);
  });

  it('a loop in files from another device ends the chain', () => {
    const quotes = [quote('a', { revises: { id: 'b' } }), quote('b', { revises: { id: 'a' } })];
    expect(versionChain(quotes, 'a').map((v) => v.id)).toEqual(['b', 'a']);
  });
});

describe('one version replaces a quote', () => {
  it('a version cannot be finalized once another version of the same quote is', () => {
    const a = quote('a');
    const draft = quote('b', { revises: { id: 'a' }, issued: null });
    const other = quote('c', { revises: { id: 'a' }, issued: null });
    expect(replacedAlready([a, draft, other], draft)).toBe(false);
    const finalized = { ...other, issued: { number: 'A-2' } };
    expect(replacedAlready([a, draft, finalized], draft)).toBe(true);
    expect(replacedAlready([a, draft, finalized], finalized)).toBe(false);
    expect(replacedAlready([a, draft], a)).toBe(false);
  });
});

describe('how often quotes are changed', () => {
  it('counts the finalized quotes, those that were changed and the changes; drafts do not count', () => {
    const quotes = [
      quote('a'),
      quote('b', { revises: { id: 'a' } }),
      quote('c', { revises: { id: 'b' } }),
      quote('d', { customerId: 'c2' }),
      quote('e', { customerId: 'c2', issued: null }),
      quote('f', { customerId: 'c2' }),
      quote('g', { customerId: 'c2', revises: { id: 'f' }, issued: null }),
    ];
    expect(changeStats(quotes)).toEqual({ total: 3, changed: 1, changes: 2 });
    expect(changeStats(quotes.filter((q) => q.customerId === 'c2'))).toEqual({ total: 2, changed: 0, changes: 0 });
    expect(changeStats([])).toEqual({ total: 0, changed: 0, changes: 0 });
  });
});
