// Branded IDs: a company ID cannot be passed where another kind of ID is expected, and the compiler checks it.
// A value gets its brand only where it comes from a trusted source: the validators at the file boundary
// (validate.ts) and the generators below.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CompanyId = Brand<string, 'CompanyId'>;
export type ContactId = Brand<string, 'ContactId'>;
/** A bank account of a company; unique within the company */
export type AccountId = Brand<string, 'AccountId'>;
export type ItemId = Brand<string, 'ItemId'>;
/** A quote or an invoice */
export type DocumentId = Brand<string, 'DocumentId'>;

/** Adds a brand to a string that has been checked by the caller. The one place where the brand is added. */
export const brandId = <B extends string>(value: string): Brand<string, B> => value as Brand<string, B>;

export const newCompanyId = (): CompanyId => brandId<'CompanyId'>(crypto.randomUUID());
export const newContactId = (): ContactId => brandId<'ContactId'>(crypto.randomUUID());
export const newAccountId = (): AccountId => brandId<'AccountId'>(crypto.randomUUID());
export const newItemId = (): ItemId => brandId<'ItemId'>(crypto.randomUUID());
export const newDocumentId = (): DocumentId => brandId<'DocumentId'>(crypto.randomUUID());

/**
 * The ID of the cancellation of an invoice: a UUID made from the invoice's ID (name-based with SHA-256, version 8 of
 * RFC 9562). It follows from the invoice, so that a second attempt, also on another device, issues the same
 * cancellation instead of a second one, and like every record it is a UUID.
 */
export async function cancellationId(invoiceId: DocumentId): Promise<DocumentId> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kontor:cancellation:${invoiceId}`))).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return brandId<'DocumentId'>(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}

/** The keys of a record, typed as the record's key type. Object.keys only knows `string`; the record was built with these keys. */
export const keysOf = <K extends string>(record: Partial<Record<K, unknown>>): K[] => Object.keys(record) as K[];
