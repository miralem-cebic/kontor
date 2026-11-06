# 0006: Access for an AI agent to the company folder

- Status: Proposed
- Date: 2026-11-06

## Context

kontor runs in the browser from `file://`, with no server, no network and `connect-src 'none'` (ADR 0001). The browser app cannot listen on a port, and it must not reach the network. An AI agent on the user's desktop should still be able to read a company's records and make limited changes, so the user can ask for work on their books without copying data by hand.

The company folder is the shared state. The browser app saves into it with a conflict check and a field-level merge (`fieldUpdatedAt`). Numbers are assigned only on issue, and one writer per company is assumed (ADR 0004).

Three options were considered:

1. An MCP server over stdio, started by the agent on the desktop.
2. A command line tool that the agent calls through its shell.
3. No access: the agent works from the exports (CSV and Excel, F35 and F37).

Option 3 needs no decision and stays the fallback. Options 1 and 2 share the same core and differ only in the interface.

## Decision

A separate local tool, proposed as an MCP server over stdio in `tools/kontor-mcp`, outside the browser app. It reuses the domain rules in `src/domain/` and the file boundary in `src/data/` (`migrate`, the validators and the merge). It brings its own file-system adapter that implements `Repository`, because `src/data/fs/` is the browser adapter.

- **Transport:** stdio. The agent starts the process on the desktop; nothing listens on a port.
- **Concurrency:** the tool writes the way the browser app does. It reads the file, compares `lastModified`, merges field by field and writes back. It never writes a file that the validators refused. Each write appends an audit line with the action `agentWrite` and the tool's name. Audit lines are not read back by the app, so no migration is needed.
- **Folder scope:** exactly one company folder, named by the user when the tool starts. The tool does not search for folders and refuses paths outside it.
- **Writes in a first version:** creating and changing expenses and contacts. No deletion. Not allowed: issuing, cancelling, payments, dunnings, finalizing quotes and taking back an import. These assign numbers, leave the house or change money. Everything else is read-only, including the audit log.

## Consequences

- The browser app does not change: `file://`, no network, no new permission.
- The tool has its own build and tests and is not part of `dist/index.html`.
- There is a second file-system adapter (Node). The layering rule in CLAUDE.md then needs to name both adapters as the only code that touches files.
- Concurrent writes from the agent and an open browser window are handled by the merge. A numbering conflict cannot arise, because the first version assigns no numbers.
- Every agent write is visible in the audit log.
- Widening the scope, for example to invoices, needs a new ADR.
- Not decided here: the tool names and the wire format of the MCP calls.
