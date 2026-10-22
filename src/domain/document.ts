// Lines and totals of quotes, and later of invoices. A line is copied from the catalogue or typed freely; it keeps
// its own values, so a later change of the catalogue does not change it. The line editor works on drafts of plain
// strings; `readLines` checks them.

import { Checker } from './check';
import { ITEM_LIMITS, type ItemProfile } from './item';
import {
  formatDecimal,
  formatQuantity,
  lineNet,
  parseCents,
  parseQuantity,
  QUANTITY_SCALE,
  taxTotals,
  type BasisPoints,
  type Cents,
  type MoneyLocale,
  type Quantity,
  type TaxTotals,
} from './money';
import { DEFAULT_UNIT, type UnitCode } from './units';
import { STANDARD_RATE, ZERO_RATE } from './vat';

export interface DocumentLine {
  /** Line text (EN 16931 BT-153) */
  name: string;
  /** Longer text below the name (BT-154); empty when not given */
  description: string;
  /** Not 0; negative for a deduction */
  quantity: Quantity;
  unit: UnitCode;
  /** Net price per unit, not negative (EN 16931 BR-27) */
  unitPrice: Cents;
  vatRate: BasisPoints;
}

export const DOCUMENT_LIMITS = {
  lines: 200,
  /** 999,999.999 units */
  maxQuantity: 999_999_999,
  /** The net amount of one line: 999,999,999.99 €. With at most 200 lines every sum stays an exact integer. */
  maxLineNet: ITEM_LIMITS.maxNetPrice,
} as const;

/** Does unit price × quantity stay within the limit of a line? Checked exactly, before `lineNet` is computed. */
export function lineNetInRange(unitPrice: Cents, qty: Quantity): boolean {
  const product = BigInt(unitPrice) * BigInt(qty);
  return (product < 0n ? -product : product) <= BigInt(DOCUMENT_LIMITS.maxLineNet) * BigInt(QUANTITY_SCALE);
}

export const lineTotal = (l: DocumentLine): Cents => lineNet(l.unitPrice, l.quantity);

/** Net, VAT per rate and gross of the lines, rounded per document (ADR 0003). A small business charges no VAT. */
export const documentTotals = (lines: readonly DocumentLine[], smallBusiness: boolean): TaxTotals =>
  taxTotals(lines.map((l) => ({ net: lineTotal(l), rate: smallBusiness ? ZERO_RATE : l.vatRate })));

/* ---------- Drafts ---------- */

export interface LineDraft {
  /** Identifies the line in the editor while lines are added, moved and removed; not stored */
  key: string;
  name: string;
  description: string;
  /** As typed, in the interface language */
  quantity: string;
  unit: UnitCode;
  /** As typed, in the interface language */
  unitPrice: string;
  vatRate: BasisPoints;
}

export type LineField = Exclude<keyof LineDraft, 'key'>;
/** The field of one line in the errors of a document: "line.0.quantity" */
export type LineFieldPath = `line.${number}.${LineField}`;
export const linePath = (index: number, field: LineField): LineFieldPath => `line.${index}.${field}`;

export const emptyLineDraft = (key: string): LineDraft => ({ key, name: '', description: '', quantity: '1', unit: DEFAULT_UNIT, unitPrice: '', vatRate: STANDARD_RATE });

/** A new line with the text, unit, price and rate of a catalogue item; the quantity starts at 1 */
export const lineDraftFromItem = (key: string, item: ItemProfile, locale: MoneyLocale): LineDraft => ({
  key,
  name: item.name,
  description: item.description,
  quantity: '1',
  unit: item.unit,
  unitPrice: formatDecimal(item.netPrice, locale),
  vatRate: item.vatRate,
});

export const draftFromLine = (key: string, l: DocumentLine, locale: MoneyLocale): LineDraft => ({
  key,
  name: l.name,
  description: l.description,
  quantity: formatQuantity(l.quantity, locale),
  unit: l.unit,
  unitPrice: formatDecimal(l.unitPrice, locale),
  vatRate: l.vatRate,
});

/** Checks the lines of a document draft; errors name the line and its field ("line.2.unitPrice") */
export function readLines<F extends string>(c: Checker<F | LineFieldPath | 'lines'>, drafts: readonly LineDraft[], locale: MoneyLocale): DocumentLine[] {
  if (drafts.length > DOCUMENT_LIMITS.lines) c.add('lines', 'tooManyLines');
  return drafts.map((d, i) => {
    const line: DocumentLine = {
      name: c.text(linePath(i, 'name'), d.name, ITEM_LIMITS.name),
      description: c.optionalText(linePath(i, 'description'), d.description, ITEM_LIMITS.description),
      quantity: c.quantity(linePath(i, 'quantity'), d.quantity, locale, DOCUMENT_LIMITS.maxQuantity),
      unit: d.unit,
      unitPrice: c.price(linePath(i, 'unitPrice'), d.unitPrice, locale, ITEM_LIMITS.maxNetPrice),
      vatRate: d.vatRate,
    };
    if (c.passed(linePath(i, 'quantity')) && c.passed(linePath(i, 'unitPrice')) && !lineNetInRange(line.unitPrice, line.quantity)) {
      c.add(linePath(i, 'quantity'), 'lineTooLarge');
    }
    return line;
  });
}

/** The net amount of a draft line while it is typed, or null as long as quantity or price cannot be read */
export function draftLineNet(d: LineDraft, locale: MoneyLocale): Cents | null {
  const qty = parseQuantity(d.quantity, locale);
  const price = parseCents(d.unitPrice, locale);
  if (qty === null || price === null || price < 0 || qty === 0 || Math.abs(qty) > DOCUMENT_LIMITS.maxQuantity || !lineNetInRange(price, qty)) return null;
  return lineNet(price, qty);
}

/** Totals of the draft lines that can be read already, for the editor */
export function draftTotals(drafts: readonly LineDraft[], locale: MoneyLocale, smallBusiness: boolean): TaxTotals {
  const lines = drafts.flatMap((d) => {
    const net = draftLineNet(d, locale);
    return net === null ? [] : [{ net, rate: smallBusiness ? ZERO_RATE : d.vatRate }];
  });
  return taxTotals(lines);
}
