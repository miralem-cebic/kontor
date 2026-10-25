# CLAUDE.md

Guidance for AI agents working in this repository. Details live in [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the decisions in [docs/adr/](docs/adr/).

kontor is a local invoicing and cash-basis accounting app (EÜR) for self-employed people in Germany. It runs entirely in the browser from `dist/index.html` (`file://`), without server, database, user accounts or network access. Every company has its own folder of JSON files, chosen by the user through the File System Access API.

## Commands

Run these before a change is done. They are the same checks CI runs:

```bash
npm run verify        # typecheck, lint, tests, build and check:file in one go
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm test              # vitest unit tests (tests/unit)
npm run build         # typecheck + production build into dist/
npm run check:file    # opens dist/index.html via file:// and checks the build
npm run test:e2e      # Playwright against dist/index.html (needs installed Chrome)
```

## Working agreement

- **Test first.** Write the failing test, watch it fail for the right reason, then implement. A bug fix starts with a test that reproduces the bug.
- **Done means verified.** A change is done when `npm run verify` is green (zero lint warnings) and you have read its output.

## Layering

- `src/domain/` is pure: money, tax identifiers, number patterns, the company profile and its checks. No I/O, no React, no store. It imports only from `src/domain/` and the generic `src/data/result.ts`.
- `src/data/` (file formats, validation, migrations, merge, persister, maintenance) never imports from `src/features/` or `src/components/`.
- Only `src/data/fs/` talks to the File System Access API. Everything else goes through the `Repository` interface.
- `src/store/appStore.ts` owns every state change. Components dispatch actions; they do not write files. `src/app/session.ts` runs the startup flow and the actions that need the folder (setup, logo).
- User-facing text goes only through `src/i18n/` and must exist in both languages, `de` (primary) and `en`.

## Data invariants

- Anything read from a company folder, a backup, IndexedDB or `localStorage` is untrusted until it has passed validation at the boundary (`src/data/validate.ts`, via `migrate` in `src/data/migrations.ts`). Do not use `JSON.parse(...) as T`.
- Records keyed by IDs that come from file content use `Map` or a null-prototype object. IDs match `[A-Za-z0-9_-]` and are never names like `__proto__` or `constructor` (`isValidId`). IDs are branded types (`src/data/ids.ts`).
- Every change to a mergeable field sets that field's `fieldUpdatedAt` entry (`updateCompany` does it). The field-level merge depends on it.
- Deletes are soft (`deletedAt`). Physical removal of files happens only in `src/data/maintenance.ts`.
- Drafts are never written to disk: the setup assistant and the settings forms keep their state in memory until the user finishes or saves.
- Links: only `http:` and `https:` may become an `href`.
- File names that come from file content (logo, later invoice numbers) are checked before any file access.

## Finance rules

- Money is never a float. Amounts are integer cents (`Cents`), rates are basis points (`1900` = 19 %), quantities are thousandths. All rounding happens in `src/domain/money.ts` (half away from zero); the tax of a document is rounded per rate (`perDocument`, required for e-invoices) unless `perLine` is chosen explicitly. Sums and rounding have property tests.
- An issued invoice is immutable. Corrections are cancellation or correction invoices that reference it. On issue, the PDF (and XML) are written to `documents/issued/` with their SHA-256 in the record; such a file is never overwritten, not even by the merge. (Phase 1, see ADR 0004.)
- Invoice numbers are sequential per company and number range, assigned only on issue, never reused. With `{YYYY}` or `{YY}` in the pattern the counter restarts at 1 every calendar year (invoice date). Before assigning: check existing numbers and write a reservation file with a timestamp; on a conflict, stop and report, never assign a number twice. MVP assumption: one writer per company at a time. (Phase 1, see ADR 0004.)
- Issue, cancel, record payment, link receipt: each writes an append-only audit entry (`audit/<YYYY-MM>.jsonl`). (Phase 1.)
- Everything that depends on the tax year (income tax tariff § 32a EStG, solidarity surcharge threshold, trade tax allowance and base rate, small business limits, UStVA fields, Anlage EÜR lines) lives in `src/domain/tax/params/<year>.ts`, with the source (paragraph and URL) in a comment and tests with worked examples. No magic numbers elsewhere.
- No tax advice: calculators and exports are labelled as estimates and filling aids, in the UI and in the README.

## Build constraints (`file://`)

The app must run by double-clicking `dist/index.html` in Chrome or Edge:

- Single classic IIFE script (`vite.config.ts`), no `type="module"`, no `crossorigin` (`build/fileProtocol.ts` enforces this).
- No code splitting, no network requests, no runtime dependencies beyond those in `package.json`.
- Fonts are embedded as `data:` URLs. The Content Security Policy is active (`connect-src 'none'`).

## Schema changes

1. Increase `SCHEMA_VERSION` in `src/data/schema.ts`.
2. Add a `{ from: n, up(raw) }` step in `src/data/migrations.ts` for each file kind (`unchanged(n)` for kinds that did not change).
3. Add a migration test in `tests/unit/migrations.test.ts` (there is a template).

## Conventions

- Code, comments, log messages and test names are in English. The README is in German, for the people who use kontor.
- Commit messages and pull request titles follow Conventional Commits (see CONTRIBUTING.md).
- Keep changes small and focused. Do not refactor unrelated code in the same change.
- Update `CHANGELOG.md` under `## [Unreleased]` for user-visible changes.
- Do not copy features from teamtodo "in case they are needed". Port only what a task uses, adapted to this domain, with its tests.
