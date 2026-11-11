# 0007: Container image for self-hosting

- Status: Accepted
- Date: 2026-11-11

## Context

kontor runs from `dist/index.html` under `file://` (ADR 0001). The owner wants it to be reachable from several devices at home, served by a Raspberry Pi, and to ship it as a Docker image.

The data does not move with the app: the company folder is chosen in the browser through the File System Access API and stays on the device of the browser. That API, IndexedDB handles and Web Locks need a secure context. `file://` and `http://localhost` are one; `http://<name-of-the-pi>` is not, and then kontor shows "not supported" (`src/data/fs/support.ts`).

This ADR builds on ADR 0001 and does not replace it: no server-side storage is added.

## Decision

- The image is a static file server for `dist/`. It has no API, no database, no volume and no write access to the data of any company.
- Build in two stages. The build stage runs on the build platform (`--platform=$BUILDPLATFORM`), because `dist/` is the same for every CPU. Only the final stage (`nginx-unprivileged`) is per platform: `linux/amd64`, `linux/arm64` and `linux/arm/v7`, so a Pi runs it with a 64-bit or a 32-bit system.
- The container runs as a non-root user, listens on port 8080 and can run with a read-only root file system.
- The server adds the headers a `<meta>` tag cannot: `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`. Its `Content-Security-Policy` is the one of the build (`CONTENT_SECURITY_POLICY` in `build/fileProtocol.ts`) plus `frame-ancestors`; a unit test keeps both in sync. Nothing is cached without revalidation, because `assets/app.js` has no hash in its name.
- HTTPS is not done in the image. `compose.yaml` publishes the port on the Pi's loopback by default (`localhost` is a secure context, for example through an SSH tunnel). An optional `compose.https.yaml` adds Caddy with its own certificate authority for the home network. A reverse proxy or Tailscale that the owner already runs works as well.
- The image is published to `ghcr.io/miralem-cebic/kontor` for release tags only, with the version tag and `latest` (no `latest` for pre-releases).

## Consequences

- The zip from the release stays the main way to use kontor. The image is for people who want one address for all their devices.
- A new origin (another address or port) has its own IndexedDB: the folder has to be chosen again once per origin, and the browser asks again after a restart, as before.
- Two devices using the same company folder at the same time is still not supported (ADR 0004). A shared address makes it easier to do by mistake; the documentation says so.
- The company folder is not on the Pi. The Pi cannot read or back up the data. If the Pi should hold the data, the folder has to be a network share that the browser device mounts.
- The release has a second artifact to build and test. CI builds the image for amd64 and smoke tests it for each pull request; the arm images are built on release only.
- The "no server" promise of the README becomes "no server that sees your data". `connect-src 'none'` is unchanged, so the page cannot send anything to the server it came from, apart from loading itself.
