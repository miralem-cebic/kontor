import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byItemName, draftFromItem, emptyItemDraft, itemMatches, readItem, type ItemDraft } from '../../src/domain/item';
import { basisPoints, cents } from '../../src/domain/money';
import { UNITS } from '../../src/domain/units';
import { VAT_RATES } from '../../src/domain/vat';
import { fcParams, sampleItem } from './fixtures';

const free = () => false;
const problems = (r: ReturnType<typeof readItem>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));
const draft = (over: Partial<ItemDraft> = {}): ItemDraft => ({ ...emptyItemDraft(), name: 'Webdesign', netPrice: '85,00', ...over });

describe('readItem', () => {
  it('needs a name and a price; number and description are optional', () => {
    expect(problems(readItem(emptyItemDraft(), 'de', free))).toEqual(['name:required', 'netPrice:required']);
    const r = readItem(draft({ name: ' Webdesign ' }), 'de', free);
    expect(r.ok && r.value).toEqual({ number: '', name: 'Webdesign', description: '', unit: 'H87', netPrice: 8500, vatRate: 1900 });
  });

  it('reads the price in the interface language', () => {
    const de = readItem(draft({ netPrice: '1.250,5' }), 'de', free);
    expect(de.ok && de.value.netPrice).toBe(125050);
    const en = readItem(draft({ netPrice: '1,250.50' }), 'en', free);
    expect(en.ok && en.value.netPrice).toBe(125050);
    expect(problems(readItem(draft({ netPrice: '1,250.50' }), 'de', free))).toEqual(['netPrice:price']);
  });

  it('refuses a price that is unreadable, negative or too large', () => {
    expect(problems(readItem(draft({ netPrice: '85,001' }), 'de', free))).toEqual(['netPrice:price']);
    expect(problems(readItem(draft({ netPrice: 'achtzig' }), 'de', free))).toEqual(['netPrice:price']);
    expect(problems(readItem(draft({ netPrice: '-5' }), 'de', free))).toEqual(['netPrice:priceNegative']);
    expect(problems(readItem(draft({ netPrice: '1.000.000.000' }), 'de', free))).toEqual(['netPrice:price']);
    expect(readItem(draft({ netPrice: '999.999.999,99' }), 'de', free).ok).toBe(true);
    expect(readItem(draft({ netPrice: '0' }), 'de', free).ok).toBe(true);
  });

  it('an item number must be unique; texts have limits', () => {
    const taken = (n: string) => n === 'L-100';
    expect(problems(readItem(draft({ number: ' L-100 ' }), 'de', taken))).toEqual(['number:itemNumberTaken']);
    expect(readItem(draft({ number: 'L-101' }), 'de', taken).ok).toBe(true);
    expect(problems(readItem(draft({ number: 'x'.repeat(31), name: 'x'.repeat(201), description: 'x'.repeat(2001) }), 'de', free))).toEqual([
      'number:tooLong',
      'name:tooLong',
      'description:tooLong',
    ]);
  });
});

describe('draft ↔ item', () => {
  it('shows the price as typed in the interface language', () => {
    expect(draftFromItem(sampleItem({ netPrice: cents(123456) }), 'de').netPrice).toBe('1.234,56');
    expect(draftFromItem(sampleItem({ netPrice: cents(123456) }), 'en').netPrice).toBe('1,234.56');
  });

  it('an item survives the round trip through the draft, in both languages', () =>
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim() === s && s !== ''),
          netPrice: fc.integer({ min: 0, max: 99_999_999_999 }).map(cents),
          unit: fc.constantFrom(...UNITS),
          vatRate: fc.constantFrom(...VAT_RATES),
        }),
        fc.constantFrom('de' as const, 'en' as const),
        (over, locale) => {
          const item = sampleItem(over);
          const r = readItem(draftFromItem(item, locale), locale, free);
          return r.ok && JSON.stringify(r.value) === JSON.stringify(item);
        },
      ),
      fcParams,
    ));
});

describe('lists', () => {
  it('searches number, name and description, ignoring case', () => {
    const item = sampleItem();
    expect(itemMatches(item, 'l-100')).toBe(true);
    expect(itemMatches(item, 'WEB')).toBe(true);
    expect(itemMatches(item, 'aufwand')).toBe(true);
    expect(itemMatches(item, '  ')).toBe(true);
    expect(itemMatches(item, 'Logo')).toBe(false);
  });

  it('sorts by name', () => {
    const names = ['Übersetzung', 'beratung', 'Anfahrt'].map((name) => sampleItem({ name }));
    expect(names.sort(byItemName).map((i) => i.name)).toEqual(['Anfahrt', 'beratung', 'Übersetzung']);
  });

  it('a new item starts with the standard rate and pieces', () => {
    expect(emptyItemDraft()).toMatchObject({ unit: 'H87', vatRate: basisPoints(1900) });
  });
});
