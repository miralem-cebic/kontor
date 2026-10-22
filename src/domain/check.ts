// Checks for form drafts, shared by the company profile and contacts: a field either passes or gets a problem code;
// the UI turns codes into text (lib/labels.ts). The values are returned only when every field passed.

import { err, ok, type Result } from '../data/result';
import { ibanProblem, isValidBic, normalizeIban, type IbanProblem } from './iban';
import { cents, parseCents, parseQuantity, quantity, type Cents, type MoneyLocale, type Quantity } from './money';
import type { PatternProblem } from './numbering';

export type FieldProblem =
  | 'required'
  | 'tooLong'
  | 'email'
  | 'phone'
  | 'postalCode'
  | 'country'
  | 'taxIdRequired'
  | 'taxNumber'
  | 'vatId'
  | 'euVatId'
  | 'leitwegId'
  | 'multiplier'
  | 'bic'
  | 'paymentTerm'
  | 'roleRequired'
  | 'numberTaken'
  | 'accountTaken'
  | 'itemNumberTaken'
  | 'price'
  | 'priceNegative'
  | 'quantity'
  | 'lineTooLarge'
  | 'tooManyLines'
  | 'negativeTotal'
  | 'date'
  | 'validUntil'
  | `iban.${IbanProblem}`
  | `pattern.${PatternProblem}`;

export interface FieldError<F extends string> {
  field: F;
  problem: FieldProblem;
}

export const TEXT_LIMITS = {
  street: 120,
  city: 80,
  email: 254,
  phone: 40,
  maxPaymentTermDays: 365,
} as const;

export const DEFAULT_COUNTRY = 'DE';

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2, for example "DE" */
  country: string;
}

export interface ContactDetails {
  /** Empty when not given (optional for contacts) */
  email: string;
  /** Empty when not given */
  phone: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()/ -]+$/;
const GERMAN_POSTAL_CODE = /^\d{5}$/;
const OTHER_POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

export class Checker<F extends string> {
  readonly errors: FieldError<F>[] = [];

  add(field: F, problem: FieldProblem) {
    this.errors.push({ field, problem });
  }

  /** Has the field passed every check so far? */
  passed(field: F): boolean {
    return !this.errors.some((e) => e.field === field);
  }

  /** A required text: trimmed, not empty, not longer than `max` */
  text(field: F, value: string, max: number): string {
    const v = value.trim();
    if (!v) this.add(field, 'required');
    else if (v.length > max) this.add(field, 'tooLong');
    return v;
  }

  /** An optional text: trimmed, not longer than `max` */
  optionalText(field: F, value: string, max: number): string {
    const v = value.trim();
    if (v.length > max) this.add(field, 'tooLong');
    return v;
  }

  /** A choice that must have been made */
  chosen<T>(field: F, value: T | null): T | null {
    if (value === null) this.add(field, 'required');
    return value;
  }

  /** An email address; empty is allowed unless `required` */
  email(field: F, value: string, required: boolean): string {
    const v = required ? this.text(field, value, TEXT_LIMITS.email) : this.optionalText(field, value, TEXT_LIMITS.email);
    if (v && v.length <= TEXT_LIMITS.email && !EMAIL.test(v)) this.add(field, 'email');
    return v;
  }

  /** A phone number; empty is allowed */
  phone(field: F, value: string): string {
    const v = this.optionalText(field, value, TEXT_LIMITS.phone);
    if (v && v.length <= TEXT_LIMITS.phone && !PHONE.test(v)) this.add(field, 'phone');
    return v;
  }

  /** A required IBAN, normalized: capitals, no spaces */
  iban(field: F, value: string): string {
    const v = normalizeIban(value);
    if (!v) this.add(field, 'required');
    else {
      const problem = ibanProblem(v);
      if (problem) this.add(field, `iban.${problem}`);
    }
    return v;
  }

  /** A BIC in capitals; empty is allowed (optional within SEPA) */
  bic(field: F, value: string): string {
    const v = value.trim().toUpperCase();
    if (v && !isValidBic(v)) this.add(field, 'bic');
    return v;
  }

  /** A required price typed in the interface language: not negative, at most `max` cents */
  price(field: F, value: string, locale: MoneyLocale, max: number): Cents {
    if (!value.trim()) {
      this.add(field, 'required');
      return cents(0);
    }
    const amount = parseCents(value, locale);
    if (amount === null || amount > max) this.add(field, 'price');
    else if (amount < 0) this.add(field, 'priceNegative');
    return amount ?? cents(0);
  }

  /** A required quantity typed in the interface language: not 0, at most `max` thousandths either way */
  quantity(field: F, value: string, locale: MoneyLocale, max: number): Quantity {
    if (!value.trim()) {
      this.add(field, 'required');
      return quantity(0);
    }
    const qty = parseQuantity(value, locale);
    if (qty === null || qty === 0 || Math.abs(qty) > max) this.add(field, 'quantity');
    return qty ?? quantity(0);
  }

  /** A whole number of days from 0 to the limit */
  paymentTerm(field: F, value: string): number {
    const v = value.trim();
    const days = Number(v);
    if (!/^\d+$/.test(v) || days > TEXT_LIMITS.maxPaymentTermDays) this.add(field, 'paymentTerm');
    return days;
  }

  /** Street, postal code (five digits in Germany), city and country code; all of them are required */
  address(fields: Record<keyof Address, F>, value: Address): Address {
    const street = this.text(fields.street, value.street, TEXT_LIMITS.street);
    const city = this.text(fields.city, value.city, TEXT_LIMITS.city);
    const country = value.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) this.add(fields.country, 'country');
    const postalCode = value.postalCode.trim();
    if (!postalCode) this.add(fields.postalCode, 'required');
    else if (!(country === 'DE' ? GERMAN_POSTAL_CODE : OTHER_POSTAL_CODE).test(postalCode)) this.add(fields.postalCode, 'postalCode');
    return { street, postalCode, city, country };
  }

  done<T>(value: () => T): Result<T, FieldError<F>[]> {
    return this.errors.length ? err(this.errors) : ok(value());
  }
}
