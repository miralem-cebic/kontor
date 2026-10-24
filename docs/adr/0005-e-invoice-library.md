# 0005: Library for e-invoices

- Status: Accepted
- Date: 2026-10-21
- Spike: branch `spike/e-invoice`, folder `spikes/e-invoice` (not merged into `main`)

## Context

kontor has to create e-invoices (ZUGFeRD / Factur-X profile EN 16931 or XRECHNUNG as PDF/A-3 with embedded XML, and plain XRechnung CII XML) and read incoming ones (XRechnung XML, ZUGFeRD PDF). Every business must be able to receive e-invoices since 2025, small businesses included.

kontor does not stop at reading: every business can issue legally compliant e-invoices, also where the law does not require it yet (small businesses under § 19 UStG, regular businesses in the transition period). The size of the app is not a criterion: it is opened from disk, not downloaded.

The candidate was `@e-invoice-eu/core` 3.4.1, which says it runs in the browser. The spike checked it against kontor's build: one classic IIFE script opened via `file://`, a Content Security Policy with `script-src 'self'` (no `unsafe-eval`) and `connect-src 'none'`. It ran in Chrome 155 with the same Vite setup and CSP plugin as the app, and a sample invoice with two VAT rates (19 % and 7 %).

## Findings

| Check | `@e-invoice-eu/core` | Own code with `@cantoo/pdf-lib` |
| --- | --- | --- |
| Loads in the IIFE build | ES module: no, it imports Node built-ins (`fs`, `child_process`, `events`, `tmp-promise`); fails with `Class extends value undefined`. Browser bundle (UMD): yes | yes |
| XRechnung CII under the CSP | **no**: Ajv compiles the JSON schema with `new Function`, refused without `unsafe-eval` | yes, DOM APIs (`createElementNS`, `XMLSerializer`), 4 ms |
| ZUGFeRD EN 16931 PDF/A-3 | **no**: even with `unsafe-eval`, the browser bundle fails with `require is not defined` (`setTrailerInfoID`) | yes: embedded font, `factur-x.xml` as associated file (`AFRelationship /Alternative`), PDF/A-3 and Factur-X XMP |
| Network | fetches locale files (`…/e-invoice-eu.mo.json`), refused by `connect-src 'none'` | none |
| Read incoming XML | not offered (generation only) | yes, `DOMParser` and XPath, no library |
| Read incoming ZUGFeRD | not offered | yes, embedded file from the `EmbeddedFiles` name tree |
| Size (minified / gzip) | ES module bundled 1.18 MB / 404 KB; browser bundle in the app 2.1 MB / 791 KB | `@cantoo/pdf-lib` 566 KB / 244 KB, `@pdf-lib/fontkit` 757 KB / 340 KB, own code a few KB |
| Licence | WTFPL (also `@esgettext/runtime`); dependencies MIT, Apache-2.0 (`@e965/xlsx`), BSD-3-Clause, 0BSD | MIT (`@cantoo/pdf-lib`, `@pdf-lib/fontkit`, `pako` MIT/Zlib) |
| Runtime dependencies | `@cantoo/pdf-lib`, `@e965/xlsx`, `@esgettext/runtime`, `ajv`, `jsonpath-plus`, `tmp-promise`, `tslib`, `xmlbuilder2` | `@cantoo/pdf-lib`, `@pdf-lib/fontkit` |

In Node, `@e-invoice-eu/core` produced both formats without problems.

Not covered by the spike:

- No validation yet. The KoSIT validator for the XML and veraPDF for PDF/A-3 need Java, which was not available. Both are planned for CI.
- The PDF still lacks the output intent with an embedded sRGB ICC profile that PDF/A requires.
- Font subsetting failed for a WOFF file in fontkit (`serializeFont`). Embedding the whole font worked; subsetting has to be tried with TTF files.

## Decision

- Do **not** use `@e-invoice-eu/core` in the app. It needs `unsafe-eval`, loads files over the network, and its ZUGFeRD path does not run in the browser. A fork without Ajv's runtime compilation would be a maintenance burden of its own.
- Build the e-invoice layer in kontor:
  - `src/domain/einvoice/`: a mapping from kontor documents to the EN 16931 semantic model (BT/BG terms), with the checks kontor can do itself (mandatory fields, totals in cents via `money.ts`, VAT breakdown per rate).
  - A CII serializer with DOM APIs; UBL later if needed.
  - A reader for incoming CII and UBL with `DOMParser`/XPath, and for ZUGFeRD via the embedded file.
  - ZUGFeRD / Factur-X with `@cantoo/pdf-lib` and `@pdf-lib/fontkit`. Phase 1 needs both anyway for the invoice PDF. Add XMP, the output intent with an sRGB ICC profile, and embedded TTF fonts.
- "Legally compliant" is checked, not assumed. Fixtures for every supported case are generated from kontor's own code and validated in CI: the KoSIT validator with the XRechnung configuration for the XML, veraPDF (PDF/A-3B) and a ZUGFeRD validator (for example Mustang) for the PDF. The cases cover at least: regular VAT with 19 % and 7 %, small business (VAT category E with the exemption reason "Kleinunternehmer gemäß § 19 UStG"), reverse charge (§ 13b UStG, category AE), intra-community supply (category K, VAT IDs of both parties), credit note and cancellation, partial payment terms. A failing validation fails the build; a format is offered in the app only once its fixtures pass.
- Every e-invoice format is available to every business. For regular businesses it becomes the default once the transition period ends for them; small businesses can choose it.
- `@e-invoice-eu/core` can be a dev dependency in Node to cross-check our XML against a second implementation.

## Consequences

- The app's runtime dependencies grow by `@cantoo/pdf-lib` and `@pdf-lib/fontkit`, about 1.3 MB minified, in Phase 1 for the PDF. This is accepted: the build stays one script, read from disk.
- kontor owns the EN 16931 mapping and has to follow new XRechnung versions (currently 3.0) itself. The CI validation against the official artefacts is the safety net; updating the validator configuration is part of every XRechnung release.
- The CI needs Java for the validators.
- The CSP stays as it is: no `unsafe-eval`, no network.

## Alternatives considered

- **`@e-invoice-eu/core` with `unsafe-eval` in the CSP:** breaks a rule of the project, and ZUGFeRD still fails in the browser.
- **Patching or forking `@e-invoice-eu/core`:** standalone Ajv validators and browser shims are possible, but the fork would carry the spreadsheet and LibreOffice code kontor does not need.
- **Generating e-invoices in a separate local helper (Node or Java):** works with any library, but contradicts the double-click `file://` distribution. Could be revisited together with ELSTER (R7).

## Update (24 October 2026): fontkit

The invoice PDF of Phase 1 uses `@cantoo/fontkit` instead of `@pdf-lib/fontkit`. The failed font subsetting in the spike did not come from the WOFF file: `@cantoo/pdf-lib` calls `encode()` on the subset, which `@cantoo/fontkit` provides, while `@pdf-lib/fontkit` expects `encode(stream)`. With `@cantoo/fontkit`, the static TTF files of Inter are embedded as subsets (a one-page invoice is under 20 KB). The PDF already has the sRGB output intent; the XMP metadata with the PDF/A identification and the validation with veraPDF follow with the e-invoice.
