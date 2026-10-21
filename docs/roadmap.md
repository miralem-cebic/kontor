# Roadmap

kontor follows the feature set of epufix (Austria), adapted to German law: quotes → invoices → payments → income, expenses with receipts, a dashboard that answers "where do I stand?", a tax reserve, and exports for the tax advisor and the tax office. Everything runs locally from `file://`, with one folder per company (see [ADR 0001](adr/0001-local-first-file-storage.md) and [ADR 0002](adr/0002-one-folder-per-company.md)).

Calculators and exports are estimates and filling aids, not tax advice. Every year-dependent value comes from `src/domain/tax/params/<year>.ts`, with its legal source and tests.

## Scope

kontor is for sole proprietors with cash-basis accounting (EÜR, § 4 Abs. 3 EStG): freelancers (§ 18 EStG) and traders, each either as small business (§ 19 UStG) or with regular VAT and advance returns, as long as no double-entry bookkeeping is required (§ 141 AO, § 241a HGB). Out of scope: corporations (GmbH, UG) and partnerships (GbR, Partnerschaft).

One person with several businesses (for example a freelance activity and a trade) keeps one company folder per business: profit (EÜR) and trade tax are determined per business. For VAT the person is one single business (Unternehmenseinheit, § 2 Abs. 1 Satz 2 UStG): the small business limits apply to the total turnover, and there is one advance return. The setup assistant says so; adding up the turnover across companies is planned with the dashboard (Phase 4) and the UStVA filling aid (R1).

## Phases

### Phase 0: foundation (done, 0.1.0)

Tooling, `file://` build with CSP, data layer (repository, validation, migrations, merge, persister, daily backup), money and IBAN basics, setup assistant, several companies with switcher, settings, German and English.

### Phase 1: customers, bank accounts, quotes, invoices

- **Customer management** (customers and suppliers, `contacts/<id>.json`): company or private person, name and additional name line, address, contact person, email for invoices, phone, customer number, VAT ID (EU business customers), Leitweg-ID for public authorities (buyer reference, BT-10), a default order or PO number (purchase order reference, BT-13; can be changed on every document), payment term and notes per customer.
- **Bank accounts:** several accounts per company (for example two current accounts and PayPal), one of them the default for invoices; the invoice shows the account chosen for it. The single bank account of `company.json` becomes a list in a schema migration.
- Quotes with "valid until"; a quote becomes an invoice with one click.
- Invoices with the mandatory content of § 14 Abs. 4 UStG; small amount invoices (§ 33 UStDV, up to 250 € gross).
- Small business: no VAT column, note on § 19 UStG. Regular: 19 %, 7 %, 0 %; reverse charge § 13b UStG ("Steuerschuldnerschaft des Leistungsempfängers"); intra-community supplies with the VAT IDs of both parties.
- Date or period of service.
- PDF with logo, bank details and optional GiroCode (EPC QR).
- Finalization: issuing assigns the number, writes `documents/issued/<number>.pdf` and its SHA-256, and an audit entry. Corrections only through cancellation or correction invoices ([ADR 0004](adr/0004-invoice-finalization-and-numbering.md)).
- Payments, including partial payments, each booked to one of the bank accounts; open and overdue invoices.
- **Customer accounts:** per customer the invoices, payments, credit notes and the open balance; payment reminders (Zahlungserinnerung, Mahnung) for overdue invoices.

### Phase 2: e-invoices

- **Outgoing:** ZUGFeRD / Factur-X (profile EN 16931 or XRECHNUNG, PDF/A-3 with embedded XML) and plain XRechnung XML (CII; UBL optional). Optional for small businesses; mandatory for regular businesses after the transition periods (2027 with a previous-year turnover above 800,000 €, otherwise 2028).
- **Incoming** (every business must be able to receive e-invoices since 2025, small businesses included): drop an XRechnung XML or a ZUGFeRD PDF → readable view → expense with prefilled fields.
- Every business can issue legally compliant e-invoices, also where the law does not require it yet. Fixtures for every supported case (regular VAT, small business, reverse charge, intra-community supply, credit note, cancellation) are validated in CI with the KoSIT validator, veraPDF and a ZUGFeRD validator (Java, GitHub Action), not in the browser. A format is offered only once its fixtures pass.
- Library decision: [ADR 0005](adr/0005-e-invoice-library.md).

### Phase 3: expenses and receipts

- Expense: date, gross amount, VAT rate and input tax, category, supplier, payment method, note.
- Receipt as a file copied into the company folder (`belege/<year>/<id>-<name>`, with SHA-256) or as a link (`https://…` to SharePoint, Nextcloud or OneDrive; only http and https). With a link, keeping the receipt is up to its storage location; the UI says so.
- Categories map to an Anlage EÜR line and to SKR03/SKR04 accounts (for the DATEV export).
- CSV import of existing bookings with column mapping.
- **Bank statements:** import per bank account (CSV; CAMT.053 later), match transactions with invoices (payments) and expenses, show what is not matched yet.

### Phase 4: dashboard and tax reserve

- Profit of the current year, open receivables, small business limits (previous year 25,000 €, current year 100,000 €, from the tax parameters). The limits count the turnover of all companies of the same person that are known to this browser, because VAT treats them as one business (see Scope).
- Reserve per month: income tax, solidarity surcharge, church tax if any, trade tax and the VAT payable.
- Every number links to the bookings behind it.

### Phase 5: recurring income and expenses

- **Retainers and subscriptions you sell:** a recurring invoice per customer with lines, interval (monthly, quarterly, yearly), start and optional end. The service period follows the interval.
- **Subscriptions you pay** (software, rent, insurance): a recurring expense with amount, VAT rate, category and supplier, prefilled each period. Each period still needs its own receipt; missing receipts are listed.
- kontor runs only while it is open, so nothing happens in the background: on opening, it lists what is due and creates drafts. Issuing a recurring invoice stays an explicit step, because it assigns the number and finalizes the invoice (ADR 0004).
- The dashboard and the prepayment forecast (R2) include the recurring amounts that are still to come in the year.

### Phase 6: Excel export

- Every list (invoices, payments, customers and customer accounts, expenses, bank transactions) and the EÜR as `.xlsx`, with amounts as numbers and dates as dates, so they can be used for further calculations.
- The writer must run under the CSP of the build; the library (or own SpreadsheetML with a zip library) is chosen in a spike, like ADR 0005.

### Later (version 2.0 or 3.0): time tracking

- Projects per customer, time entries (manual and with a timer), hourly rates per project or customer, billable or not.
- Billable time becomes invoice lines (hours as quantity in thousandths, see ADR 0003); a time entry is billed only once.
- Reports per project and customer.

### Tools without a company folder

They run without setup and store nothing, which makes them a good entry point on GitHub Pages:

1. Invoice template for small businesses → PDF
2. Quote template → PDF
3. Tax calculator for the self-employed (income tax, solidarity surcharge, church tax, trade tax, rough health and care insurance estimate) → reserve per month
4. EÜR template as `.xlsx` or CSV with the Anlage EÜR lines and a short guide

## Exports for the tax office

Sending returns to ELSTER directly needs the native ERiC library and a registration as software vendor. A serverless `file://` app cannot do that. kontor therefore prepares the values for filling in and exports files, instead of sending.

| Stage | Content | Benefit |
| --- | --- | --- |
| R1 | **UStVA filling aid** per period, one return for all companies of the same person (see Scope): tax bases and tax by form field (for example 81, 86, 66, 83; § 13b, intra-community), cash or accrual accounting, due date (10th of the following month, one month later with permanent extension). A view for typing into "Mein ELSTER", plus PDF and CSV. Field numbers come from `tax/params/<year>.ts`, checked against the current form. | Regular businesses do the advance return in minutes |
| R2 | **Income tax prepayments:** forecast of the annual profit → estimated income tax, solidarity surcharge, church tax and trade tax versus the assessed prepayments (10 March, 10 June, 10 September, 10 December). A hint when an adjustment request might make sense. | No surprise back payment |
| R3 | **Anlage EÜR:** totals per line, year-end view, PDF and CSV. | Fill in without a tax advisor |
| R4 | **Package for the tax advisor:** ZIP with the booking list (CSV), all receipts or receipt links, issued invoices (PDF/XML), account mapping. | Replaces the shoebox |
| R5 | **DATEV export** (Buchungsstapel EXTF CSV, SKR03/SKR04) and receipt images. | Can be read into DATEV directly |
| R6 | **GoBD package:** template for the process documentation (Verfahrensdokumentation), finalization check report (hashes versus files), data export for a tax audit. | Ready for an audit |
| R7 (open) | Sending to ELSTER through a separate local helper with ERiC. To be evaluated, not built. | Convenience |
