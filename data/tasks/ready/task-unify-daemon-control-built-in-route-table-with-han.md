---
id: task-unify-daemon-control-built-in-route-table-with-han
title: Unify daemon-control built-in route table with handler dispatch into one declarative registry
status: ready
priority: p2
area: core
summary: Replace daemon-control's parallel BUILTIN_ROUTE_SCOPES table + 220-line handleRequest if-chain + bypassAuth/contributed-handlers maps with one declarative built-in-route registry that owns method/path/scope/handler/bypassAuth in one place, removing the multi-source-of-truth seam.
created_at: 2026-05-06T01:04:33.463Z
updated_at: 2026-05-06T01:04:33.463Z
---

## Problem

`src/core/daemon/daemon-control.ts` (520 lines) routes built-in daemon-
control endpoints through three parallel surfaces that must stay in
sync:

- `BUILTIN_ROUTE_SCOPES` (lines 71–98) — a `Record<string, CapabilityScope>`
  declaring 27 method+path keys and their auth scope. Used by
  `findKeyedRouteMatch` for matching and by `isAuthorized` /
  `bypassAuthRoutes` for the auth gate.
- `handleRequest` (lines 296–519) — a manual if-chain over `method` and
  `path` (with ad-hoc `path.startsWith()` and `path.endsWith()` checks)
  that calls the actual extracted handler. Two routes (`GET /health`
  and the `GET /events` SSE stream) bypass the table entirely; another
  set (sessions, chat) inline pool/binding wiring before delegating.
- `contributedHandlers: Map<string, handler>` and `bypassAuthRoutes:
  Set<string>` — built from `controlRoutes` contributions in the
  constructor, then consulted from `handleRequest` after the if-chain
  fails.

Adding a new built-in route today touches at minimum
`BUILTIN_ROUTE_SCOPES` (for matching + auth) and the if-chain (for
dispatch); a missing dispatch entry returns 404 even though the auth
table claims the route exists. Module-contributed routes go through a
fourth surface (`controlRoutes` → `contributedHandlers`), so adding
behavior to a built-in route means choosing between editing two places
or migrating the route into the contributed table — both are easy to
get wrong.

## Desired Outcome

`daemon-control.ts` declares its built-in routes through one
`ControlRouteRegistration[]` (or a near-identical typed shape that
already exists for module contributions) where each entry carries
`method`, `path`, `capabilityScope`, `handler`, and the optional
`bypassAuth` flag. The constructor merges built-in entries with
contributed entries into one route table; `handleRequest` does one
match against that table and dispatches the matched entry's handler.
The 220-line if-chain collapses into the handler bodies (one each, all
already imported from the existing `daemon-control-*.ts` siblings) plus
a small dispatcher wrapper.

The two anomalies (`GET /health` no-auth pre-table check; `GET /events`
SSE stream) stay correct: either they become first-class entries with
the same registration shape (preferred — `bypassAuth` covers `/health`,
and the SSE handler accepts the response/request like any other) or
they remain narrowly scoped pre-match shortcuts at the top of
`handleRequest`. No silent third path.

## Constraints

- One mechanism. Reuse the `ControlRouteRegistration` shape that module
  contributions already use, or extend it minimally if built-in entries
  need a few extra fields. Do not introduce a parallel "internal route"
  type.
- Do not change the wire shape of any existing route. Method, path,
  request/response, error responses, and HTTP status codes must match
  the current behavior. Existing routes' tests must pass unmodified.
- Preserve the existing collision detection: contributed routes that
  collide with built-in routes still throw at server construction.
  Module routes with capture segments (`:name`, `*name`) still get the
  current "literal path collisions throw, capture overlaps are
  permitted" treatment. The route-matching helper
  (`findRouteMatch` / `findKeyedRouteMatch`) is the single matcher.
- The existing chat/session paths thread runtime state (`chatPool`,
  `chatBindings`, `conversationResolver`, `defaultAutonomyMode`,
  `makeAgent`, `setSessionAutonomyMode`) into handlers. Keep that
  threading explicit by binding the handler closures at registration
  time rather than reaching back into the class from inside a generic
  handler.
- No backwards-compatibility shim. Delete the if-chain rather than
  aliasing it. Delete `BUILTIN_ROUTE_SCOPES` and the `routeScopes`
  derived state once the unified registry replaces them. The auth and
  bypass behavior should fall out of the unified registry instead of
  side tables.
- The local `AGENTS.md` (`src/core/daemon/AGENTS.md`) names the
  unified-registry convention and the orchestrator-vs-handler boundary
  so future contributors do not reintroduce the parallel-table seam.
  Do not duplicate that note across other docs. Keep the note short —
  the file is already at 7977 bytes (cap 8000), so prune any now-stale
  prose in the same edit.

## Done When

- `daemon-control.ts` no longer contains `BUILTIN_ROUTE_SCOPES` as a
  separate top-level table or the manual `method/path` if-chain inside
  `handleRequest`. The class field equivalents (`routeScopes`,
  `contributedHandlers`, `bypassAuthRoutes`) collapse into one
  registry-derived structure (a single `Map<key, ResolvedRoute>` is
  acceptable; two tightly-coupled maps with one canonical iteration
  order are not).
- `daemon-control.ts` shrinks to ≤ ~360 lines (net removal of ≥150
  lines vs the current 520 — the if-chain alone is ~220 lines, so this
  is a conservative target).
- All existing daemon-control tests pass without test-only changes.
  Tests that probed the parallel tables directly (if any) are
  rewritten against the unified registry surface, not deleted.
- `pnpm typecheck` and `pnpm test` pass.
- `src/strict-types-policy-baseline.json` is regenerated only for the
  new file relocations (no net new `unknown` / `Record<string,
  unknown>` / `as unknown` usages).
- `src/core/daemon/AGENTS.md` notes the unified-registry convention
  without growing past the 8000-byte injection cap.

## Source / Intent

Continuation of the minimal-core / shrink-the-monolith cluster
following five recent class-monolith splits (McpServer, ModuleLoader,
Daemon, step-executor-agent, WorkflowRuntime). The class-shaped split
pattern has run its course in the workflow runtime; the next visible
architectural seam is `DaemonControlServer`, where the monolith is
not the class itself but a parallel-tables-vs-dispatch-chain shape.
The fix here unifies that seam instead of re-splitting an already-
thin file.

Recent runtime evidence: the previous builder run
(`2026-05-06T00-29-49-230Z-builder-198iwc`, $9.45) burned a repair
iteration on a near-cap `AGENTS.md` write; multiple `AGENTS.md`
files now sit within 60 bytes of the 8000-byte injection cap, so any
new convention note in this area must replace older prose rather
than append.

## Initiative

Minimal-core / module-first architecture: collapse parallel surfaces
inside `src/core/` so each route, capability, or contribution is
declared once with its handler and scope, not duplicated across a
match table and a dispatch chain.

## Acceptance Evidence

- Before/after `wc -l src/core/daemon/daemon-control.ts` recorded in
  the commit message, with the new line count below the ~360-line
  target.
- The commit message names the unified registry's name and the route
  count it covers (built-in + contributed entries should iterate from
  one source).
- `pnpm typecheck` and `pnpm test` transcripts are clean (the
  builder's repair-loop checks already cover this; the commit message
  must reference the validation gates that ran).
- `src/core/daemon/AGENTS.md` lists the unified-registry convention
  and remains under the 8000-byte injection cap.
