// Lines and totals of quotes and invoices. A line is copied from the catalogue or typed freely; it keeps its own
// values, so a later change of the catalogue does not change it. The line editor works on drafts of plain strings;
// `readLines` checks them. A line and the whole document can take off a discount (discount.ts, F23).

import { Checker } from './check';
import { discountDraft, discountOff, documentDiscountPerRate, NO_DISCOUNT, NO_DISCOUNT_DRAFT, readableDiscount, readDiscount, type Discount, type DiscountDraft } from './discount';
import { ITEM_LIMITS, type ItemProfile } from './item';
import {
  cents,
  formatDecimal,
  formatQuantity,
  lineNet,
  parseCents,
  parseQuantity,
  QUANTITY_SCALE,
  subtract,
  sum,
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
  /** The discount of this line (F23); NO_DISCOUNT for a line without one */
  discount: Discount;
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

/** The net amount of a line before its discount: unit price × quantity */
export const lineSubtotal = (l: DocumentLine): Cents => lineNet(l.unitPrice, l.quantity);

/** The net amount of a line after its discount: what the line shows */
export const lineTotal = (l: DocumentLine): Cents => {
  const subtotal = lineSubtotal(l);
  return subtract(subtotal, discountOff(subtotal, l.discount));
};

/** An amount without its sign: the most a discount may take off */
const magnitude = (value: Cents): Cents => cents(Math.abs(value));

/** Totals of a document: the lines before any discount, what the discounts took off, and the amounts per rate */
export interface DocumentTotals extends TaxTotals {
  /** The lines before any discount: the sum of their unit price × quantity */
  subtotal: Cents;
  /** What the discounts of the lines and of the document took off: subtotal − net. Negative for a cancellation. */
  discount: Cents;
}

/**
 * Net, VAT per rate and gross of the lines, rounded per document (ADR 0003), after the discounts of the lines and of
 * the document (`discount`, shared between the rates). `withoutVat`: the document charges no VAT (a small business,
 * reverse charge, a tax-free supply), so every line counts at 0 %.
 */
export const documentTotals = (lines: readonly DocumentLine[], withoutVat: boolean, discount: Discount): DocumentTotals => {
  const rateOf = (l: DocumentLine): BasisPoints => (withoutVat ? ZERO_RATE : l.vatRate);
  const subtotal = sum(lines.map(lineSubtotal));
  const rates = [...new Set(lines.map(rateOf))].sort((a, b) => a - b);
  const netPerRate = rates.map((rate) => sum(lines.filter((l) => rateOf(l) === rate).map(lineTotal)));
  const documentDiscount = documentDiscountPerRate(netPerRate, discount);
  const totals = taxTotals(rates.map((rate, i) => ({ rate, net: subtract(netPerRate[i] ?? cents(0), documentDiscount[i] ?? cents(0)) })));
  return { ...totals, subtotal, discount: subtract(subtotal, totals.net) };
};

/**
 * Do the lines of one VAT rate add up to less than zero? A deduction (negative quantity) may lower the lines of its
 * rate, but not below zero: a document with a negative amount or negative VAT per rate is a credit note, not a quote
 * or an invoice.
 */
export const hasNegativeRate = (t: TaxTotals): boolean => t.byRate.some((r) => r.net < 0);

/* ---------- Drafts ---------- */

export interface LineDraft extends DiscountDraft {
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

export const emptyLineDraft = (key: string): LineDraft => ({
  key,
  name: '',
  description: '',
  quantity: '1',
  unit: DEFAULT_UNIT,
  unitPrice: '',
  vatRate: STANDARD_RATE,
  ...NO_DISCOUNT_DRAFT,
});

/** A new line with the text, unit, price and rate of a catalogue item; the quantity starts at 1, no discount */
export const lineDraftFromItem = (key: string, item: ItemProfile, locale: MoneyLocale): LineDraft => ({
  key,
  name: item.name,
  description: item.description,
  quantity: '1',
  unit: item.unit,
  unitPrice: formatDecimal(item.netPrice, locale),
  vatRate: item.vatRate,
  ...NO_DISCOUNT_DRAFT,
});

export const draftFromLine = (key: string, l: DocumentLine, locale: MoneyLocale): LineDraft => ({
  key,
  name: l.name,
  description: l.description,
  quantity: formatQuantity(l.quantity, locale),
  unit: l.unit,
  unitPrice: formatDecimal(l.unitPrice, locale),
  vatRate: l.vatRate,
  ...discountDraft(l.discount, locale),
});

/**
 * Checks the lines of a document draft; errors name the line and its field ("line.2.unitPrice"). Once every line
 * can be read, their sums must not be negative (`hasNegativeRate`); without VAT all lines are summed together.
 */
export function readLines<F extends string>(
  c: Checker<F | LineFieldPath | 'lines'>,
  drafts: readonly LineDraft[],
  locale: MoneyLocale,
  withoutVat: boolean,
): DocumentLine[] {
  if (drafts.length > DOCUMENT_LIMITS.lines) c.add('lines', 'tooManyLines');
  const lines = drafts.map((d, i): DocumentLine => {
    const name = c.text(linePath(i, 'name'), d.name, ITEM_LIMITS.name);
    const description = c.optionalText(linePath(i, 'description'), d.description, ITEM_LIMITS.description);
    const quantity = c.quantity(linePath(i, 'quantity'), d.quantity, locale, DOCUMENT_LIMITS.maxQuantity);
    const unitPrice = c.price(linePath(i, 'unitPrice'), d.unitPrice, locale, ITEM_LIMITS.maxNetPrice);
    const sized = c.passed(linePath(i, 'quantity')) && c.passed(linePath(i, 'unitPrice'));
    if (sized && !lineNetInRange(unitPrice, quantity)) c.add(linePath(i, 'quantity'), 'lineTooLarge');
    const limit = sized && lineNetInRange(unitPrice, quantity) ? magnitude(lineNet(unitPrice, quantity)) : null;
    const discount = readDiscount(c, linePath(i, 'discountValue'), d.discountKind, d.discountValue, locale, limit);
    return { name, description, quantity, unit: d.unit, unitPrice, vatRate: d.vatRate, discount };
  });
  const readable = drafts.every((_, i) => c.passed(linePath(i, 'quantity')) && c.passed(linePath(i, 'unitPrice')) && c.passed(linePath(i, 'discountValue')));
  if (readable && hasNegativeRate(documentTotals(lines, withoutVat, NO_DISCOUNT))) c.add('lines', 'negativeTotal');
  return lines;
}

/** Could every line be read? Only then the totals of the document are known, and its discount can be checked. */
export const linesReadable = (c: { readonly errors: readonly { readonly field: string }[] }): boolean =>
  !c.errors.some((e) => e.field === 'lines' || e.field.startsWith('line.'));

/**
 * Checks the discount of the whole document, after its lines: an amount is at most what the lines add up to, and the
 * totals must not be negative after it. Nothing is checked while a line cannot be read (`readable`).
 */
export function readDocumentDiscount<F extends string>(
  c: Checker<F>,
  field: F,
  draft: DiscountDraft,
  lines: readonly DocumentLine[],
  withoutVat: boolean,
  readable: boolean,
  locale: MoneyLocale,
): Discount {
  const limit = readable ? magnitude(documentTotals(lines, withoutVat, NO_DISCOUNT).net) : null;
  const discount = readDiscount(c, field, draft.discountKind, draft.discountValue, locale, limit);
  if (readable && c.passed(field) && hasNegativeRate(documentTotals(lines, withoutVat, discount))) c.add(field, 'discountTooLarge');
  return discount;
}

/** A draft line as a line, or null while its quantity, price or discount cannot be read */
export function draftLine(d: LineDraft, locale: MoneyLocale): DocumentLine | null {
  const qty = parseQuantity(d.quantity, locale);
  const price = parseCents(d.unitPrice, locale);
  if (qty === null || price === null || price < 0 || qty === 0 || Math.abs(qty) > DOCUMENT_LIMITS.maxQuantity || !lineNetInRange(price, qty)) return null;
  const discount = readableDiscount(d.discountKind, d.discountValue, locale, magnitude(lineNet(price, qty)));
  if (discount === null) return null;
  return { name: d.name, description: d.description, quantity: qty, unit: d.unit, unitPrice: price, vatRate: d.vatRate, discount };
}

/** The net amount of a draft line after its discount while it is typed, or null as long as it cannot be read */
export function draftLineNet(d: LineDraft, locale: MoneyLocale): Cents | null {
  const line = draftLine(d, locale);
  return line === null ? null : lineTotal(line);
}

/**
 * Totals of the draft lines that can be read already, and of the document discount if it can be read, for the editor.
 * A line or a discount that cannot be read yet is left out.
 */
export function draftTotals(drafts: readonly LineDraft[], locale: MoneyLocale, withoutVat: boolean, docDiscount: DiscountDraft = NO_DISCOUNT_DRAFT): DocumentTotals {
  const lines = drafts.flatMap((d) => {
    const line = draftLine(d, locale);
    return line === null ? [] : [line];
  });
  const net = documentTotals(lines, withoutVat, NO_DISCOUNT).net;
  const discount = readableDiscount(docDiscount.discountKind, docDiscount.discountValue, locale, magnitude(net)) ?? NO_DISCOUNT;
  return documentTotals(lines, withoutVat, discount);
}
