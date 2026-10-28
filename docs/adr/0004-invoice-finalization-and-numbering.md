# 0004: Invoice finalization and numbering

- Status: Accepted; issuing and cancelling implemented on 24 October 2026 (`src/app/issue.ts`), finalizing quotes on 28 October 2026, correction invoices open
- Date: 2026-10-21

## Context

German law and the GoBD (principles for proper bookkeeping in electronic form) expect that issued invoices cannot be changed without trace and that invoice numbers are unique (§ 14 Abs. 4 Nr. 4 UStG: a consecutive number, assigned once). kontor stores its data in a folder that a sync client may share between devices, without a server that could hand out numbers atomically.

## Decision

### Finalization

- A document is a draft until it is issued. Drafts are never written to disk as issued documents.
- Issuing assigns the number, takes a snapshot of the master data (company, customer, bank details) into the document, writes the PDF (and the XML of an e-invoice) to `documents/issued/<number>.pdf|.xml`, and stores the SHA-256 of each file in the document record.
- An issued document and its files are immutable. Nothing overwrites them, including the field-level merge, which never touches an issued document.
- A correction is a cancellation (Storno) or correction invoice with its own number and a reference to the original.
- Issue, cancel, record payment and link receipt each append an entry to `audit/<YYYY-MM>.jsonl`.
- Changes to the company profile do not change issued documents: they keep their snapshot.

### Numbering

- Numbers are sequential per company and number range (`numbering/<range>.json`), formatted by a pattern such as `RE-{YYYY}-{NNNN}` (`src/domain/numbering.ts`). Only letters, digits, `-` and `_` are allowed, because the number becomes a file name.
- A number is assigned only when the document is issued, never for a draft, and is never reused, also not after a cancellation.
- Before assigning, kontor reads the existing numbers and issued files, then writes a reservation (number, document ID, device, timestamp) to the range file, reads it back and checks that its reservation is the one that holds. On any conflict it stops and reports; it never silently assigns a number twice.
- **Assumption for the MVP:** only one device writes to a company at a time. The reservation detects violations of this assumption; it does not make concurrent issuing safe. The README tells users not to edit one company on two devices at the same time.
- **Yearly restart:** when the pattern contains a year (`{YYYY}` or `{YY}`), the counter starts again at 1 in every calendar year, counted by the invoice date: `RE-2026-0042` is followed by `RE-2027-0001`. Without a year in the pattern the counter runs on across years (a month alone, `{MM}`, does not restart it). The range file keeps the last number per year.
- Uniqueness is checked on the full formatted number against all issued documents of the company. Changing the pattern during a year therefore cannot produce a duplicate unnoticed.

### Cancellation (added 24 October 2026)

- A cancellation invoice reverses an issued invoice as a whole: the same lines with the opposite quantity, so every amount and the VAT per rate are the invoice's with the opposite sign. It names the invoice it cancels by number and date (§ 31 Abs. 5 UStDV: a correction refers specifically and unambiguously to the invoice it corrects).
- It is issued at once, with the next number of the invoice range: one consecutive range for invoices and cancellations, so there is no second pattern to set up. It is dated on the day of cancelling, never before the invoice, and counted in that year.
- It takes the snapshot of the cancelled invoice, not the current master data: it reverses what the invoice said, also when the company switched its VAT scheme or the customer moved since.
- The cancelled invoice does not change. It counts as cancelled because a cancellation refers to it. The cancellation's ID is derived from the invoice's ID, so an invoice has at most one cancellation, and a second attempt finishes the first one.
- The corrected invoice is a new invoice: "Copy as new invoice" starts a draft with everything from the cancelled one.
- A correction of a part of an invoice (a correction invoice with only the difference) is not covered yet.

### Quotes (added 28 October 2026)

- A quote is a draft until it is finalized ("Angebot abschließen", the status "sent" of F21 in the roadmap). Finalizing works like issuing an invoice: the number is reserved and read back, a snapshot of the master data is taken (with the company's default account, which the footer of the quote shows), the PDF is written once without the draft marks with its SHA-256, and the audit log gets an entry (`issueQuote`). From then on the quote never changes, also not by the merge. A changed offer will be a new version (F22); until then it starts as a copy.
- Quotes have a number range of their own: `numbering/quote.json` with the pattern `invoiceDefaults.quotePattern` (default `AN-{YYYY}-{NNNN}`), restarting every year by the date of the quote like invoices, and a folder of their own for the PDFs, `documents/quotes/`. The two ranges never block each other, also when two patterns produce the same text; the settings still require a quote pattern other than the invoice pattern, so that a quote number is not mistaken for an invoice number.
- Quote numbers need no gapless sequence (§ 14 Abs. 4 Nr. 4 UStG is about invoices), but they are unique and never given twice, with the same reservation as invoices.
- A quote needs a customer, at least one line and a validity that has not run out. It needs no address: it is no invoice.

## Consequences

- An issued invoice can be checked against its hash at any time; the GoBD package (R6) builds on that.
- Users cannot "fix" a typo in an issued invoice; the UI must make cancellation and correction easy.
- A sync conflict on the range file is visible and has to be resolved by the user, instead of producing duplicate numbers.

## Alternatives considered

- **Numbers assigned when a draft is created:** gaps appear when drafts are discarded.
- **A lock file only:** a stale lock after a crash blocks issuing; a reservation that is checked after writing gives the same detection without a lock to clean up.
- **A central number service:** contradicts ADR 0001.
