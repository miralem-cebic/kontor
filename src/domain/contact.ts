// Contacts: customers and suppliers of a company. The contact form edits a draft of plain strings; `readContact`
// checks it and turns it into a profile. The values that e-invoices need later (VAT ID, Leitweg-ID, order
// reference) are kept here as defaults; a document can change them.

import type { Result } from '../data/result';
import { Checker, DEFAULT_COUNTRY, type Address, type ContactDetails, type FieldError } from './check';
import { isPlausibleEuVatId, isPlausibleLeitwegId, normalizeVatId } from './taxIds';

/** A company (or other organisation) or a private person */
export type ContactKind = 'company' | 'person';

export interface ContactRoles {
  customer: boolean;
  supplier: boolean;
}

export interface ContactProfile {
  kind: ContactKind;
  roles: ContactRoles;
  /** Name of the company, or first and last name of the person */
  name: string;
  /** Second name line, for example a department or "c/o"; empty when not given */
  nameLine2: string;
  /** Contact person at a company; always empty for a person */
  contactPerson: string;
  /** Customer or supplier number, unique among the active contacts; empty when not given */
  customerNumber: string;
  /** null when no address was given (an invoice needs one; a supplier for expenses may not) */
  address: Address | null;
  /** email: where invoices go */
  contact: ContactDetails;
  /** VAT ID of an EU business (needed for reverse charge and intra-community supplies), normalized; empty when not given and for a person */
  vatId: string;
  /** Leitweg-ID of a public buyer (BT-10); empty when not given and for a person */
  leitwegId: string;
  /** Default order or PO number (purchase order reference, BT-13); empty when not given and for a person */
  orderReference: string;
  /** Payment term for this contact; null means the company's default */
  paymentTermDays: number | null;
  notes: string;
}

export const CONTACT_LIMITS = {
  name: 120,
  nameLine2: 120,
  contactPerson: 120,
  customerNumber: 30,
  vatId: 20,
  orderReference: 100,
  notes: 2000,
} as const;

/* ---------- Draft ---------- */

export interface ContactDraft {
  kind: ContactKind;
  customer: boolean;
  supplier: boolean;
  name: string;
  nameLine2: string;
  contactPerson: string;
  customerNumber: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  vatId: string;
  leitwegId: string;
  orderReference: string;
  /** Empty means the company's default */
  paymentTermDays: string;
  notes: string;
}

export type ContactField = keyof ContactDraft;
export type ContactFieldError = FieldError<ContactField>;

export const emptyContactDraft = (): ContactDraft => ({
  kind: 'company',
  customer: true,
  supplier: false,
  name: '',
  nameLine2: '',
  contactPerson: '',
  customerNumber: '',
  street: '',
  postalCode: '',
  city: '',
  country: DEFAULT_COUNTRY,
  email: '',
  phone: '',
  vatId: '',
  leitwegId: '',
  orderReference: '',
  paymentTermDays: '',
  notes: '',
});

export const draftFromContact = (p: ContactProfile): ContactDraft => ({
  kind: p.kind,
  customer: p.roles.customer,
  supplier: p.roles.supplier,
  name: p.name,
  nameLine2: p.nameLine2,
  contactPerson: p.contactPerson,
  customerNumber: p.customerNumber,
  street: p.address?.street ?? '',
  postalCode: p.address?.postalCode ?? '',
  city: p.address?.city ?? '',
  country: p.address?.country ?? DEFAULT_COUNTRY,
  email: p.contact.email,
  phone: p.contact.phone,
  vatId: p.vatId,
  leitwegId: p.leitwegId,
  orderReference: p.orderReference,
  paymentTermDays: p.paymentTermDays === null ? '' : String(p.paymentTermDays),
  notes: p.notes,
});

/* ---------- Checks ---------- */

const ADDRESS_FIELDS = { street: 'street', postalCode: 'postalCode', city: 'city', country: 'country' } as const;

/**
 * Checks a contact draft. `isNumberTaken` tells whether another active contact already has a customer number.
 * The address is optional, but when any of street, postal code or city is given, all of them are required.
 */
export function readContact(d: ContactDraft, isNumberTaken: (customerNumber: string) => boolean): Result<ContactProfile, ContactFieldError[]> {
  const c = new Checker<ContactField>();
  if (!d.customer && !d.supplier) c.add('customer', 'roleRequired');
  const name = c.text('name', d.name, CONTACT_LIMITS.name);
  const nameLine2 = c.optionalText('nameLine2', d.nameLine2, CONTACT_LIMITS.nameLine2);
  const isCompany = d.kind === 'company';
  const contactPerson = isCompany ? c.optionalText('contactPerson', d.contactPerson, CONTACT_LIMITS.contactPerson) : '';
  const customerNumber = c.optionalText('customerNumber', d.customerNumber, CONTACT_LIMITS.customerNumber);
  if (customerNumber && customerNumber.length <= CONTACT_LIMITS.customerNumber && isNumberTaken(customerNumber)) c.add('customerNumber', 'numberTaken');
  const hasAddress = [d.street, d.postalCode, d.city].some((v) => v.trim() !== '');
  const address = hasAddress ? c.address(ADDRESS_FIELDS, d) : null;
  const email = c.email('email', d.email, false);
  const phone = c.phone('phone', d.phone);
  // A private person has no VAT ID, is no public buyer and rarely has an order number: the form hides these fields
  const vatId = isCompany ? normalizeVatId(d.vatId) : '';
  if (vatId && !isPlausibleEuVatId(vatId)) c.add('vatId', 'euVatId');
  const leitwegId = isCompany ? d.leitwegId.trim() : '';
  if (leitwegId && !isPlausibleLeitwegId(leitwegId)) c.add('leitwegId', 'leitwegId');
  const orderReference = isCompany ? c.optionalText('orderReference', d.orderReference, CONTACT_LIMITS.orderReference) : '';
  const paymentTermDays = d.paymentTermDays.trim() === '' ? null : c.paymentTerm('paymentTermDays', d.paymentTermDays);
  const notes = c.optionalText('notes', d.notes, CONTACT_LIMITS.notes);
  return c.done(() => ({
    kind: d.kind,
    roles: { customer: d.customer, supplier: d.supplier },
    name,
    nameLine2,
    contactPerson,
    customerNumber,
    address,
    contact: { email, phone },
    vatId,
    leitwegId,
    orderReference,
    paymentTermDays,
    notes,
  }));
}

/* ---------- Lists ---------- */

/** Does the contact match a search text? Name, second line, contact person, number, city and email are searched. */
export function contactMatches(p: ContactProfile, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  return [p.name, p.nameLine2, p.contactPerson, p.customerNumber, p.address?.city ?? '', p.contact.email].some((v) => v.toLocaleLowerCase('de').includes(q));
}

export const byContactName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
