# 0003: Money as integer cents

- Status: Accepted
- Date: 2026-10-21

## Context

Binary floating point numbers cannot represent most decimal amounts exactly (`0.1 + 0.2 !== 0.3`). In invoices, VAT returns and the EÜR, an error of one cent is visible, can make an e-invoice fail validation, and erodes trust.

## Decision

- Amounts are integer euro cents, typed as the branded `Cents`. Rates are basis points (`BasisPoints`, `1900` = 19 %). Quantities are thousandths (`Quantity`, `1500` = 1.5). Constructors reject values that are not safe integers.
- All arithmetic and rounding is in `src/domain/money.ts`. Products and quotients go through `BigInt` and are rounded exactly once, half away from zero ("kaufmännisch").
- VAT on a document is computed **per document** by default: net amounts are summed per rate, and the tax is computed once per rate. EN 16931 requires this for e-invoices (BR-CO-17). **Per line** rounding is available explicitly for documents that are not e-invoices; the two modes differ by at most half a cent per line, which a property test checks.
- `splitGross` splits a gross amount (expenses) into net and tax so that the two always add up to the gross amount.
- Text input and output use exact decimal strings (`Intl.NumberFormat` with a string value), never `cents / 100`.

## Consequences

- Sums are exact and independent of the order of the lines (tested).
- Every place that shows or reads an amount has to go through `formatCents` and `parseCents`.
- File formats store integers (cents, basis points). A file with a float where an integer is expected fails validation.
- The safe integer range limits amounts to about 90 trillion euro, far beyond any use.

## Alternatives considered

- **Decimal libraries (decimal.js, big.js):** exact, but a runtime dependency for operations that integers cover, and a second number type throughout the code.
- **Floats with rounding at the end:** simple, but errors accumulate and hide until a sum is off by a cent.
