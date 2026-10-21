# Competition

Market analysis behind the feature list in the [roadmap](roadmap.md). Status: 21 October 2026. It is based on the vendors' feature pages and help articles (see [Sources](#sources)) and a market overview.

Markers:

- **✔ confirmed:** stated in a help article or on a feature page of the vendor (linked below).
- **? to be verified:** plausible, but not backed by a source yet. It must be confirmed with a real export (roadmap, Phase 3.5, "Real sample exports").

## Competitors

| App | Type | Strengths | Lesson for kontor |
| --- | --- | --- | --- |
| **sevDesk** | cloud, subscription | very broad: invoices, dunning levels, e-invoices in and out, AI receipts, bank connection, EÜR, UStVA via ELSTER, cash book, fixed assets, time tracking, DATEV exports ✔ | the benchmark for the range of features |
| **Lexware Office** (formerly lexoffice) | cloud, subscription | automation and mobile app ?; DATEV exports (Buchungsstapel, receipt ZIP, bank transactions) ✔ | the benchmark for simplicity, and the most important source of people moving |
| **WISO MeinBüro** (Buhl) | desktop and web | ELSTER, interfaces for tax advisors ?; the desktop version is the closest relative of kontor (local) | shows that local software is accepted in Germany |
| **easybill** | cloud, invoicing only | shop connections and mass sending ?; freely definable CSV export and Excel reports ✔ | has no EÜR, so kontor covers more |
| **Papierkram** | cloud, freemium | freelancers, time tracking, projects ?; DATEV export of income and expenses ✔ | time tracking is a reason for freelancers to switch |
| **FastBill** | cloud, subscription | fast month-end closing ?; DATEV partner ✔ | the closing workflow |
| **Accountable** | app first | step-by-step tax help ?; DATEV CSV plus `receipts.zip` linked by receipt ID ✔ | guides through obligations instead of only showing forms |
| **epufix** (Austria) | cloud, subscription | deliberately lean, no bank login and no AI, "Excel moves with you" ? | the model for the philosophy |

Prices of the subscription apps: about 8–20 € per month ?.

How kontor positions itself against them (what it competes on and where it is deliberately different) is in the [roadmap](roadmap.md#positioning).

## What the apps export

No app offers a complete, open export of everything, but each one exports parts. kontor therefore relies on three common channels (DATEV Buchungsstapel, CSV, invoices as PDF or ZUGFeRD) and adds presets per app (roadmap, Phase 3.5, I1–I7).

| App | Contacts | Invoices | Bookings (DATEV) | Receipts | Items |
| --- | --- | --- | --- | --- | --- |
| Lexware Office | ✔ CSV (billing and delivery address, contact person, customer number, tax number, VAT ID) | PDF ? | ✔ Buchungsstapel CSV | ✔ ZIP in DATEV format | import ✔, export ? |
| sevDesk | CSV ? | PDF ?, list ? | ✔ CSV/XML in DATEV format | ? | import ✔, export ? |
| easybill | ? | ✔ freely definable CSV export, ✔ Excel report | DATEV data service ✔, file ? | ? | ? |
| Papierkram | ? | ? | ✔ income and expenses, together or separately | ? | ? |
| Accountable | ? | ? | ✔ CSV | ✔ `receipts.zip`, linked by receipt ID | not available |
| FastBill | ? | ? | ? (DATEV partner ✔) | ? | ? |
| WISO MeinBüro | ? | ? | ? | ? | ? |

Every "?" is replaced by ✔ or "not available" once the real sample exports are in `tests/fixtures/import/` (roadmap, Phase 3.5).

## Sources

- [sevDesk: feature overview](https://sevdesk.de/funktions-uebersicht)
- [Lexware Office: which DATEV exports are offered](https://help.lexware.de/de-form/articles/548539-welche-datev-exporte-bietet-lexware-office-an)
- [Lexware Office: exporting and importing contacts](https://help.lexware.de/de-form/articles/548116-kontakte-beim-account-wechsel-ubertragen-export-und-import-in-lexware-office)
- [easybill: reports and exports](https://www.easybill.de/?p=34387)
- [easybill: DATEV data export](https://www.easybill.de/en/datev)
- [Papierkram: DATEV export](https://www.papierkram.de/aktuelles/neues-feature-erweiterter-und-verbesserter-datev-export/)
- [Accountable: DATEV export](https://help.accountable.eu/en/articles/15290215-datev-export-in-accountable)
- [FastBill in the DATEV marketplace](https://www.datev.de/web/de/marktplatz/fastbill)
- [kostenlose-erechnung.de: DATEV export, Buchungsstapel](https://kostenlose-erechnung.de/ratgeber/datev-export-rechnungssoftware-buchungsstapel/)
