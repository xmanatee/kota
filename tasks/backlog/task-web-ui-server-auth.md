---
id: task-web-ui-server-auth
title: Add token-based auth to the kota serve HTTP server
status: backlog
priority: p2
area: reliability
summary: kota serve binds to all interfaces with no authentication. Any host on the local network can access the chat API and trigger agent sessions. A simple bearer token would close this gap without requiring a full identity layer.
created_at: 2026-03-31T00:05:00Z
updated_at: 2026-03-31T00:05:00Z
---

## Problem

`kota serve` starts an HTTP server that binds to all network interfaces (no explicit
`127.0.0.1` binding in `server.listen`). All routes — chat, session management,
approvals, task queue mutations — are open with no authentication. An operator on a
shared or office network is exposed: any host that can reach the machine can send
messages, trigger agent sessions, and drain API budget.

The daemon control API already uses a `Bearer <token>` scheme (token written to
`.kota/daemon-control.json`). A similar pattern for `kota serve` would be consistent
and simple to implement.

## Desired Outcome

`kota serve` generates or reads a session token on startup and requires it on every
API request:

- On first run, a random token is generated and printed to the terminal (or optionally
  written to a well-known file).
- Subsequent requests without a matching `Authorization: Bearer <token>` header receive
  `401 Unauthorized`.
- The web UI client reads the token from a startup cookie or URL param (e.g.
  `?token=...` on first load) and injects it into all API requests; the browser session
  persists the token in `localStorage`.
- An opt-out flag (`--no-auth` or `serve.noAuth: true` in config) allows localhost-only
  operators to skip auth for development convenience.

## Constraints

- Default to auth enabled; opt-out must be explicit.
- Token generation and validation belong in `server.ts` / `server-routes.ts`; do not
  spread auth logic into individual route handlers.
- The web UI must work end-to-end with auth enabled — no breakage to existing panels.
- Existing server integration tests may need auth headers; update them rather than
  disabling auth for tests.
- Out of scope: user accounts, OAuth, session expiry, multi-user support.

## Done When

- `kota serve` prints the auth token at startup.
- API requests without a valid token return `401`.
- Web UI passes the token correctly and all panels work.
- `--no-auth` flag disables auth for development.
- At least one server test covers the `401` path.
