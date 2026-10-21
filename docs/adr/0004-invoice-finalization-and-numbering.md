# 0004: Invoice finalization and numbering

- Status: Accepted (implementation in Phase 1)
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

## Consequences

- An issued invoice can be checked against its hash at any time; the GoBD package (R6) builds on that.
- Users cannot "fix" a typo in an issued invoice; the UI must make cancellation and correction easy.
- A sync conflict on the range file is visible and has to be resolved by the user, instead of producing duplicate numbers.

## Alternatives considered

- **Numbers assigned when a draft is created:** gaps appear when drafts are discarded.
- **A lock file only:** a stale lock after a crash blocks issuing; a reservation that is checked after writing gives the same detection without a lock to clean up.
- **A central number service:** contradicts ADR 0001.
