# 0002: One folder per company

- Status: Accepted
- Date: 2026-10-21

## Context

One person may run several businesses: a freelance activity and a trade, or a business of their own and one with a partner. Each has its own tax number, VAT status, bank account, invoice number range and bookkeeping. The data of one business must not mix with another's.

## Decision

- Every company is one folder with its own `company.json` and all its files. A folder holds at most one company.
- The app remembers several folder handles in IndexedDB (database `kontor`, store `companies`, keyed by company ID), with the company name for display. A switcher in the sidebar lists them and offers "Add company".
- The company opened last is stored per browser (`localStorage`, `kontor.prefs.v1`) and opened again on the next start.
- "Add company" runs the setup assistant. A chosen folder that already contains a company is opened directly; an empty folder becomes the company folder; a folder with other files gets a subfolder named after the company.
- A folder whose company ID is already known under another folder is refused as a copy, so that two folders cannot be mixed up as the same company.

## Consequences

- Companies can live in different places: one on Nextcloud, one on OneDrive.
- A tax advisor gets access to exactly one company's folder.
- Backups and exports are separate per company.
- App-wide data (the list of folders, the last selection, the language) lives in the browser, not in any folder. Another browser or computer asks for the folder the first time.
- Switching closes one company and opens another: pending writes are flushed first, and the browser may ask for permission.
- Reports across companies need to read several folders; this is left for later. It matters most for VAT: several businesses of one person are one business for VAT (§ 2 Abs. 1 Satz 2 UStG), so the small business limit and the advance return (UStVA) cover all of them together. Until kontor adds them up, the setup assistant tells users to choose the same VAT settings in every company of the same person.

## Alternatives considered

- **One folder with a subfolder per company:** simpler to list, but forces all companies into one storage location and one access scope.
- **One file per company inside a shared app folder:** the same drawbacks, plus a large shared file.
