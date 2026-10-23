import { PARAMS_2026 } from './2026';
import { PARAMS_2027 } from './2027';
import type { TaxYearParams } from './types';

// Everything that depends on the tax year comes from here (CLAUDE.md, "Finance rules"). A new year gets its own file
// once its values are known.

export type { TaxYearParams } from './types';

/** The known tax years, oldest first */
export const KNOWN_TAX_YEARS = [PARAMS_2026, PARAMS_2027] as const;

/**
 * The parameters of a tax year. A year before the first known one gets the first (kontor goes back no further), a
 * later year the last known one until its own file is added.
 */
export const taxParams = (year: number): TaxYearParams => KNOWN_TAX_YEARS.findLast((p) => p.year <= year) ?? KNOWN_TAX_YEARS[0];
