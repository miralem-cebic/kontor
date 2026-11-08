# Security Policy

## Supported versions

Security fixes are provided for the latest released version of kontor. Please update to the most recent release before reporting an issue.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report them privately using GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/miralem-cebic/kontor/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the steps to reproduce it, and the potential impact.

Please include as much of the following as possible:

- The version or commit you tested.
- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Any suggested mitigation or fix.

## What to expect

- **Acknowledgement** within 7 days.
- **Assessment** of severity and impact, shared with you in the advisory.
- **Fix and release** as soon as practical. We will coordinate the disclosure date with you.
- **Credit** in the release notes and the security advisory, unless you prefer to remain anonymous.

## Browser storage under `file://`

kontor runs from `dist/index.html` under `file://`. In Chromium, every page opened from disk shares one storage origin: an HTML file that a person opens from a download or a mail attachment can read and write the same `localStorage` and IndexedDB as kontor. kontor keeps there:

- the emergency copy of unsaved changes (`kontor.unsaved.v2.<companyId>`), only while changes are not written to the folder;
- the folder handles of the companies (IndexedDB `kontor`), the device ID, the last opened company and the interface preferences.

What protects the data:

- The emergency copy carries an HMAC-SHA-256 with a random key that is kept in the company folder (`.kontor/emergency-copy.key`), not in the browser. A copy without that signature, or with a changed content, is removed and never used, so a page that can only write the browser's storage cannot inject records. Unsigned copies of earlier versions are removed too.
- Even a signed copy never brings back an issued invoice, a cancellation, a finalized quote, a payment, a dunning or a decision on a quote: these are written to the folder before they reach the app's state.
- The copy is removed as soon as the changes are written.

What it does not protect: the content of the emergency copy can be **read** by such a page while it exists (it is not encrypted, because it is also written while the page unloads, where encryption with Web Crypto cannot finish). Whether such a page can also use the stored folder handles depends on how Chrome scopes the folder permission for `file://`; this has not been verified. Use kontor in a browser profile in which you do not open HTML files from unknown sources.

## Scope

In scope: the kontor application and the code and build pipeline in this repository. Of particular interest:

- ways in which content of a company folder, a backup or browser storage (written by someone else) can run code, reach the network, read or write outside the folder, or corrupt data;
- ways around the Content Security Policy of the built app;
- an issued invoice that can be changed without trace, or an invoice number that can be assigned twice.

Out of scope: vulnerabilities in third-party services such as OneDrive, SharePoint, Nextcloud or Dropbox, and issues that require a compromised device or account.

Please do not include real financial data (IBANs, invoices, tax numbers) in a report. Use made-up test data.
