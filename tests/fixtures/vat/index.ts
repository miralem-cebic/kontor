// The VAT reference scenarios (#37), run by tests/unit/vatScenarios.test.ts. One file per topic; see helpers.ts for the shape.

import type { VatScenario } from './helpers';
import { scenarios as rounding } from './01-regular-vat-rounding';
import { scenarios as foreign } from './02-eu-and-foreign-supplies';
import { scenarios as boundaries } from './03-period-boundaries';
import { scenarios as cashAccrual } from './04-cash-and-accrual';
import { scenarios as smallBusiness } from './05-small-business-and-expenses';

export const scenarios: VatScenario[] = [...rounding, ...foreign, ...boundaries, ...cashAccrual, ...smallBusiness];
export { limitCases } from './06-small-business-limits';
export { pendingScenarios } from './pending';
