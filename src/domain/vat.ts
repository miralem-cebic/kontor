// Value added tax rates (§ 12 UStG) offered for items and document lines. They have applied since 1 January 2007,
// apart from the temporary cut from July to December 2020.
// Source: § 12 Abs. 1 and 2 UStG, https://www.gesetze-im-internet.de/ustg_1980/__12.html

import { basisPoints, type BasisPoints } from './money';

/** Standard rate, § 12 Abs. 1 UStG */
export const STANDARD_RATE = basisPoints(1900);
/** Reduced rate, § 12 Abs. 2 UStG (for example books and cultural events) */
export const REDUCED_RATE = basisPoints(700);
/** No German VAT; the document states the reason (exemption, reverse charge, supply abroad) */
export const ZERO_RATE = basisPoints(0);

/** The rates to choose from, highest first */
export const VAT_RATES: readonly BasisPoints[] = [STANDARD_RATE, REDUCED_RATE, ZERO_RATE];

export const isVatRate = (v: unknown): v is BasisPoints => typeof v === 'number' && (VAT_RATES as readonly number[]).includes(v);

/**
 * Member states of the EU as ISO 3166-1 codes (the country of an address), for the rules on supplies to businesses
 * in other member states (§ 14a UStG). Greece is GR here; its VAT IDs start with EL.
 */
const EU_MEMBER_STATES = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'] as const;

export const isEuMemberState = (country: string): boolean => (EU_MEMBER_STATES as readonly string[]).includes(country);
