# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Setup assistant for the first start and for "Add company": browser check, folder, company details with logo (PNG, JPG or SVG up to 1 MB), tax settings (small business scheme, cash or accrual VAT, return period, permanent extension, freelance or trade with multiplier), bank account with IBAN check, invoice number format with preview, payment term and footer, and a summary. Every step is checked; nothing is written before "Finish".
- Several companies, each in its own folder. A switcher in the sidebar lists them and adds new ones; the last opened company opens again after a restart.
- Settings page with the fields of the assistant, saved section by section.
- App frame with the planned areas (dashboard, quotes, invoices, expenses, contacts, taxes, tools) shown as coming soon.
- Daily backup of the company file in the company folder (14 days kept).
- German and English interface.
- The tax step of the setup assistant and the tax settings say who kontor is for (sole proprietors with cash-basis accounting, not corporations or partnerships) and that several businesses of one person share one VAT status.
- Contacts: customers and suppliers, as company or private person, with address, invoice email, customer number (unique), EU VAT ID, Leitweg-ID for public buyers, default order or PO number, payment term and notes. Search and filter by role; deleting asks first and keeps the file, so documents that use the contact are not affected. A contact file that cannot be read is reported, the others still load. Contacts are part of the daily backup.
- Bank accounts: a company can have several accounts, bank accounts with IBAN and PayPal, managed in the settings. One of them is the default for invoices and cannot be removed; another account can be made the default. The same IBAN or PayPal address cannot be added twice. A removed account stays in the company file, so documents and payments that use it are not affected.
- Catalogue of items and services: number, name, description, unit, net price and VAT rate (19 %, 7 % or 0 %), with search, edit and delete (the file stays). Prices are typed and shown in the interface language; a small business sees prices without VAT. The units are the codes e-invoices use. Items are part of the daily backup and of the emergency copy.

### Changed

- `company.json` has schema version 2: the one bank account becomes a list of accounts with a default. A company folder is upgraded when it is read and saved in the new format with the next change; older versions of kontor then report that the folder was saved by a newer version.
