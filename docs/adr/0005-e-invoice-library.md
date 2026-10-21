# 0005: Library for e-invoices

- Status: Proposed (decide before Phase 2)
- Date: 2026-10-21
- Spike: branch `spike/e-invoice`, folder `spikes/e-invoice` (not merged into `main`)

## Context

kontor has to create e-invoices (ZUGFeRD / Factur-X profile EN 16931 or XRECHNUNG as PDF/A-3 with embedded XML, and plain XRechnung CII XML) and read incoming ones (XRechnung XML, ZUGFeRD PDF). Every business must be able to receive e-invoices since 2025, small businesses included.

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

## Decision (proposed)

- Do **not** use `@e-invoice-eu/core` in the app. It needs `unsafe-eval`, loads files over the network, and its ZUGFeRD path does not run in the browser. A fork without Ajv's runtime compilation would be a maintenance burden of its own.
- Build the e-invoice layer in kontor:
  - `src/domain/einvoice/`: a mapping from kontor documents to the EN 16931 semantic model (BT/BG terms), with the checks kontor can do itself (mandatory fields, totals in cents via `money.ts`, VAT breakdown per rate).
  - A CII serializer with DOM APIs; UBL later if needed.
  - A reader for incoming CII and UBL with `DOMParser`/XPath, and for ZUGFeRD via the embedded file.
  - ZUGFeRD / Factur-X with `@cantoo/pdf-lib` and `@pdf-lib/fontkit`. Phase 1 needs both anyway for the invoice PDF. Add XMP, the output intent with an sRGB ICC profile, and embedded TTF fonts.
- Validate generated fixtures in CI with the KoSIT validator (XRechnung configuration) and veraPDF (PDF/A-3B). `@e-invoice-eu/core` can be a dev dependency in Node to cross-check our XML against a second implementation.

## Consequences

- The app's runtime dependencies grow by `@cantoo/pdf-lib` and `@pdf-lib/fontkit`, about 1.3 MB minified (about 0.6 MB gzip), in Phase 1 for the PDF. The build stays one script; under `file://` the size costs load time from disk, not network.
- kontor owns the EN 16931 mapping and has to follow new XRechnung versions (currently 3.0) itself. CI validation against the official artefacts is the safety net.
- The CSP stays as it is: no `unsafe-eval`, no network.

## Alternatives considered

- **`@e-invoice-eu/core` with `unsafe-eval` in the CSP:** breaks a rule of the project, and ZUGFeRD still fails in the browser.
- **Patching or forking `@e-invoice-eu/core`:** standalone Ajv validators and browser shims are possible, but the fork would carry the spreadsheet and LibreOffice code kontor does not need.
- **Generating e-invoices in a separate local helper (Node or Java):** works with any library, but contradicts the double-click `file://` distribution. Could be revisited together with ELSTER (R7).
