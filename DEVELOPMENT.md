# Development guide

kontor is a local web app (React 18, TypeScript, Vite, zustand) for invoicing and cash-basis accounting (EÜR) in Germany. It runs without a server: open `dist/index.html` directly via `file://` in Chrome or Edge. Every company is a folder of JSON files, chosen by the user through the File System Access API. The architecture follows [teamtodo](https://github.com/miralem-cebic/teamtodo); the decisions are recorded in [docs/adr/](docs/adr/).

## Setup

Requirements: Node.js 20 or newer (CI uses Node 22) and an installed Google Chrome for the browser tests.

```bash
npm ci             # install exact dependencies from package-lock.json
npm run dev        # development server at http://localhost:5173
```

The project should not live inside a synced folder such as OneDrive, because `node_modules` contains tens of thousands of files.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run build` | Type check and production build into `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm run lint` | ESLint (type-aware for `src/`) |
| `npm test` | Unit and property tests (Vitest, `tests/unit`) |
| `npm run test:e2e` | Build, then Playwright tests against `dist/index.html` via `file://` in the installed Chrome |
| `npm run check:file` | Build acceptance test: opens `dist/index.html` via `file://` and checks console, secure context, API, font |

Playwright uses the installed Chrome (`channel: 'chrome'`), so no browsers are downloaded. `HEADED=1` shows the window.

## Building for `file://`

Chrome blocks module scripts and CORS requests under `file://`. Therefore:

- `vite.config.ts`: `format: 'iife'`, no code splitting, `base: './'`, `modulePreload: false`.
- `build/fileProtocol.ts`: a Vite plugin that removes `type="module"` and `crossorigin` from the built `index.html` and loads the script with `defer`. It fails the build if `type="module"` remains.
- The Inter font (`@fontsource/inter`, Latin subset: umlauts, ß and € included) is embedded as a `data:` URL in the CSS.
- The same plugin adds a Content Security Policy (`CONTENT_SECURITY_POLICY`): no network access (`connect-src 'none'`), scripts only from the build, images from the build, `data:` and `blob:` (the logo). It is not added in `npm run dev`, because the dev server injects inline scripts. `npm run check:file` reports a refused inline script as a console error, which fails the check.

## Architecture

```text
src/
  main.tsx, App.tsx            Entry point; start screens, setup assistant or the app frame
  app/session.ts               Startup: check browser → known company folders → permission → load
                               Setup assistant actions (choose folder, finish), switching companies, logo
  app/crashReporting.ts        Global handlers for uncaught errors (emergency copy, then a toast)
  domain/                      Pure logic, no I/O:
    check.ts                   Checker for form drafts, shared field checks (address, email, phone, IBAN, price, payment term)
    money.ts                   Cents, basis points, quantities, rounding, tax totals, parsing and formatting
    vat.ts, units.ts           VAT rates (§ 12 UStG), EU member states; units as UN/ECE Rec. 20 codes (e-invoice BT-130)
    dates.ts                   Calendar days as ISO strings (YYYY-MM-DD), without time zones
    iban.ts, taxIds.ts         IBAN/BIC, Steuernummer, USt-IdNr. (check digit)
    links.ts                   Which URLs may become a link (http: and https: only)
    numbering.ts               Invoice number patterns ("RE-{YYYY}-{NNNN}")
    company.ts                 Company profile types, the form draft, checks per section, logo checks
    contact.ts                 Customers and suppliers: profile, form draft, checks, search
    bankAccount.ts             Bank and PayPal accounts: details, form draft, checks
    item.ts                    Catalogue of items and services: profile, form draft, checks, search
    document.ts                Lines of quotes and invoices: drafts, checks, totals per rate
    quote.ts                   Quotes: content, form draft, checks, search
    invoice.ts                 Invoices: content, tax treatment, form draft, checks, what is missing before issuing
  data/
    types.ts                   File formats (company.json, backups)
    schema.ts                  SCHEMA_VERSION, factories
    ids.ts                     Branded IDs (CompanyId, ContactId, AccountId, ItemId, DocumentId)
    clock.ts                   Hybrid clock for change timestamps
    validate.ts                Hand-written checks for everything read from the folder or browser storage
    migrations.ts              Upgrade per file kind, then validate
    merge.ts                   Field-level merge of company.json and the record files (a quote never merges with an invoice)
    repository.ts              Repository interface, StorageError
    result.ts                  Result instead of exceptions
    persister.ts               Watches the store, writes changes (400 ms debounce), emergency copy in localStorage
    maintenance.ts             Daily backup (14 kept); the only place that removes files
    fs/FsRepository.ts         Repository on a FileSystemDirectoryHandle
    fs/handleStore.ts          The company folders of this browser (several handles, IndexedDB)
    fs/memoryFs.ts             In-memory folder (unit tests)
    fs/storageFs.ts            Folders in localStorage and their list (?e2e)
    fs/jsonFile.ts, fileNames.ts, permission.ts, support.ts
  store/appStore.ts            State (zustand) and all actions
  store/prefs.ts               Per-browser settings: language, last company
  i18n/                        Texts in de and en
  features/                    setup (assistant), company (shared form fields, summary), shell (frame, switcher),
                               quotes, invoices, documents (line editor, totals, customer choice), contacts (list and
                               form), items (catalogue), settings (with the bank accounts card), home, start
  components/                  Form fields, icon, toast, error boundary, language select, side panel with jump marks,
                               links to pages outside kontor
  lib/                         labels.ts (texts for error codes), sha256.ts
  styles/                      tokens.css, base.css, fonts.css, app.css
```

### Startup and companies

1. `boot()` checks the browser (`checkSupport`), then reads the list of known company folders (`handleStore`).
2. No entry: the setup assistant. Otherwise the last opened company (`prefs.lastCompany`) or the first one.
3. If the browser still has write permission, the company is loaded; otherwise "Continue with …" asks for permission (needs a click).
4. Loading: `readCompany` (validated), the contacts, items and documents (`loadContacts`, `loadItems`, `loadDocuments`; a broken file is left out and reported in a toast), then the store, the persister, an emergency copy from an earlier session if it is newer, the logo and the daily backup.
5. The switcher opens another company: it asks for permission first (while the click counts as a user gesture), then writes what is pending and closes the current company.

"Add company" runs the assistant while the current company stays open. A folder that already holds a company is opened directly. A folder that is empty becomes the company folder; in a folder that is not empty, a subfolder named after the company is created on "Finish". Nothing is written before "Finish": the logo first, `company.json` last, so a folder counts as set up only when it is complete.

### Data flow

1. The UI calls actions in `store/appStore.ts`. They change the state immediately and immutably.
2. `Persister` compares object references and queues what changed; objects that are saved are kept in a `WeakSet`.
3. After 400 ms it writes through the `Repository`. Repository operations return a `Result`; exceptions from the browser API are turned into results once, in `FsRepository`.
4. A failed write stays in the queue; the status in the sidebar offers "Try again", and an emergency copy of the unsaved company, contacts, items and documents is kept in `localStorage` (`kontor.unsaved.v1.<companyId>`) until the write succeeds.
5. `saveCompany`, `saveContact`, `saveItem` and `saveDocument` check the file's `lastModified`. If someone else changed it since the last read, they read the file again and merge field by field (`merge.ts`, newer `fieldUpdatedAt` wins). A file of another record or a newer format version is never overwritten.
6. Deleting a contact, an item, a quote or an invoice draft sets `deletedAt` (a mergeable field with its own timestamp): the file stays, the record is hidden, and an edit made elsewhere later does not bring it back.
7. Bank accounts are a list in `company.json` (`bank`), merged as one field: when two devices change accounts at the same time, the later change wins for the whole list. Removing an account sets its `deletedAt`; it stays in the list, because payments will refer to it by ID. The default account cannot be removed.

### Boundary rules

- Everything read from a company folder, a backup, IndexedDB or `localStorage` is checked (`validate.ts`, via `migrate`). Wrong types and unknown values are errors; unknown top-level fields are kept and written back. `fieldUpdatedAt` keeps only known keys.
- Checks are structural plus what other code relies on for safety: IDs (`isValidId`), the logo file name (must match its hash and type), the invoice number pattern (it produces file names). A value that is wrong but safe (an IBAN with a wrong check digit) passes and is reported by the forms.
- `switch` over a union must be exhaustive (`@typescript-eslint/switch-exhaustiveness-check`).

## Data format (schema version 3)

kontor writes `company.json`, `contacts/`, `items/`, `documents/`, `assets/` and `backups/`. The rest of the layout is planned (see [roadmap](docs/roadmap.md)):

```text
<company folder>/
  company.json            { schemaVersion, id, name, owner, address, contact, logo, tax, invoiceDefaults, bank, createdAt, fieldUpdatedAt }
  assets/logo-<hash>.<ext> logo files, named after the start of their SHA-256, never overwritten
  backups/<YYYY-MM-DD>.json { schemaVersion, createdAt, company, contacts, items, documents }
  contacts/<id>.json      customers and suppliers, file name = contact ID; other names (conflict copies) are not read
  items/<id>.json         catalogue of items and services, named like contacts
  documents/<id>.json     quotes and invoices (drafts), named like contacts; cancellations and snapshots of the
                          master data are planned
  documents/issued/<nr>.pdf|.xml  finalized output, never overwritten              (planned)
  numbering/<range>.json  assigned numbers and reservations                        (planned)
  payments/<id>.json                                                               (planned)
  expenses/<id>.json      with receipt: { kind: 'file', path, sha256 } | { kind: 'link', url } (planned)
  belege/<year>/…         receipt files                                            (planned)
  eingang/                inbox: files waiting to be assigned (F06)                 (planned)
  audit/<YYYY-MM>.jsonl   append-only                                              (planned)
  exports/                generated exports                                        (planned)
```

`company.json` in detail (types in `src/domain/company.ts`, `src/domain/bankAccount.ts` and `src/data/types.ts`):

| Field | Content |
| --- | --- |
| `address` | `street`, `postalCode`, `city`, `country` (ISO code) |
| `contact` | `email`, `phone` (may be empty) |
| `logo` | `null` or `{ file, type, sha256 }` |
| `tax.vat` | `{ kind: 'smallBusiness' }` or `{ kind: 'regular', method: 'cash' \| 'accrual', period: 'monthly' \| 'quarterly' \| 'yearly', permanentExtension }` |
| `tax.business` | `{ kind: 'freelance' }` or `{ kind: 'trade', municipality, multiplierPercent }` |
| `tax.taxNumber`, `tax.vatId` | at least one is set |
| `bank` | `{ defaultAccountId, accounts }`; `defaultAccountId` is an active account of the list |
| `bank.accounts[]` | `{ id, kind: 'bank', name, holder, iban (normalized), bic (may be empty), deletedAt }` or `{ id, kind: 'paypal', name, email, deletedAt }`; `name` may be empty; at most 50, removed ones included |
| `invoiceDefaults` | `numberPattern`, `paymentTermDays`, `footer` |
| `fieldUpdatedAt` | timestamp per top-level field, for the merge |

A contact file (`contacts/<id>.json`, types in `src/domain/contact.ts`) has `kind` (`company` or `person`), `roles` (`customer`, `supplier`), `name`, `nameLine2`, `contactPerson`, `customerNumber` (unique among active contacts), `address` (`null` or complete), `contact` (`email`, `phone`), `vatId` (EU), `leitwegId`, `orderReference` (default PO number), `paymentTermDays` (`null` = company default), `notes`, `createdAt`, `deletedAt` and `fieldUpdatedAt`. Contacts were added in schema version 1 as a new kind of file; no existing file changed, so the version stayed.

An item file (`items/<id>.json`, types in `src/domain/item.ts`) has `number` (unique among active items, may be empty), `name`, `description`, `unit` (a code of UN/ECE Recommendation 20 from `src/domain/units.ts`, for example `HUR` for hour), `netPrice` (integer cents, not negative), `vatRate` (basis points: `1900`, `700` or `0`), `createdAt`, `deletedAt` and `fieldUpdatedAt`. Items were added in schema version 2 as a new kind of file; an app that does not know them leaves the folder alone. A new unit code or rate is a format change: older apps would refuse the file.

A document file (`documents/<id>.json`, types in `src/data/types.ts`, `src/domain/quote.ts`, `src/domain/invoice.ts` and `src/domain/document.ts`) is a quote or an invoice, told apart by `kind`. Both have `customerId` (a contact), `date` (`YYYY-MM-DD`), `subject`, `introText`, `closingText`, `lines`, `createdAt`, `deletedAt` and `fieldUpdatedAt`. A line has `name`, `description`, `quantity` (thousandths, not 0, negative for a deduction), `unit`, `unitPrice` (cents, not negative) and `vatRate`; its amount stays within 999,999,999.99 €, so every total is an exact integer. The lines are one mergeable field.

- `kind: 'quote'` adds `validUntil`.
- `kind: 'invoice'` adds `service` (`{ kind: 'date', date }` or `{ kind: 'period', start, end }`), `paymentTermDays` (0 to 365; the due date is the date plus the term), `accountId` (an account of `company.json`, possibly removed since), `taxTreatment` (`standard`, `reverseCharge` or `intraCommunitySupply`; always `standard` for a small business), `orderReference` (BT-13), `leitwegId` (BT-10) and `quoteId` (the quote it was made from, or `null`; not mergeable, it never changes).

Quotes and invoices are drafts for now: they have no number and no snapshot of the customer yet (ADR 0004). The repository never merges a quote with an invoice of the same ID; such a save stops. Documents were added in schema version 2 as a new kind of file, invoices in version 3.

App-wide data is not in a company folder: the list of folder handles (IndexedDB `kontor`, store `companies`), the last company and the language (`localStorage` `kontor.prefs.v1`).

### Migrations

To change a file format, increase `SCHEMA_VERSION` in `data/schema.ts` and add `{ from: n, up(raw) }` for every file kind in `data/migrations.ts`. Files are upgraded when read and saved in the new version on the next write. A file from a newer version stops loading with a message, so an older app never overwrites it. `tests/unit/migrations.test.ts` contains a template for testing a step before it is added.

| Version | Change |
| --- | --- |
| 1 | First format; contacts were added in it as a new kind of file |
| 2 | `company.json`: the one bank account `{ holder, iban, bic }` becomes `bank.accounts[0]` with the fixed ID `account-1` and is the default (two devices that upgrade the same file get the same ID). Contact files are unchanged. Item and document files are new. |
| 3 | Document files can be invoices (`kind: 'invoice'`). No existing file changes; every kind gets `unchanged(2)`. An app of version 2 refuses the files of version 3 instead of overwriting them. |

## Tests

- **Unit** (`tests/unit`): domain checks (company, contacts, accounts, items, quotes, invoices and what they need before issuing), totals per rate and tax treatment, quantities and dates, validation, migrations (including a file of version 1), repository (merge, assets, backups) on an in-memory folder, persister including the error path, handle store on `fake-indexeddb`, i18n completeness.
- **Property-based** (fast-check): money sums and rounding, gross/net splits, parsing and formatting, IBAN check digits, profile normalization. CI uses a fixed seed (`CI` is set); locally the seed is random. `FC_SEED=<seed>` repeats a failing run, `FC_RUNS=<n>` runs more cases.
- **E2E** (`tests/e2e`): the real build under `file://`. The assistant with all checks, the written folder, a folder that is not empty, an existing company folder, two companies with switching and reload, settings, English, contacts (checks, search, filter, edit, soft delete, reload, separate per company), bank accounts (checks, default, removal, reload), a company folder of version 1 that is upgraded, the catalogue (checks, search, edit, delete, reload, English prices, small business) unsaved items restored from the emergency copy, quotes (lines from the catalogue and free lines, totals per rate, checks per line, order, edit, delete, reload, small business, expired), and invoices (defaults from the customer, period of service, tax treatment, due date, what is missing before issuing, edit, delete, reload, an invoice made from a quote, small business).

Test mode `?e2e`: the native folder picker is replaced by folders in `localStorage` (`data/fs/storageFs.ts`), and the list of companies is kept in `localStorage` too. `window.__e2e` provides `flush()` (wait for pending writes) and `nextFolder(name)` (the next folder picker returns this folder). Only active with this URL parameter.
