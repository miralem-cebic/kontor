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
