# Roadmap

kontor follows the feature set of epufix (Austria), adapted to German law: quotes → invoices → payments → income, expenses with receipts, a dashboard that answers "where do I stand?", a tax reserve, and exports for the tax advisor and the tax office. Everything runs locally from `file://`, with one folder per company (see [ADR 0001](adr/0001-local-first-file-storage.md) and [ADR 0002](adr/0002-one-folder-per-company.md)).

Calculators and exports are estimates and filling aids, not tax advice. Every year-dependent value comes from `src/domain/tax/params/<year>.ts`, with its legal source and tests.

## Phases

### Phase 0: foundation (done, 0.1.0)

Tooling, `file://` build with CSP, data layer (repository, validation, migrations, merge, persister, daily backup), money and IBAN basics, setup assistant, several companies with switcher, settings, German and English.

### Phase 1: contacts, quotes, invoices

- Contacts: customers and suppliers (`contacts/<id>.json`), with VAT ID for EU business customers.
- Quotes with "valid until"; a quote becomes an invoice with one click.
- Invoices with the mandatory content of § 14 Abs. 4 UStG; small amount invoices (§ 33 UStDV, up to 250 € gross).
- Small business: no VAT column, note on § 19 UStG. Regular: 19 %, 7 %, 0 %; reverse charge § 13b UStG ("Steuerschuldnerschaft des Leistungsempfängers"); intra-community supplies with the VAT IDs of both parties.
- Date or period of service.
- PDF with logo, bank details and optional GiroCode (EPC QR).
- Finalization: issuing assigns the number, writes `documents/issued/<number>.pdf` and its SHA-256, and an audit entry. Corrections only through cancellation or correction invoices ([ADR 0004](adr/0004-invoice-finalization-and-numbering.md)).
- Payments, including partial payments; open and overdue invoices.

### Phase 2: e-invoices

- **Outgoing:** ZUGFeRD / Factur-X (profile EN 16931 or XRECHNUNG, PDF/A-3 with embedded XML) and plain XRechnung XML (CII; UBL optional). Optional for small businesses; mandatory for regular businesses after the transition periods (2027 with a previous-year turnover above 800,000 €, otherwise 2028).
- **Incoming** (every business must be able to receive e-invoices since 2025, small businesses included): drop an XRechnung XML or a ZUGFeRD PDF → readable view → expense with prefilled fields.
- Generated fixtures are validated in CI with the KoSIT validator (Java, GitHub Action), not in the browser.
- Library decision: [ADR 0005](adr/0005-e-invoice-library.md).

### Phase 3: expenses and receipts

- Expense: date, gross amount, VAT rate and input tax, category, supplier, payment method, note.
- Receipt as a file copied into the company folder (`belege/<year>/<id>-<name>`, with SHA-256) or as a link (`https://…` to SharePoint, Nextcloud or OneDrive; only http and https). With a link, keeping the receipt is up to its storage location; the UI says so.
- Categories map to an Anlage EÜR line and to SKR03/SKR04 accounts (for the DATEV export).
- CSV import of existing bookings with column mapping.

### Phase 4: dashboard and tax reserve

- Profit of the current year, open receivables, small business limits (previous year 25,000 €, current year 100,000 €, from the tax parameters).
- Reserve per month: income tax, solidarity surcharge, church tax if any, trade tax and the VAT payable.
- Every number links to the bookings behind it.

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
| R1 | **UStVA filling aid** per period: tax bases and tax by form field (for example 81, 86, 66, 83; § 13b, intra-community), cash or accrual accounting, due date (10th of the following month, one month later with permanent extension). A view for typing into "Mein ELSTER", plus PDF and CSV. Field numbers come from `tax/params/<year>.ts`, checked against the current form. | Regular businesses do the advance return in minutes |
| R2 | **Income tax prepayments:** forecast of the annual profit → estimated income tax, solidarity surcharge, church tax and trade tax versus the assessed prepayments (10 March, 10 June, 10 September, 10 December). A hint when an adjustment request might make sense. | No surprise back payment |
| R3 | **Anlage EÜR:** totals per line, year-end view, PDF and CSV. | Fill in without a tax advisor |
| R4 | **Package for the tax advisor:** ZIP with the booking list (CSV), all receipts or receipt links, issued invoices (PDF/XML), account mapping. | Replaces the shoebox |
| R5 | **DATEV export** (Buchungsstapel EXTF CSV, SKR03/SKR04) and receipt images. | Can be read into DATEV directly |
| R6 | **GoBD package:** template for the process documentation (Verfahrensdokumentation), finalization check report (hashes versus files), data export for a tax audit. | Ready for an audit |
| R7 (open) | Sending to ELSTER through a separate local helper with ERiC. To be evaluated, not built. | Convenience |
