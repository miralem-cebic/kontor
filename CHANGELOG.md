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
- Quotes as drafts: customer, date, valid until (30 days by default), subject, introduction and closing text. Lines come from the catalogue or are typed freely, with quantity (up to three decimal places, negative for a deduction), unit, unit price and VAT rate; they can be moved and removed. A deduction can lower the lines of its VAT rate, but not below zero; the check shows while typing. Totals show the VAT per rate, rounded once per rate; a small business sees the total and the note on § 19 UStG. The list shows the amount, marks expired quotes and filters them by validity (all, valid, expired, with counts). Quote numbers, the PDF and turning a quote into an invoice follow.

### Changed

- `company.json` has schema version 2: the one bank account becomes a list of accounts with a default. A company folder is upgraded when it is read and saved in the new format with the next change; older versions of kontor then report that the folder was saved by a newer version.
- The content area is a panel with rounded corners on a slightly darker frame, and cards and lists are white on a light grey background, so they stand out better (light and dark mode).
- Settings: a side panel on the right lists the sections (company details, tax, invoices, bank accounts, logo, app) and shows one at a time. Changes that are not saved yet stay when switching sections, and the side panel marks the section.
- The forms for contacts, items and quotes have the same width. Contacts and quotes have a side panel on the right with jump marks to their sections; it stays in view while scrolling and marks the section being read. On a narrower window the lines of a quote use two rows.

### Fixed

- The window showed a second vertical and a horizontal scroll bar: the hidden file field of the logo stuck out of the content area. Now only the content area scrolls.
