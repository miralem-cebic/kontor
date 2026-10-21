// Branded IDs: a company ID cannot be passed where another kind of ID is expected, and the compiler checks it.
// A value gets its brand only where it comes from a trusted source: the validators at the file boundary
// (validate.ts) and the generators below.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CompanyId = Brand<string, 'CompanyId'>;

/** Adds a brand to a string that has been checked by the caller. The one place where the brand is added. */
export const brandId = <B extends string>(value: string): Brand<string, B> => value as Brand<string, B>;

export const newCompanyId = (): CompanyId => brandId<'CompanyId'>(crypto.randomUUID());

/** The keys of a record, typed as the record's key type. Object.keys only knows `string`; the record was built with these keys. */
export const keysOf = <K extends string>(record: Partial<Record<K, unknown>>): K[] => Object.keys(record) as K[];
