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
- The PDFs embed Inter as static TTF files (`@expo-google-fonts/inter`, full character set) and an sRGB ICC profile (`src/pdf/assets/`). `src/pdf/assets.ts` imports them with `?inline`, so they are part of the script as `data:` URLs and decoded when the first PDF is made; `*.icc` is listed in `assetsInclude` of `vite.config.ts` and `vitest.config.ts`. With pdf-lib and fontkit the script is about 2.3 MB.
- The same plugin adds a Content Security Policy (`CONTENT_SECURITY_POLICY`): no network access (`connect-src 'none'`), scripts only from the build, images from the build, `data:` and `blob:` (the logo). It is not added in `npm run dev`, because the dev server injects inline scripts. `npm run check:file` reports a refused inline script as a console error, which fails the check.

## Architecture

```text
src/
  main.tsx, App.tsx            Entry point; start screens, setup assistant or the app frame
  app/session.ts               Startup: check browser → known company folders → permission → load
                               Setup assistant actions (choose folder, finish), switching companies, logo
  app/crashReporting.ts        Global handlers for uncaught errors (emergency copy, then a toast)
  app/documentPdf.ts           PDF of a quote or an invoice: logo from the folder (SVG drawn into a PNG), download;
                               an issued invoice or a finalized quote is its stored file, checked against its SHA-256
  app/reports.ts, reportsExport.ts, search.ts  Reports (F11): the records mapped into rows and named; each report as a CSV table
                               (reusing the encoder of csvExport.ts); the records as entries for the search
  app/issue.ts                 Issuing and cancelling an invoice, finalizing a quote (ADR 0004): reserve the number,
                               write the PDF once, the record, audit
  app/ustva.ts                 Advance VAT return: the records of the company mapped into the domain, copy values, CSV
  app/sending.ts               E-mail to the customer (F04): the mail as .eml with the PDF attached, or a mailto: link;
                               the text from the templates, a changed PDF is not sent, the audit line `send`
  domain/                      Pure logic, no I/O:
    check.ts                   Checker for form drafts, shared field checks (address, email, phone, IBAN, price, payment term)
    money.ts                   Cents, basis points, quantities, rounding, tax totals, parsing and formatting
    vat.ts, units.ts           VAT rates (§ 12 UStG), EU member states; units as UN/ECE Rec. 20 codes (e-invoice BT-130)
    dates.ts                   Calendar days as ISO strings (YYYY-MM-DD), without time zones
    iban.ts, taxIds.ts         IBAN/BIC, Steuernummer, USt-IdNr. (check digit)
    links.ts                   Which URLs may become a link (http: and https: only; the mailto: link of the sending, F04)
    sending.ts                 E-mail (F04): placeholders, the .eml file with the PDF (base64, RFC 2047 subject), mail checks
    tax/params/<year>.ts       Values that depend on the tax year, each with its legal source; tax/params/index.ts
                               picks the year (an unknown later year gets the last known one)
    tax/tradeTax.ts            Trade tax: the minimum multiplier of a year
    ustva.ts                   Advance VAT return (R1): periods, due date, the fields of the form from invoices, payments and expenses
    numbering.ts               Number patterns of invoices and quotes ("RE-{YYYY}-{NNNN}", "AN-{YYYY}-{NNNN}")
    company.ts                 Company profile types, the form draft, checks per section, logo checks
    contact.ts                 Customers and suppliers: profile, form draft, checks, search
    bankAccount.ts             Bank and PayPal accounts: details, form draft, checks
    item.ts                    Catalogue of items and services: profile, form draft, checks, search
    document.ts                Lines of quotes and invoices: drafts, checks, totals per rate
    quote.ts                   Quotes: content, form draft, checks, what is missing before finalizing, search
    quoteVersions.ts           Quote versions: version numbers, what changed between two, the versions of a quote, how
                               often quotes were changed
    invoice.ts                 Invoices: content, tax treatment, form draft, checks, what is missing before issuing
    reports.ts                 Reports (F11): income per customer, expenses per category, open items, the year against the year
                               before; the same cash-basis rules as overview.ts, and sums that equal its totals
    search.ts                  Global search (F11): the words of a query against the fields of an entry, ordered by kind
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
  pdf/                         PDF of quotes and invoices (@cantoo/pdf-lib, @cantoo/fontkit):
    content.ts                 What the document says, formatted in its language (German for now, F05); the footer
                               columns (`footerColumns`) are also the preview in the invoice settings (F26)
    layout.ts                  Where it goes: DIN 5008 form B, the lines table over several pages, footer (pure)
    render.ts                  The file: subset fonts, logo, metadata, sRGB output intent, missing characters
    assets.ts, assets/         The embedded font and ICC profile (sources and licences in assets/README.md)
  store/appStore.ts            State (zustand) and all actions
  store/prefs.ts               Per-browser settings: language, last company
  i18n/                        Texts in de and en
  features/                    setup (assistant), company (shared form fields, summary), shell (frame, switcher),
                               quotes, invoices, documents (line editor, totals, customer choice), contacts (list and
                               form), items (catalogue), reports (the four reports and the search), settings (with the bank accounts card), sending (the e-mail
                               card and form of an issued document), home, start
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
6. Deleting a contact, an item, a quote draft or an invoice draft sets `deletedAt` (a mergeable field with its own timestamp): the file stays, the record is hidden, and an edit made elsewhere later does not bring it back.
7. Bank accounts are a list in `company.json` (`bank`), merged as one field: when two devices change accounts at the same time, the later change wins for the whole list. Removing an account sets its `deletedAt`; it stays in the list, because payments will refer to it by ID. The default account cannot be removed.

### Boundary rules

- Everything read from a company folder, a backup, IndexedDB or `localStorage` is checked (`validate.ts`, via `migrate`). Wrong types and unknown values are errors; unknown top-level fields are kept and written back. `fieldUpdatedAt` keeps only known keys.
- Checks are structural plus what other code relies on for safety: IDs (`isValidId`), the logo file name (must match its hash and type), the number patterns (they produce file names). A value that is wrong but safe (an IBAN with a wrong check digit) passes and is reported by the forms.
- `switch` over a union must be exhaustive (`@typescript-eslint/switch-exhaustiveness-check`).

## Data format (schema version 16)

The format is described for people who keep their data, in [docs/data-format.md](docs/data-format.md). What follows is the detail for the code.

kontor writes `company.json`, `contacts/`, `items/`, `documents/` (with `documents/issued/` and `documents/quotes/`), `payments/`, `expenses/`, `numbering/`, `audit/`, `assets/` and `backups/`. The rest of the layout is planned (see [roadmap](docs/roadmap.md)):

```text
<company folder>/
  company.json            { schemaVersion, id, name, owner, address, contact, logo, tax, invoiceDefaults, bank, createdAt, fieldUpdatedAt }
  assets/logo-<hash>.<ext> logo files, named after the start of their SHA-256, never overwritten
  backups/<YYYY-MM-DD>.json { schemaVersion, createdAt, company, contacts, items, documents, payments, dunnings, quoteStatuses, expenses }
  contacts/<id>.json      customers and suppliers, file name = contact ID; other names (conflict copies) are not read
  items/<id>.json         catalogue of items and services, named like contacts
  documents/<id>.json     quotes, invoices and cancellation invoices, named like contacts
  documents/issued/<nr>.pdf  the PDF of an issued invoice, named after its number, written once (XML planned)
  documents/quotes/<nr>.pdf  the PDF of a finalized quote, the same way
  numbering/<range>.json  range `invoice` or `quote`: { schemaVersion, range, counters: [{ key, last }], reservations: [...] }
  payments/<id>.json      money received for an issued invoice, named like contacts (see below)
  dunnings/<id>.json      dunnings (Mahnungen) of an issued invoice, named like contacts; never changed (see below)
  quoteStatus/<id>.json   the decision of the customer on a finalized quote (accepted or declined, with its date); never changed, only removed (soft delete), see below
  expenses/<id>.json      what the business paid for, edited like an item, removed by soft delete; `receipt` is the receipt (see below)
  belege/<year>/<id>-<name>  the receipt files of the expenses of that year, never overwritten (see below)
  eingang/                inbox: files waiting to be assigned (F06)                 (planned)
  audit/<YYYY-MM>.jsonl   one JSON line per action ({ at, action: 'issue' | 'cancel' | 'issueQuote' | 'recordPayment' | 'deletePayment' | 'dunning' | 'send' | 'quoteDecision' | 'deleteQuoteDecision', documentId, number, files, device, payment?, dunning?, send? }), only appended; `payment` is { id, date, amount } for the two payment actions, `dunning` is { id, level, date, amount } for a dunning, where amount is what it adds to the claim; `quoteDecision` and `deleteQuoteDecision` are { id, decision, date } for a decision on a quote recorded or removed (F21); `send` is { kind, channel, to, dunningId } for a mail that was prepared (`kind`: invoice, cancellation, quote or dunning; `channel`: eml or mailto), and `files` names the PDF it attached with its SHA-256 (a letter has none). The audit lines have no schema version and nothing reads them back in the app, so the new action needs no migration
  exports/                generated exports, such as the ZIP of the company folder (F12, planned). The CSV export of the lists (F35) is a download and writes nothing to the folder.
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
| `invoiceDefaults` | `numberPattern` (invoices), `quotePattern` (quotes; the form requires it to differ from `numberPattern`), `contactPattern` and `itemPattern` (the numbers a new contact or item starts with; counters only, no date, F28), `paymentTermDays`, `footer` (free text below the columns), `footerParts` (`{ address, phone, email }`, booleans: which of these the footer columns show, F26; the tax numbers and the account always stand) |
| `fieldUpdatedAt` | timestamp per top-level field, for the merge |

A contact file (`contacts/<id>.json`, types in `src/domain/contact.ts`) has `kind` (`company` or `person`), `roles` (`customer`, `supplier`), `name`, `nameLine2`, `contactPerson`, `customerNumber` (unique among active contacts), `address` (`null` or complete), `contact` (`email`, `phone`), `vatId` (EU), `leitwegId`, `orderReference` (default PO number), `language` (`de` or `en`, the language of its documents; `de` by default, F05), `paymentTermDays` (`null` = company default), `notes`, `createdAt`, `deletedAt` and `fieldUpdatedAt`. Contacts were added in schema version 1 as a new kind of file; no existing file changed, so the version stayed.

An item file (`items/<id>.json`, types in `src/domain/item.ts`) has `number` (unique among active items, may be empty), `name`, `description`, `unit` (a code of UN/ECE Recommendation 20 from `src/domain/units.ts`, for example `HUR` for hour), `netPrice` (integer cents, not negative), `vatRate` (basis points: `1900`, `700` or `0`), `createdAt`, `deletedAt` and `fieldUpdatedAt`. Items were added in schema version 2 as a new kind of file; an app that does not know them leaves the folder alone. A new unit code or rate is a format change: older apps would refuse the file.

A contact or an item that an import made carries `importBatchId` (schema version 14): the ID of the import, `null` for a record typed in. An import is taken back by removing every record with its ID (`undoContactImport`, `undoItemImport`: a soft delete each). The importer (`src/data/import/`) reads CSV and Excel with the limits of the roadmap's importer rules; the rules that map columns to fields and check each row are in `src/domain/import.ts` and use the checks of the forms.

An expense file (`expenses/<id>.json`, type `ExpenseFile` in `src/data/types.ts`, the rules in `src/domain/expense.ts`) is what the business paid for. It has `date` (`YYYY-MM-DD`, the day it was paid: the EÜR counts expenses when they are paid), `supplier` (free text), `reference` (the receipt number of the supplier, may be empty), `gross` (integer cents, more than 0, VAT included), `taxTreatment` (`domestic`, `euReverseCharge`, `thirdCountry` or `noVat`), `vatRate` (`1900`, `700` or `0`; always `0` unless the treatment is `domestic`), `category` (free text, may be empty), `accountId` (an account of `company.json`, which may have been removed since, or `null` for cash or another payment), `note`, `createdAt`, `deletedAt` and `fieldUpdatedAt`. It is edited like an item: every field is merged one by one, and a deletion wins. The VAT inside the gross amount is the difference to the net amount, rounded once (`splitGross`), and only for `domestic`. Expenses were added in schema version 13 as a new kind of file. `receipt` (schema version 15) is `null`, or `{ kind: 'file', year, name, type, size, sha256 }` for a file of `belege/<year>/<name>` (`type` is `application/pdf`, `image/png` or `image/jpeg`; `name` is the expense ID, a dash, and the original name without its extension, cleaned of the characters a file name cannot hold, plus the extension of the type), or `{ kind: 'link', url }` for an http or https link. A file is copied when the receipt is attached and never overwritten: the same bytes under that name are kept, other bytes are a conflict, and a second receipt of the expense gets the start of its SHA-256 in its name. Opening a receipt checks its size and SHA-256 first. Removing a receipt keeps its file. Each attach and detach appends a line to the audit log: `{ at, action: 'attachReceipt' | 'detachReceipt', expenseId, receipt, device }`, with `receipt` as the file (`year`, `name`, `sha256`) or the link (`url`); such a line has no `documentId`, `number` or `files`.

A document file (`documents/<id>.json`, types in `src/data/types.ts`, `src/domain/quote.ts`, `src/domain/invoice.ts` and `src/domain/document.ts`) is a quote or an invoice, told apart by `kind`. Both have `customerId` (a contact), `date` (`YYYY-MM-DD`), `subject`, `introText`, `closingText`, `lines`, `createdAt`, `deletedAt` and `fieldUpdatedAt`. A line has `name`, `description`, `quantity` (thousandths, not 0, negative for a deduction), `unit`, `unitPrice` (cents, not negative) and `vatRate`; its amount stays within 999,999,999.99 €, so every total is an exact integer. The lines are one mergeable field.

- `kind: 'quote'` adds `validUntil`.
- `kind: 'invoice'` adds `service` (`{ kind: 'date', date }` or `{ kind: 'period', start, end }`), `paymentTermDays` (0 to 365; the due date is the date plus the term), `accountId` (an account of `company.json`, possibly removed since), `taxTreatment` (`standard`, `reverseCharge`, `intraCommunitySupply` or `notTaxable`; always `standard` for a small business), `orderReference` (BT-13), `leitwegId` (BT-10) and `quoteId` (the quote it was made from, or `null`; not mergeable, it never changes).

An invoice also has `issued`: `null` for a draft, or `{ number, counter, counterKey, issuedAt, snapshot, pdf: { file, sha256 } }` once issued (ADR 0004). `snapshot` holds the company profile, the customer profile and the account details at that time; `pdf.file` must be `<number>.pdf`. `issued` is not a mergeable field: an issued invoice wins over a draft as a whole, the repository never writes a draft over it, and two different numbers for one invoice stop the save (`conflict`). The store neither changes nor deletes an issued invoice. A quote has `issued` as well: `null` for a draft, or the same object once it is finalized, with its PDF in `documents/quotes/`; it follows the same rules. A quote also has `revises`: `null` for a first version, or for a new version `{ id, number, date, firstNumber, version }` of the finalized quote it replaces (`version` from 2); once finalized, its number must be `<firstNumber>-<version>`. `revises` is not mergeable: it never changes. The repository never merges a quote with an invoice of the same ID; such a save stops. Documents were added in schema version 2 as a new kind of file, invoices in version 3, issuing in version 4, cancelling in version 5, finalizing quotes in version 6.

An invoice also has `cancels`: `null`, or for a cancellation invoice `{ id, number, date }` of the issued invoice it cancels. A cancellation is issued as soon as it is made, so a file with `cancels` and without `issued` is refused. Its ID is a UUID derived from the invoice's ID (`cancellationId`, SHA-256, version 8 of RFC 9562), so an invoice has at most one cancellation, also when two attempts or two devices make it. The cancelled invoice itself does not change: it counts as cancelled because a document cancels it (`cancellationOf`).

Issuing (`src/app/issue.ts`) reads `numbering/invoice.json` and the files in `documents/issued/`, takes the next counter of the key (the year of the invoice date when the pattern contains `{YYYY}` or `{YY}`, otherwise `all`) as one more than the highest counter known from the range file, its reservations and the issued invoices, and stops when the formatted number is taken already. It writes the reservation (number, document ID, device, time), reads the file back and checks that the reservation holds, then writes the PDF (never replacing a file), saves the invoice and appends the audit line. A second attempt for the same invoice finds its reservation and its file and goes on with them. The device is a random ID of the browser (`localStorage` `kontor.device.v1`).

Finalizing a quote (`issueQuote` in the same file) needs a customer, at least one line and a validity that has not run out (`quoteProblems`). It goes the same way in the quote range: `numbering/quote.json`, the pattern `quotePattern`, the PDF in `documents/quotes/`, the snapshot with the company's default account (the one the quote's footer shows), and an audit line with `action: 'issueQuote'`. The two ranges have their own counters and folders, so they never block each other. A new version is numbered `<firstNumber>-<version>` with the counter of its first number (the highest counter of the range file never goes back), and it cannot be finalized once the quote it replaces has another finalized version (`replacedAlready`).

Cancelling (`cancel` in the same file) makes the cancellation of an issued invoice (`cancellationContent`): the lines with the opposite quantity, the service, tax treatment and references of the invoice, no texts, dated today but never before the invoice. It is issued like an invoice, with the next number of the invoice range and the snapshot of the cancelled invoice, so it reverses exactly what the invoice said; the audit line has `action: 'cancel'` and `cancels: { documentId, number }`. Calling it again returns the cancellation issued before.

A payment (`payments/<id>.json`, type `PaymentFile` in `src/data/types.ts`, the rules in `src/domain/payment.ts`) is money that arrived for an issued invoice. It has `invoiceId` (the invoice), `date` (`YYYY-MM-DD`, the day the money arrived, which does not have to match the invoice date: the EÜR is cash-based), `amount` (integer cents, from 1 to 99,999,999,999), `accountId` (an account of `company.json`; it stays when the account is removed later), `note` (up to 200 characters), `createdAt`, `deletedAt` and `fieldUpdatedAt`. A payment never changes. Only its deletion is a change (a soft delete), and the merge keeps a deletion made on another device. Every payment is a file of its own, so two devices that record payments for the same invoice never overwrite each other. Only an issued invoice takes a payment, and not a cancellation or a cancelled invoice; the payments made before a cancellation stay visible and are not refunded by the app. The open amount of an invoice is its gross amount less the active payments and is never below 0 (`openAmount`); its state is open, partly paid, paid or cancelled (`paymentStateOf`), and it is overdue when something is open after the due date (`isOverdue`). `recordPayment` and `removePayment` (`src/app/payments.ts`) check the invoice and the amount again against the state of the folder, because another device may have recorded a payment in the meantime, then write the payment file and append the audit line.

A dunning (`dunnings/<id>.json`, type `DunningFile` in `src/data/types.ts`, the rules in `src/domain/dunning.ts`) is a letter of an issued invoice that went out: its `level` (`reminder`, `level1`, `level2` or `level3`), `date`, `debtor` (`business` or `consumer`, from the customer's kind at issue), the `open` amount it was made on, `interestFrom`, `interest`, `flatFee` (40 € once for a business customer), `fee` (typed in, 0 for none), `payBy` (the date plus 14 days) and `createdAt`. A dunning is never changed and never deleted. Its interest is counted for the days from `interestFrom` to its date at the base rate of each day (`BASE_RATES` in `src/domain/tax/params/baseRate.ts`, § 247 BGB, valid from each announcement) plus 9 points for a business customer or 5 points for a consumer (§ 288 BGB), rounded per period. The claim of an invoice is its open amount plus the interest, fees and flat fees of all its dunnings (`claimTotal`). A dunning needs an overdue invoice that is not cancelled, a date not before the last dunning and not in the future, and a base rate for every day it counts; `planDunning` reports every reason it is refused. `issueDunning` (`src/app/dunning.ts`) writes the file and appends the audit line `dunning`.

A decision of the customer on a finalized quote (`quoteStatus/<id>.json`, type `QuoteStatusFile` in `src/data/types.ts`, the rules in `src/domain/quoteStatus.ts`, F21) has `quoteId`, `decision` (`accepted` or `declined`), `date` (the day the customer decided, not after today and not before the quote), `createdAt`, `deletedAt` and `fieldUpdatedAt`. It never changes; removing it is a soft delete, and only the deletion is merged. A quote takes one decision at a time: a second one is refused until the first is removed (`alreadyDecided`), and a quote that a later version replaced, or a draft, takes none. Two devices can record different decisions; the one created later counts (`activeDecision`). The state of a quote is `draft`, `open` (finalized, no decision), `accepted` or `declined`. The quote itself does not change (ADR 0004). `decideQuote` and `removeQuoteDecision` (`src/app/quoteStatus.ts`) write the file and then the audit line `quoteDecision` or `deleteQuoteDecision`.

Sending (F04, `src/app/sending.ts`, `src/domain/sending.ts`): kontor prepares an e-mail to the customer for an issued invoice, its cancellation, a finalized quote or a dunning, and never sends one. The text comes from the templates `send.tpl.*` in `src/i18n` (German, like the documents), with the document's values in braces (`{Rechnungsnummer}`, `{Fälligkeit}`, …), filled in once by `fillTemplate`, which does not fill a value again. The form changes the text per mail, and the change is not saved. There are two ways out: an `.eml` file (`buildEml`: a multipart message with the text and the PDF in base64, `X-Unsent: 1` so that Outlook and Thunderbird open it as a draft, the subject as RFC 2047 words, CRLF lines) or a `mailto:` link (`mailtoHref` in `src/domain/links.ts`, the one exception to the href rule; the text is left out above 2,000 characters, the subject stays), for which the PDF is downloaded beside it. The PDF of an invoice, a cancellation or a quote is its stored file, checked against its SHA-256; a file that changed since it was issued is not sent. A dunning letter is not a stored file: `dunningContent` and `makeDunningPdf` make it from the dunning record and the snapshot of its invoice, so a letter made again says the same, though its bytes can differ (the creation date). A letter about a cancelled invoice and a draft are refused. Each prepared mail appends the audit line `send`.

App-wide data is not in a company folder: the list of folder handles (IndexedDB `kontor`, store `companies`), the last company and the language (`localStorage` `kontor.prefs.v1`).

### Migrations

To change a file format, increase `SCHEMA_VERSION` in `data/schema.ts` and add `{ from: n, up(raw) }` for every file kind in `data/migrations.ts`. Files are upgraded when read and saved in the new version on the next write. A file from a newer version stops loading with a message, so an older app never overwrites it. `tests/unit/migrations.test.ts` contains a template for testing a step before it is added.

| Version | Change |
| --- | --- |
| 1 | First format; contacts were added in it as a new kind of file |
| 2 | `company.json`: the one bank account `{ holder, iban, bic }` becomes `bank.accounts[0]` with the fixed ID `account-1` and is the default (two devices that upgrade the same file get the same ID). Contact files are unchanged. Item and document files are new. |
| 3 | Document files can be invoices (`kind: 'invoice'`). No existing file changes; every kind gets `unchanged(2)`. An app of version 2 refuses the files of version 3 instead of overwriting them. `notTaxable` joined the tax treatments before version 3 was released, so it did not get a version of its own. |
| 4 | Invoices can be issued: a draft of version 3 gets `issued: null`; the other kinds get `unchanged(3)`. Range files (`numbering/`) are a new kind of file. An app of version 3 refuses the files of version 4, so it can never edit an issued invoice as a draft. |
| 5 | Invoices can be cancelled: every invoice of version 4 gets `cancels: null`; the other kinds get `unchanged(4)`. An app of version 4 refuses the files of version 5, so it never shows a cancelled invoice as open. |
| 6 | Quotes get numbers and versions: `company.json` gets `invoiceDefaults.quotePattern` (`AN-{YYYY}-{NNNN}`), and a quote of version 5 gets `issued: null` and `revises: null`. The company in the snapshot of an issued invoice is a company profile and gets the quote pattern as well, so that it passes the same checks; nothing else of the invoice changes, and its PDF is not touched. Range files may be of the range `quote`; contacts, items and range files get `unchanged(5)`. An app of version 5 refuses the files of version 6, so it never edits a finalized quote as a draft. |
| 7 | Payments: a new kind of file (`payments/`). No existing file changes; every kind gets `unchanged(6)`. An app of version 6 refuses a payment file instead of dropping it. The daily backup holds the payments as well. |
| 11 | Decisions of the customer on a finalized quote (`quoteStatus/`, F21): a new kind of file. No existing file changes; every other kind gets `unchanged(10)`. An app of version 10 refuses a decision instead of dropping it. |
| 10 | Contacts and items get their numbers from a pattern (F28): `company.json` gets `invoiceDefaults.contactPattern` (`K-{NNNN}`) and `itemPattern` (`A-{NNNN}`), and the company in the snapshot of an issued document gets them as well. No other file changes; every other kind gets `unchanged(9)`. An app of version 9 refuses a company with these patterns instead of dropping them. |
| 9 | Contacts get the language of their documents (`language`, `de` for existing contacts). The customer in the snapshot of an issued document gets it too (`de` for existing documents). No other file changes; every other kind gets `unchanged(8)`. An app of version 8 refuses a contact or a document with a language instead of dropping it. |
| 8 | Dunnings: a new kind of file (`dunnings/`). No existing file changes; every kind gets `unchanged(7)`. An app of version 7 refuses a dunning file instead of dropping it. The daily backup holds the dunnings as well. |
| 13 | Expenses: a new kind of file (`expenses/`). No existing file changes; every other kind gets `unchanged(12)`. An app of version 12 refuses an expense instead of dropping it. The daily backup holds the expenses as well. |
| 14 | Contacts and items get `importBatchId`, the import they came from (`null` for records typed in). Every other kind gets `unchanged(13)`. An app of version 13 refuses a contact or an item of version 14, so it never drops a batch. |
| 15 | Expenses get `receipt` (`null` when there is none). Every other kind gets `unchanged(14)`. An app of version 14 refuses an expense with a receipt, so it never drops one. |
| 16 | The footer shows the parts of the master data the company chooses (F26): `company.json` gets `invoiceDefaults.footerParts` (all three `true` for existing companies, as their documents showed everything), and the company in the snapshot of an issued document gets it too, so that a dunning letter made later from the snapshot still prints the footer as before. Every other kind gets `unchanged(15)`. An app of version 15 refuses a company with the choice, so it never drops it. |

## Tests

- **Unit** (`tests/unit`): domain checks (company, contacts, accounts, items, quotes, invoices and what they need before issuing, payments: paid and open amounts that add up to the gross amount (property), states, overdue, the checks of a payment in the language of the form), totals per rate and tax treatment, quantities and dates, validation, migrations (including a file of version 1), repository (merge, assets, backups) on an in-memory folder, persister including the error path, handle store on `fake-indexeddb`, i18n completeness, the PDF (its content per document and tax treatment, wrapping and page layout with a property test that no text runs into the footer, and a rendered file with real fonts: metadata, output intent, embedded subsets, missing characters), issuing on an in-memory folder (numbers per year, a range file that fell behind, a taken number, a second attempt after an interruption, a reservation that does not hold), cancelling (the next number, the master data of the invoice, once per invoice, a second attempt; a property test that the totals are reversed exactly), finalizing quotes (a range and a folder of their own, numbers per year, what a quote needs, a second attempt), quote versions (numbers with a suffix and the counter of the first, one version at a time, what changed between two, chains with loops from other devices, how often quotes were changed), and that an issued invoice or a finalized quote is never overwritten; recording and removing payments on an in-memory folder (the file, the audit line, partial payments, a payment above the open amount refused, no payment on a draft, a cancelled invoice or a cancellation, a removed payment counting as no payment), payment files on the folder (saved and read, a broken file reported, a deletion from another device kept), and the payments the persister writes or keeps in the emergency copy. The VAT reference scenarios (`tests/fixtures/vat`, run by `tests/unit/vatScenarios.test.ts`): worked examples with exact cents for the advance return (19 % and 7 % with half cents, supplies into Kz 41, 21, 45 and 60, quarter and month boundaries, cash against accrual, a small business, expenses without German input tax) and the small business limits, each with its paragraph and URL in a comment and what could not be verified marked as such, a property test that net plus tax is the gross amount for any rate and amount, and the scenarios that wait for payouts or § 13b expenses as `it.todo`.
- **Property-based** (fast-check): money sums and rounding, gross/net splits, parsing and formatting, IBAN check digits, profile normalization. CI uses a fixed seed (`CI` is set); locally the seed is random. `FC_SEED=<seed>` repeats a failing run, `FC_RUNS=<n>` runs more cases.
- **E2E** (`tests/e2e`): the real build under `file://`. The assistant with all checks, the written folder, a folder that is not empty, an existing company folder, two companies with switching and reload, settings, English, contacts (checks, search, filter, edit, soft delete, reload, separate per company), bank accounts (checks, default, removal, reload), a company folder of version 1 that is upgraded, the catalogue (checks, search, edit, delete, reload, English prices, small business) unsaved items restored from the emergency copy, quotes (lines from the catalogue and free lines, totals per rate, checks per line, order, edit, delete, reload, small business, expired, the PDF with an SVG logo), and invoices (defaults from the customer, period of service, tax treatment, due date, what is missing before issuing, edit, delete, reload, the PDF download, an invoice made from a quote, small business, issuing with the files in the folder and the read-only view), finalizing a quote (what is missing, the number, the final PDF and the files in the folder, the read-only view, an invoice and a copy made from it), and quote versions (a new version with a suffix, the links between the versions, what changed, how often quotes were changed), and dunnings (the base rate of each half year and the interest across a change of it, the flat fee once, the levels and the reasons a dunning is refused, the claim, the property that the interest does not depend on splitting a period), and customer accounts (the entries in date order with the balance after each, a credit after a cancellation, overdue, the balance equal to the open amounts of the invoices as a property test), and payments (a part payment leaves the rest open, the list shows the state and counts the open invoices, a payment above the open amount is refused, a removal asks first and reopens the amount, the audit log). Dunnings (an overdue invoice: the preview of the reminder with its interest and the flat fee, the reminder recorded with its interest and the log). Sending (an issued invoice and a dunning: the form filled in from the document, the .eml file with the PDF attached and its audit line, the mailto: link with the PDF downloaded beside it, the audit log of both).

Test mode `?e2e`: the native folder picker is replaced by folders in `localStorage` (`data/fs/storageFs.ts`), and the list of companies is kept in `localStorage` too. `window.__e2e` provides `flush()` (wait for pending writes) and `nextFolder(name)` (the next folder picker returns this folder). Only active with this URL parameter.
