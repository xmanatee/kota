---
id: task-move-static-web-ui-serving-get-assets-out-of-core-
title: Move static web UI serving (GET /, /assets/*) out of core into the web module via KotaModule.routes
status: ready
priority: p2
area: architecture
summary: Migrate the static index.html + /assets/* handler and MIME_TYPES table out of core/server-routes.ts into a routes() contribution on the existing web module that already owns webUiDir resolution.
created_at: 2026-04-25T08:47:47.708Z
updated_at: 2026-04-25T08:47:47.708Z
---

## Problem

After the recent `/api/schedules`, `/api/notifications`, `/commands`,
`/owner-questions`, `/approvals`, `/history`, and `/push-tokens` migrations,
`src/core/server/server-routes.ts` has only one capability-specific handler
left: the static web UI serving block (lines 185-211 today). It hardcodes
`GET /` and `GET /index.html` to read `index.html` from `ctx.webUiDir`, and
`GET /assets/*` to read static assets from the same directory using a
`MIME_TYPES` lookup table that lives in core.

This is web-UI-specific behavior leaking into the core HTTP server. The
contract in `src/core/server/AGENTS.md` is explicit: "Capability-specific
routes belong in the owning module and are contributed through
`KotaModule.routes`." A `web` module already exists in `src/modules/web/`
and already owns `webUiDir` resolution — its `kota serve` command resolves
`clients/web/dist`, warns when missing, and passes the directory through
`startServer({ ..., webUiDir })`. Core then carries the option through
`ServerOptions` -> `ServerContext` -> `buildRequestHandler` purely as
pass-through. Removing this leak completes the module-first/core-shrinking
work on the server-routes layer.

The startup logging in `src/core/server/server.ts` (lines 146-160) also
still hardcodes a list of routes that are now module-contributed
(`/api/schedules`, `/api/notifications`, `/api/history`, `/api/chat/vercel`).
Once core no longer claims to own any of these, that block should be pruned
in the same change so the readout matches reality.

## Desired Outcome

The static web UI handler is contributed by the `web` module via
`KotaModule.routes(ctx)`. `core/server-routes.ts` no longer mentions
`webUiDir`, `MIME_TYPES`, `index.html`, or `/assets/`, and `webUiDir`
disappears from `ServerOptions` and `ServerContext`. The web module
resolves `clients/web/dist` exactly as it does today, and registers the
two route shapes (`GET /` and `GET /assets/*`, with `/index.html`
treated identically to `/`) against the existing `RouteRegistration`
contract. Existing client behavior is unchanged: same paths, same
content types, same caching headers, same 404 fallback when the UI is
not built. Core's startup logging is pruned so it does not advertise
routes core no longer registers.

## Constraints

- Follow the contribution pattern established by
  `src/modules/scheduler/routes.ts` and `src/modules/commands/`. Use
  `RouteRegistration` for both handlers; introduce a `pathPattern`
  registration for `/assets/*` rather than re-implementing path matching
  inside core.
- Auth and CORS behavior must match exactly. The current core handler
  serves these routes outside the `if (ctx.authToken && path.startsWith
  ("/api/"))` block, so the static UI is intentionally unauthenticated
  (the auth token is delivered into the page via the URL `?token=...`).
  Module-contributed routes inherit the same out-of-`/api/` exemption
  because they are matched after the `/api/` auth gate. Verify that the
  registration mechanism preserves this; if not, use `bypassAuth: true`
  explicitly so behavior does not silently change.
- Caching headers must match: `Cache-Control: public, max-age=31536000,
  immutable` for `/assets/*`, no caching for `index.html`. Content-Type
  for `index.html` must remain `text/html; charset=utf-8`.
- The `..` traversal guard in the current handler
  (`path.replace(/\.\./g, "")`) must be preserved at the module boundary
  with at least equivalent strictness. Prefer `path.posix.normalize` +
  containment check over the regex strip if the migration makes a
  cleaner option available, but do not weaken the guard.
- The 404 fallback when `webUiDir` is absent or files cannot be read
  must continue to return JSON `{ error: "Web UI not installed" }` /
  `{ error: "Not found" }` matching today's shape.
- Do not introduce a parallel registry for static-asset modules; the
  one route contribution mechanism is the correct surface.
- The web module's `kota serve` command continues to own the
  `clients/web/dist` resolution and the "Warning: Web UI not built"
  message. The route registration should be derived from that resolved
  directory, not duplicated.
- Update `src/core/server/AGENTS.md` only if the contract narrows or
  shifts; otherwise leave it untouched (the existing rule already
  covers this migration).
- Prune the now-stale startup readout in `src/core/server/server.ts`:
  core should only log endpoints it actually owns (sessions, chat,
  events, daemon status, health). Module-contributed routes should be
  logged by their owning module if they are worth logging.

## Done When

- `git grep -n "webUiDir\|MIME_TYPES\|/assets/\|index.html"` in
  `src/core/server/` returns nothing (or only the `ServerOptions`
  removal commit-hint comment, if a reviewer wants one — preferred is
  zero matches).
- `webUiDir` no longer appears in `ServerOptions` or `ServerContext`.
- The web module's `routes()` (or equivalent contribution) registers
  the static handler and the registration is exercised by a focused
  test in `src/modules/web/`.
- `pnpm test` passes; the existing
  `src/server-e2e.integration.test.ts` continues to pass with the
  static UI served through the module path.
- Manual verification (or an additional test fixture) shows
  `curl -i http://127.0.0.1:<port>/` returns 200 + the index html, and
  `curl -i http://127.0.0.1:<port>/assets/<known-file>` returns 200 +
  the immutable Cache-Control header.
- The startup readout in `src/core/server/server.ts` no longer
  advertises module-owned routes (`/api/schedules`,
  `/api/notifications`, `/api/history`, `/api/chat/vercel`).

## Source / Intent

Module-first / core-shrinking initiative. `src/core/server/AGENTS.md`
already mandates the migration shape. Recent commit cadence (last ~10
commits, every other commit) shows this is the active migration front:
push-tokens, history, approvals, owner-questions, commands, schedules
+ notifications. The static web UI is the last capability-specific
handler still living directly in `src/core/server/server-routes.ts`,
making this the natural next step before the loop runs out of clean
single-target migrations on this surface.

## Initiative

Module-first / core-shrinking. Continue extracting capability-specific
HTTP surfaces into their owning modules so `src/core/` retains only
protocol, lifecycle, and shared runtime primitives.

## Acceptance Evidence

- Diff showing `core/server-routes.ts` no longer registers the static
  UI handler and the web module's `routes()` registration covering
  both shapes.
- `pnpm test` log showing the new web-module route test green and the
  existing `server-e2e.integration.test.ts` still green.
- A `curl -i` transcript (or test fixture equivalent) for `GET /` and
  `GET /assets/<file>` showing identical headers and bodies to the
  pre-migration responses.
- Diff showing the stale endpoint log lines pruned from
  `src/core/server/server.ts`.
