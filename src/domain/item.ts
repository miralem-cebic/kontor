// The catalogue: items and services a company sells, with unit, net price and VAT rate. Quotes and invoices take
// their lines from it; a document can change the text and the price of its own line. The item form edits a draft
// of plain strings; `readItem` checks it and turns it into a profile.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { formatDecimal, type BasisPoints, type Cents, type MoneyLocale } from './money';
import { DEFAULT_UNIT, type UnitCode } from './units';
import { STANDARD_RATE } from './vat';

export interface ItemProfile {
  /** Item or service number, unique among the active items; empty when not given */
  number: string;
  /** Shown as the line text on quotes and invoices (EN 16931 BT-153) */
  name: string;
  /** Longer text below the name (BT-154); empty when not given */
  description: string;
  unit: UnitCode;
  /** Price per unit without VAT, not negative (EN 16931 BR-27). A small business charges no VAT, so it is the price. */
  netPrice: Cents;
  /** VAT rate of the item. A small business shows no VAT; the rate applies once it charges VAT. */
  vatRate: BasisPoints;
}

export const ITEM_LIMITS = {
  number: 30,
  name: 200,
  description: 2000,
  /** 999,999,999.99 €; far above any real price, a bound for input and file content */
  maxNetPrice: 99_999_999_999,
} as const;

/* ---------- Draft ---------- */

export interface ItemDraft {
  number: string;
  name: string;
  description: string;
  unit: UnitCode;
  /** As typed, in the interface language */
  netPrice: string;
  vatRate: BasisPoints;
}

export type ItemField = keyof ItemDraft;
export type ItemFieldError = FieldError<ItemField>;

export const emptyItemDraft = (): ItemDraft => ({ number: '', name: '', description: '', unit: DEFAULT_UNIT, netPrice: '', vatRate: STANDARD_RATE });

export const draftFromItem = (p: ItemProfile, locale: MoneyLocale): ItemDraft => ({
  number: p.number,
  name: p.name,
  description: p.description,
  unit: p.unit,
  netPrice: formatDecimal(p.netPrice, locale),
  vatRate: p.vatRate,
});

/* ---------- Checks ---------- */

/** Checks an item draft. `isNumberTaken` tells whether another active item already has a number. */
export function readItem(d: ItemDraft, locale: MoneyLocale, isNumberTaken: (number: string) => boolean): Result<ItemProfile, ItemFieldError[]> {
  const c = new Checker<ItemField>();
  const number = c.optionalText('number', d.number, ITEM_LIMITS.number);
  if (number && c.passed('number') && isNumberTaken(number)) c.add('number', 'itemNumberTaken');
  const name = c.text('name', d.name, ITEM_LIMITS.name);
  const description = c.optionalText('description', d.description, ITEM_LIMITS.description);
  const netPrice = c.price('netPrice', d.netPrice, locale, ITEM_LIMITS.maxNetPrice);
  return c.done(() => ({ number, name, description, unit: d.unit, netPrice, vatRate: d.vatRate }));
}

/* ---------- Lists ---------- */

/** Does the item match a search text? Number, name and description are searched. */
export function itemMatches(p: ItemProfile, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  return [p.number, p.name, p.description].some((v) => v.toLocaleLowerCase('de').includes(q));
}

export const byItemName = (a: ItemProfile, b: ItemProfile): number => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
