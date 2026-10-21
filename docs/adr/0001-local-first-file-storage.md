# 0001: Local-first storage in a folder of JSON files

- Status: Accepted
- Date: 2026-10-21

## Context

kontor is for self-employed people and small businesses who want to keep their books without a cloud service, a subscription or a server to run. Their data is financial and personal: invoices, bank details, tax numbers. Many already use a synced folder (OneDrive, SharePoint, Nextcloud, Dropbox) and share it with a tax advisor.

teamtodo showed that a React app can run from `file://` in Chrome and Edge and store its data through the File System Access API in a folder the user chooses.

## Decision

- kontor is a single-page app that runs by double-clicking `dist/index.html`. The build is one classic IIFE script, fonts are embedded, and a Content Security Policy forbids network access (`connect-src 'none'`).
- Data lives as JSON files (and receipts, PDFs, XML) in a folder chosen by the user. There is no server, no database and no user management.
- Only `src/data/fs/` talks to the File System Access API; the rest of the app uses the `Repository` interface. Operations return a `Result` instead of throwing.
- Everything read from the folder is validated at the boundary before use. Files carry a `schemaVersion`; older files are migrated when read, newer ones block loading.
- Writes are debounced; a failed write is kept in a queue and in an emergency copy in `localStorage`. `company.json` is merged field by field when another device changed it (`fieldUpdatedAt`, hybrid clock).
- A backup of the company file is written once a day into the folder.

## Consequences

- Works offline, keeps data under the user's control, and needs no operations.
- Only Chromium-based desktop browsers are supported (Chrome, Edge). Safari and Firefox lack the folder API; mobile browsers are out of scope.
- The browser asks for permission to the folder again after a restart; the start screen offers "Continue with …".
- A synced folder may be written by two devices. The merge handles concurrent edits of different fields; invoice numbering needs more care (ADR 0004).
- Libraries must work in an IIFE bundle under `file://` with the CSP: no `eval`, no workers from URLs, no network.
- Direct submission to ELSTER is not possible from the browser (it needs the native ERiC library); kontor exports and prepares values instead (see the roadmap).

## Alternatives considered

- **A hosted web app with a database:** convenient across devices, but requires operating a service, accounts and handling financial data of others.
- **Electron or Tauri:** full file system access and native libraries (ERiC), but a heavier distribution and update process. Can be revisited for R7.
- **Browser storage only (IndexedDB):** no folder permission needed, but data is tied to one browser profile, invisible to the tax advisor and easy to lose.
