---
id: task-migrate-the-sessions-kotaclient-namespace-end-to-e
title: Migrate the sessions KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move SessionsClient interface and SessionsListResult/SessionsSetAutonomyModeResult types from src/core/server/kota-client.ts into src/modules/daemon-ops/client.ts; add a daemonClient(link) factory to the daemon-ops module that wires GET /sessions and PATCH /sessions/:id through the typed DaemonTransport, contributing the sessions namespace handler; remove listSessionsHttp/setSessionAutonomyModeHttp wire functions, the inline sessions handler closure on buildCoreStubDaemonClientHandlers, and the DaemonControlClient.setSessionAutonomyMode direct method from src/core/server/daemon-client.ts.
created_at: 2026-05-05T05:01:02.365Z
updated_at: 2026-05-05T05:20:58.743Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), the recall migration (`5ab2bd0b`), the
webhook migration (`201d35ce`), the approvals migration (`e0030ada`),
the secrets migration (`5841c7f0`), the memory migration (`5bcc9e24`),
the knowledge migration (`d346a5c7`), the history migration
(`a38978c8`), the evalHarness migration (`d3afe7e7`), and the voice
migration (`24d0ebed`, 2026-05-05) have validated the
`daemonClient(link)` foundation pattern by moving twenty-two namespaces
out of `src/core/server/kota-client.ts` and `src/core/server/
daemon-client.ts` into their owning modules. 5 namespaces still have
their TypeScript shape and daemon-side wire code centralized in those
two files (`kota-client.ts` is 647 lines, `daemon-client.ts` is 1073
lines, both still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method
end-to-end shape is `sessions`:

- 2 methods (`list()`, `setAutonomyMode(id, mode)`) — a GET / PATCH
  pair owned by the same module (`daemon-ops`) that already contributes
  the `sessions` local handler through `sessionsLocalClient()` plus the
  yet-to-migrate `daemonOps` namespace.
- The voice migration's `## Source / Intent` explicitly named
  sessions as the next pilot ("matching the upcoming sessions
  migration's identical `daemon_required` arm shape"). The shape extends
  the pattern in two new dimensions the prior pilots did not exercise:
  the first migration whose contract carries a `reason: "daemon_required"`
  arm at the namespace shape that only the local handler emits (the
  daemon-side factory's wire code returns `daemon_required` only from
  the `try/catch` on transient transport failures during PATCH —
  matching today's `setSessionAutonomyModeHttp` behavior at lines
  220–223), and the first migration whose wire response shape includes
  optional fields (`source?`, `serveOwned?`) the daemon-side factory
  must default explicitly to satisfy the typed result contract.
- The owning module (`src/modules/daemon-ops/`) already exists with its
  own `localClient(ctx)` factory at `index.ts` line 489
  (`return { sessions: sessionsLocalClient(), daemonOps }`), control
  routes registered against the daemon at `GET /sessions` and
  `PATCH /sessions/:id` in `src/core/daemon/daemon-control.ts` lines
  445 and 478, and `localClient`-backed CLI surfaces in `session-cli.ts`.
- ~35 lines of namespace-owned types in `kota-client.ts` (lines
  407–439):
  - `SessionsListResult` (lines 407–409, 3 lines): the
    `{ sessions: InteractiveSession[] }` list shape.
  - `SessionsSetAutonomyModeResult` (lines 417–420, 4 lines): the
    three-arm `{ ok: true; autonomyMode; source: "daemon" | "serve";
    serveOwned: boolean } | { ok: false; reason: "not_found" } |
    { ok: false; reason: "daemon_required" }` discriminated union.
  - `SessionsClient` (lines 436–439, 4 lines).
  - The supporting doc comments (lines 411–416 and 422–435).
- ~75 lines of wire code in `daemon-client.ts` —
  `listSessionsHttp` (lines 179–191, 13 lines) returning
  `{ sessions: InteractiveSession[] } | null`,
  `setSessionAutonomyModeHttp` (lines 193–224, 32 lines) returning
  the typed `SessionsSetAutonomyModeResult` directly through a
  `try/catch` that maps `HTTP /` exceptions back to throws and
  network/parse failures to `daemon_required`, the inline
  `sessions: { list, setAutonomyMode }` closure on the central
  handler builder (lines 728–735, 8 lines), the
  `DaemonControlClient.setSessionAutonomyMode()` direct method on
  the class (lines 1030–1050, 21 lines), plus the
  `SessionsSetAutonomyModeResult` import from `./kota-client.js`
  (sessions-namespace block in line 34) and the `InteractiveSession`
  import from `#core/daemon/daemon-control.js` (line 9).
- The wire code today issues GET `/sessions` (no body, returns
  `{ sessions: InteractiveSession[] }`) and PATCH `/sessions/{id}`
  (with the JSON body `{ autonomy_mode: mode }` — note the
  snake_case wire-shape key on the request body) through
  `fetchWithTimeout` directly. The PATCH wire code maps `404` →
  `{ ok: false, reason: "not_found" }`, transient transport
  failures (network, JSON parse) → `{ ok: false, reason:
  "daemon_required" }`, and other non-ok HTTP responses → throws
  (the namespace handler then surfaces those throws to the CLI).
  The success arm reshapes the daemon's snake_case
  `autonomy_mode` field back to camelCase `autonomyMode` and
  defaults `source` to `"daemon"` and `serveOwned` to `false`
  when the daemon response omits either.
- The daemon-ops module's local consumer (`index.ts`) currently
  imports `DaemonOpsClient` from `#core/server/kota-client.js` (line
  9). After the migration, the new `client.ts` declares the
  `SessionsClient` types alongside the (still-central)
  `DaemonOpsClient` import; the central `DaemonOpsClient` types stay
  in `kota-client.ts` and are migrated by a follow-on task. This
  task migrates only the `sessions` namespace's types — the
  `daemonOps` namespace owned by the same module is the next
  follow-up.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the prior pilots. The shape extends the pattern in two
new dimensions: (a) the first migration whose namespace contract
carries a `reason: "daemon_required"` arm that the daemon-side
factory **does** emit on transient transport failures (the local
handler also emits it, but here both paths can produce it — the
daemon-side path on JSON parse / network failure inside the typed
PATCH wrapper); validating that the typed `DaemonTransport` link
cleanly threads `try/catch` envelopes that produce the
`daemon_required` arm from the daemon-side path matches today's
`setSessionAutonomyModeHttp` behavior; (b) the first migration
whose wire response shape includes optional fields
(`source?: "daemon" | "serve"`, `serveOwned?: boolean`) the
daemon-side factory must default explicitly to satisfy the typed
result contract — `source` defaults to `"daemon"` and `serveOwned`
defaults to `false` when the daemon route omits either, matching
today's lines 217–218 behavior.

## Desired Outcome

`sessions` is the twenty-third namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `SessionsClient`, `SessionsListResult`, and
  `SessionsSetAutonomyModeResult` live in
  `src/modules/daemon-ops/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `SessionsClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/daemon-ops/index.ts` adds a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ sessions: SessionsClient }` whose two methods
  route through:
  - `list()` → calls `link.fetchRaw("/sessions", { method: "GET",
    headers: link.authHeaders() })` (or the typed
    `link.requestStrict<{ sessions: InteractiveSession[] }>("GET",
    "/sessions")` if the link wrapper provides matching error
    semantics), parses the JSON body, and returns `{ sessions:
    parsed.sessions }`. On transport failure (network error, parse
    failure, non-ok HTTP status), throws — the `sessions` namespace
    `list()` shape does not include a `daemon_required` arm so
    transport failure surfaces as a thrown error, matching today's
    `listSessionsHttp` ⇒ `null` ⇒ caller throws behavior at lines
    728–733.
  - `setAutonomyMode(id, mode)` → builds the JSON body
    `{ autonomy_mode: mode }` (snake_case on the wire, matching
    today's line 202), calls `link.fetchRaw(`/sessions/${
    encodeURIComponent(id)}`, { method: "PATCH", headers: {
    "Content-Type": "application/json", ...link.authHeaders() },
    body: JSON.stringify({ autonomy_mode: mode }) })`. On
    `res.status === 404`, returns `{ ok: false, reason: "not_found"
    }`. On `res.ok`, parses the JSON body and returns `{ ok: true,
    autonomyMode: parsed.autonomy_mode, source: parsed.source ??
    "daemon", serveOwned: parsed.serveOwned === true }` —
    matching today's lines 214–219 reshape, including the
    snake_case-to-camelCase translation on `autonomy_mode →
    autonomyMode`, the default-`"daemon"` source policy, and the
    explicit-strict-equality `serveOwned === true` test that
    coerces undefined / non-true responses into `false`. On other
    non-ok responses, throws (the daemon-up branch's `HTTP {status}`
    error path matches today's lines 205–208 behavior). On
    transient transport failure (network error, JSON parse failure
    inside the `try` block), returns `{ ok: false, reason:
    "daemon_required" }` — matching today's lines 220–223
    `try/catch` envelope that distinguishes `HTTP`-prefixed thrown
    errors from network-class failures.

  matching today's `listSessionsHttp` /
  `setSessionAutonomyModeHttp` URL paths, HTTP verbs, JSON-body
  contracts, and snake_case-vs-camelCase wire-shape transformations
  byte-for-byte. The control-route stem (`/sessions/*`) is preserved
  — do not migrate the route to `/api/sessions/*` (the `kota serve`
  API server registers `/api/sessions/*` as a parallel surface for
  browser clients, but `DaemonControlClient` calls the control-plane
  `/sessions/*` routes exclusively, and that contract must stay
  intact).
- `src/core/server/daemon-client.ts` no longer carries
  `listSessionsHttp`, `setSessionAutonomyModeHttp`, the inline
  `sessions: { list, setAutonomyMode }` closure on the core-side
  stub builder, the `DaemonControlClient.setSessionAutonomyMode()`
  direct method on the class, the `SessionsSetAutonomyModeResult`
  import from `./kota-client.js`, the `InteractiveSession` import
  from `#core/daemon/daemon-control.js` (if no other code in the
  file consumes it after the sessions removal — keep it iff
  `getDaemonStatusHttp` or another residual function still
  references the type), or any other sessions-namespace-specific
  helpers. Module-contributed handlers replace the namespace path
  the same way every prior migration did. The
  `setSessionAutonomyMode()` direct method is removed because the
  namespace path `client.sessions.setAutonomyMode()` is the only
  sanctioned operator-CLI surface — there are no remaining `src/`
  callers of the direct method (the matching-name mock fields at
  `src/modules/owner-questions/daemon-control.test.ts:78` and the
  rest of the `*/daemon-control.test.ts` files mock the
  `DaemonControlHandle` interface's `setSessionAutonomyMode` method,
  not the `DaemonControlClient` class method; the daemon-internal
  handle interface is a different surface — confirmed via grep
  showing zero call-sites of `client.setSessionAutonomyMode()`
  on the `DaemonControlClient` class instance).
- The `DaemonControlClient.registerSession()` and
  `DaemonControlClient.unregisterSession()` direct methods on the
  class **stay** — `src/core/server/server.ts:74` and
  `src/core/server/server-routes.ts:86,109` consume them directly
  from `kota serve` to register/unregister CLI-owned interactive
  sessions with the daemon. These methods are not part of the
  `sessions` namespace contract (they bridge serve ⇄ daemon, not
  CLI ⇄ daemon), and the orthogonal `task-decouple-non-namespace-
  daemon-transport-methods-fr` task already audited and left them
  in place. Do not displace them in this migration.
- `src/modules/daemon-ops/sessions-local.ts` imports `SessionsClient`
  from `./client.js` (the new module-local file) instead of from
  `#core/server/kota-client.js`. The `localClient` factory in
  `src/modules/daemon-ops/index.ts` continues to consume
  `sessionsLocalClient()` unchanged.
- A new daemon-side factory unit test alongside the module
  (`src/modules/daemon-ops/sessions-daemon-client.test.ts`)
  exercises the wire shape against a recording `DaemonTransport`,
  mirroring `src/modules/voice/daemon-client.test.ts`,
  `src/modules/history/daemon-client.test.ts`,
  `src/modules/knowledge/daemon-client.test.ts`,
  `src/modules/eval-harness/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `sessions`, (2) `list()` routes through `fetchRaw` with method
  `GET`, path `/sessions`, headers from `link.authHeaders()`, no
  body — and decodes the success arm correctly: a `200 + {
  sessions: [{ id: "s1", createdAt: "2026-05-05T00:00:00Z",
  agent: "...", autonomyMode: "supervised", ... }] }` response
  collapses to `{ sessions: [<the same entries>] }`, (3) `list()`
  throws on non-ok response (502 surfaces a thrown error including
  the daemon's body error message), (4) `setAutonomyMode(id, mode)`
  routes through `fetchRaw` with method `PATCH`, path
  `/sessions/<encodeURIComponent(id)>`, headers `{ "Content-Type":
  "application/json", ...link.authHeaders() }`, and body `{
  autonomy_mode: mode }` (snake_case key — pin this byte-for-byte
  to detect unintended camelCase regressions on the wire), (5)
  `setAutonomyMode` decodes the success arm correctly: a `200 + {
  autonomy_mode: "supervised", source: "daemon", serveOwned: false
  }` response collapses to `{ ok: true, autonomyMode: "supervised",
  source: "daemon", serveOwned: false }`, (6) `setAutonomyMode`
  defaults `source` to `"daemon"` and `serveOwned` to `false` when
  the daemon response omits either: a `200 + { autonomy_mode:
  "manual" }` response collapses to `{ ok: true, autonomyMode:
  "manual", source: "daemon", serveOwned: false }`, (7)
  `setAutonomyMode` decodes the not_found arm correctly: a `404 + {
  error: "session not found" }` response collapses to `{ ok: false,
  reason: "not_found" }`, (8) `setAutonomyMode` decodes the
  daemon_required arm correctly: a network failure (rejected
  fetch) inside the `try` block collapses to `{ ok: false, reason:
  "daemon_required" }` and a JSON parse failure on the success
  body inside the `try` block also collapses to the same arm
  (matching today's lines 220–223 behavior), (9) `setAutonomyMode`
  surfaces unrelated `HTTP`-prefixed errors as throws: a `502 + {
  error: "internal" }` response throws an error containing
  `"internal"` (matching today's lines 205–208 behavior), (10) the
  `serveOwned: true` response is honored: a `200 + { autonomy_mode:
  "supervised", source: "serve", serveOwned: true }` response
  collapses to `{ ok: true, autonomyMode: "supervised", source:
  "serve", serveOwned: true }`, (11) the assembly satisfies
  coverage with the sessions contribution, and (12) the assembly
  throws naming `"sessions"` when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-
  client.test.ts` extends with `"sessions"`, and
  `buildMigratedNamespaceTestStubs()` in `src/core/server/daemon-
  client-test-stubs.ts` extends with a stub `sessions` handler
  whose two methods return placeholder shapes (`list()` →
  `{ sessions: [] }`, `setAutonomyMode()` → `{ ok: false, reason:
  "daemon_required" }`) so tests that build a
  `DaemonControlClient` purely to exercise non-namespace daemon
  behavior continue to pass coverage.
- The daemon-ops module's `AGENTS.md` is updated to remove (or
  rewrite) any lines describing the central `listSessionsHttp` /
  `setSessionAutonomyModeHttp` wire functions or the
  `DaemonControlClient.setSessionAutonomyMode` direct method as the
  daemon-side surface. The replacement description points at
  `client.sessions.list()` / `client.sessions.setAutonomyMode()`
  as the namespace-path surface through the `daemonClient(link)`
  factory hook.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes.
  The `GET /sessions` and `PATCH /sessions/:id` routes keep their
  HTTP verbs, JSON-body contracts, and snake_case wire-shape keys
  (`autonomy_mode`) exactly as parsed in
  `src/core/daemon/daemon-control.ts` and
  `src/core/daemon/daemon-control-chat.ts` (`handlePatchDaemonSession`).
  The CLI-facing `kota daemon-ops session` subcommands and the
  module's `session-cli.ts` formatting are unrelated to this
  migration and must not be touched.
- The daemon-side handler uses `link.fetchRaw` through the typed
  `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The HTTP method
  and path stay byte-for-byte identical to today's wire code,
  including the `"Content-Type": "application/json"` header on
  the PATCH body and the `encodeURIComponent` escape on the
  session id path parameter.
- The control-plane stem (`/sessions/*`) is preserved. The
  `daemonClient` factory does not migrate the route to
  `/api/sessions/*` — the `kota serve` API server registers
  `/api/sessions/*` as a parallel surface for browser clients
  in `server-routes.ts` and that surface is independent of the
  daemon-control path; renaming the control-plane route would
  break the `DaemonControlClient` wire contract and is out of
  scope.
- The snake_case wire-shape key (`autonomy_mode`) is preserved
  exactly on the request body and on the response body. Do not
  rename to `autonomyMode` on the wire — the daemon route in
  `handlePatchDaemonSession` parses `body.autonomy_mode` and
  emits `body.autonomy_mode` on the response; the namespace
  contract's camelCase `autonomyMode` is the typed
  client-side shape, not the wire shape.
- The three-arm shape (`{ ok: true; ... } | { ok: false; reason:
  "not_found" } | { ok: false; reason: "daemon_required" }`) is
  preserved exactly in the client contract for
  `SessionsSetAutonomyModeResult`. The optional `source` and
  `serveOwned` fields stay required on the success arm with
  defaults (`source: "daemon"`, `serveOwned: false`) supplied by
  the daemon-side factory when the daemon response omits either,
  matching today's lines 217–218 default policy.
- The `daemon_required` arm policy is split between the local and
  daemon-side handlers — both **can** emit it. The local handler
  (`sessionsLocalClient`) emits it unconditionally because no
  daemon is reachable. The daemon-side factory emits it only on
  transient transport failures (network error, JSON parse failure
  inside the `try` block); a successful HTTP response with
  status 200/404 collapses into the `{ ok: true }` /
  `{ ok: false, reason: "not_found" }` arms instead. The
  daemon-side test pins the per-failure-class behavior explicitly
  so the contract distinction is observable.
- The `DaemonControlClient.registerSession()` and
  `DaemonControlClient.unregisterSession()` direct methods on the
  class **stay** as-is. They are not part of the `sessions`
  namespace contract — they bridge `kota serve` ⇄ daemon for
  CLI-owned interactive sessions, are consumed directly by
  `src/core/server/server.ts:74` and
  `src/core/server/server-routes.ts:86,109`, and the orthogonal
  `task-decouple-non-namespace-daemon-transport-methods-fr` task
  already audited and left them in place. Do not displace either
  in this migration.
- No legacy or compatibility surface. Delete `listSessionsHttp`,
  `setSessionAutonomyModeHttp`, the inline closure, the central
  type declarations, the `DaemonControlClient.setSessionAutonomyMode()`
  direct method, the `SessionsSetAutonomyModeResult` import from
  `./kota-client.js`, and the `InteractiveSession` import from
  `#core/daemon/daemon-control.js` (if no other code in the file
  consumes it after the sessions removal) at the migration's
  edges as it completes; do not leave shims. The in-module
  import shift in `sessions-local.ts` from
  `#core/server/kota-client.js` to `./client.js` is a hard
  cutover, not a parallel re-export.
- The `sessions.list()` shape does not include a
  `daemon_required` arm. Today's `listSessionsHttp` returns
  `null` on transport failure and the inline closure throws;
  the migration preserves that throw — the daemon-side factory
  must throw (not return `daemon_required`) when GET /sessions
  fails, matching today's behavior at lines 728–733.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `SessionsListResult` /
  `SessionsSetAutonomyModeResult` declarations in
  `src/core/server/`. Existing assertions for the doctor,
  harnessParity, audit, retract, answer, ownerQuestions,
  modules, modulesAdmin, agents, skills, mcpServer, web,
  capture, recall, webhook, approvals, secrets, memory,
  knowledge, history, evalHarness, and voice migrations stay
  green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no
  allowlist edit is needed for this migration.
- No protocol change for the operator-facing CLI. CLI behavior
  (`kota daemon-ops session list`, `kota daemon-ops session
  set-autonomy`), daemon-up vs daemon-down branching, and exit-code
  semantics all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  daemon-ops module's existing CLI rendering hooks are not part
  of this refactor.
- The mobile, web, and apple clients (`clients/mobile/*`,
  `clients/web/*`, `clients/apple/*`) are out of scope. They
  have their own `DaemonClient` implementations and reference
  the wire shape from documentation rather than importing the
  central class. The migration removes the
  `DaemonControlClient.setSessionAutonomyMode()` direct method
  because no `src/` code consumes it; this does not affect
  external clients.

## Done When

- `src/modules/daemon-ops/client.ts` exists and declares
  `SessionsClient`, `SessionsListResult`, and
  `SessionsSetAutonomyModeResult`. The `KotaClient` aggregate
  in `src/core/server/kota-client.ts` imports `SessionsClient`
  from this module.
- `src/modules/daemon-ops/index.ts` exposes
  `daemonClient(link)` parallel to `localClient(ctx)` and
  contributes `{ sessions: <handler> }`.
- `src/modules/daemon-ops/sessions-local.ts` imports
  `SessionsClient` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `sessions`-specific code: no `listSessionsHttp`,
  `setSessionAutonomyModeHttp`; no inline `sessions: { ... }`
  closure on the core-side stub builder; no
  `DaemonControlClient.setSessionAutonomyMode()` direct method;
  no `SessionsSetAutonomyModeResult` import; no
  `InteractiveSession` import (unless still consumed by another
  function in the file); and no other sessions-namespace-specific
  helpers.
- `src/modules/daemon-ops/sessions-daemon-client.test.ts` exists
  and pins the invariants enumerated in `## Desired Outcome`
  above (factory presence, wire-shape assertions covering the
  GET and PATCH routes with the snake_case `autonomy_mode`
  body and `encodeURIComponent`-escaped path parameter, per-arm
  `SessionsSetAutonomyModeResult` decoding for success / not_found
  / daemon_required / throw-on-non-`HTTP` arms,
  default-`"daemon"`-source / default-`false`-serveOwned
  behavior, `serveOwned: true` honoring, list-throws-on-transport-
  failure invariant, coverage success when the contribution is
  supplied, and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in
  `src/core/server/daemon-client.test.ts` extends to include
  `"sessions"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `sessions` handler whose two methods return the
  placeholder shapes in `## Desired Outcome` above.
- `src/modules/daemon-ops/AGENTS.md` is updated to remove (or
  rewrite) any lines describing
  `DaemonControlClient.setSessionAutonomyMode` /
  `listSessionsHttp` / `setSessionAutonomyModeHttp` as the
  daemon-side surface and replace them with the namespace-path
  description.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass
  and rejects deliberately re-introduced per-namespace
  `SessionsListResult` / `SessionsSetAutonomyModeResult`
  declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`sessions-daemon-up.txt` /
  `sessions-daemon-down.txt`) demonstrate parity for one
  read-shaped success path (`kota daemon-ops session list` —
  the daemon-up side enumerates registered + daemon-owned
  sessions; the daemon-down side surfaces the empty-list shape
  from `sessionsLocalClient`) and one mutation path (`kota
  daemon-ops session set-autonomy <id> supervised` exercising
  either the daemon-up `{ ok: true }` arm against a live
  registered session or the daemon-down `daemon_required` arm
  via the local handler) showing the pre/post output is
  identical across modes. If no daemon is reachable in the
  autonomous run environment, both transcripts exercise the
  `sessionsLocalClient`-driven empty-list and `daemon_required`
  paths honestly rather than fabricating session data.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T04-58-15-134Z-explorer-zycpyu/` as the
next orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s`
(owner-decision slot
`kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twenty-four orthogonal preludes have already landed (the
foundation / pilot / migration commits plus the voice
migration):

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace
  transport-method decoupling (the orthogonal prelude needed
  under all chunking answers).
- `203c76a6` — `daemonClient(link)` factory hook on
  `KotaModule`, `DaemonClientHandlers` assembly path on
  `DaemonControlClient`, and the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook.
- `927dca24` — harnessParity migration extending the pattern
  to a two-method namespace.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace.
- `8c212f0c` — retract migration extending the pattern to a
  JSON-body POST with discriminated request/result unions.
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern
  to two POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern
  to the first multi-namespace contribution from a single
  module's `daemonClient(link)` factory and the first
  cross-namespace dependency consumption.
- `7965beb6` — agents migration extending the pattern to the
  first pure read-only namespace shape (two GETs) and
  validating the single-status-code → 200 alignment
  precedent for `404 → { found: false }`.
- `f62bbb65` — skills migration extending the pattern to the
  first multi-status-code → 200 alignment for a typed
  mutation result (collapsing `502` and `400` not-ok arms
  into uniform `200`).
- `10877651` — mcpServer migration establishing the
  stub-only daemon-side handler precedent.
- `f79a2ee5` — web migration generalizing the stub-only
  precedent.
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union.
- `5ab2bd0b` — recall migration extending the pattern to a
  five-arm `RecallHit` discriminated union including a
  nested four-arm `result` union on the answer arm.
- `201d35ce` — webhook migration extending the pattern to
  the DELETE verb plus `encodeURIComponent`-escaped workflow
  id path parameters.
- `e0030ada` — approvals migration extending the pattern to
  a query-string status discriminator threaded through
  `requestStrict<T>`, a two-arm mutation discriminated union
  keyed off the daemon's `404 → not_found` mapping, and a
  daemon-route default that anchors the daemon-up factory's
  omit-when-undefined behavior.
- `5841c7f0` — secrets migration extending the pattern to
  the PUT verb with a JSON body, a non-`not_found` mutation
  failure arm (`store_error` with optional message), and a
  DELETE-with-query-string request shape threaded through
  `encodeURIComponent`.
- `5bcc9e24` — memory migration extending the pattern with
  the first daemon-wire-to-client-contract shape
  transformation (`excerpt → content`, `tags` dropped,
  `limit` slicing) and the first `semantic_unavailable`
  discriminated-union arm wired through `requestStrict<T>`.
- `d346a5c7` — knowledge migration extending the pattern
  with the first multi-key URLSearchParams filter (six
  optional keys) wired through `requestStrict<T>` with a
  `semantic_unavailable` arm, the first namespace carrying
  both a `{ found: true | false }` show-arm and a
  `{ ok: false; reason: "not_found" }` delete-arm threaded
  through `request<T>`, and the first contract surfacing a
  provider type (`KnowledgeEntry`) verbatim from
  `#core/modules/provider-types.js` without a wire-shape
  transformation.
- `a38978c8` — history migration extending the pattern with
  the first two-stem route contract (`/history*` for
  list/show/delete/reindex plus `/api/history/search` for
  semantic search) threaded through the same factory, the
  first migration whose mutation path exercised an HTTP
  `204` success status (collapsed into the
  knowledge/approvals/secrets `200 + { deleted: id }`
  precedent), and the first migration whose contract
  surfaces a provider type (`ConversationData`) verbatim
  through the daemon route on a single arm of a
  discriminated union (the show arm).
- `d3afe7e7` — evalHarness migration extending the pattern
  with the first long-running POST shape (eval runs
  exceed the 2s default timeout) threaded through
  `link.requestStrict<T>` with an explicit `timeoutMs`
  override, the first regex-based-error-message
  discrimination (`/no fixtures/i.test(msg)`) reshaped
  into a `200 + { ok: false; reason; message }` typed
  failure body matching the skills precedent, and the
  first `Record<string, unknown>` pass-through result
  shape.
- `24d0ebed` — voice migration extending the pattern with
  the first migration whose payload involves binary
  content (`audio: Uint8Array` on transcribe input,
  `audio: Buffer` on synthesize output) base64-encoded
  through JSON, the first migration whose contract carries
  a `reason: "daemon_required"` arm at the namespace shape
  that only the local handler emits, and the first
  migration whose contract uses a `transport_error` arm
  with optional `code` field propagated verbatim from the
  daemon's JSON `code` field.

`sessions` is the next-cleanest multi-method namespace with
two short HTTP wire calls (GET / PATCH) covering its complete
daemon contract — the natural next pilot in the cluster that
began with the doctor, harnessParity, ownerQuestions, agents,
capture, approvals, memory, knowledge, history, evalHarness,
and voice migrations. It extends the pattern in two axes the
prior pilots did not exercise: (a) the first migration whose
namespace contract carries a `reason: "daemon_required"` arm
that the daemon-side factory **does** emit on transient
transport failures (network error, JSON parse failure inside
the `try` block) — the voice migration's `daemon_required`
arm was only ever emitted by the local handler, so this
sessions migration is the first pilot validating that the
typed `DaemonTransport` link cleanly threads `try/catch`
envelopes that produce the `daemon_required` arm from the
daemon-side path matching today's
`setSessionAutonomyModeHttp` behavior at lines 220–223; and
(b) the first migration whose wire response shape includes
optional fields (`source?: "daemon" | "serve"`, `serveOwned?:
boolean`) that the daemon-side factory must default
explicitly to satisfy the typed result contract — `source`
defaults to `"daemon"` and `serveOwned` defaults to `false`
when the daemon route omits either, matching today's lines
217–218 default policy. This migration also removes the
`DaemonControlClient.setSessionAutonomyMode()` direct method
on the class — the orthogonal prelude task `task-decouple-
non-namespace-daemon-transport-methods-fr` left it in place
because no `src/` consumers existed; the namespace migration
displaces it now, shrinking the parent task by both the
namespace footprint and the residual class-method footprint.
The `registerSession()` and `unregisterSession()` direct
methods on the class remain as-is — they bridge `kota serve`
⇄ daemon for CLI-owned interactive sessions and are consumed
directly by `src/core/server/server.ts:74` and
`src/core/server/server-routes.ts:86,109`. It is needed
under every chunking answer the owner can pick on the
parent task (a/b/c/d/unblock): the sessions namespace
migrates exactly once regardless of whether the parent
lands in one cohesive run or fans out across follow-ups,
so this task does not commit the owner to any specific
chunking answer; it shrinks the parent task's scope by one
full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every
operator-facing capability — including its KotaClient
contract — lives in the owning module, with `src/core/`
reduced to genuine cross-cutting protocols and runtime
primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory
  on `daemonModule`, the in-module import shift in
  `sessions-local.ts`, the removed `listSessionsHttp` /
  `setSessionAutonomyModeHttp` / inline closure /
  `DaemonControlClient.setSessionAutonomyMode` / imports
  from `src/core/server/daemon-client.ts`, the AGENTS.md
  edit in `src/modules/daemon-ops/`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts`
  and `src/core/server/daemon-client.ts` before and after,
  showing the expected ~35-line and ~75-line shrinkage
  respectively.
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`sessions-daemon-up.txt` /
  `sessions-daemon-down.txt`) exercising the daemon-down
  empty-list and `daemon_required` arms with identical CLI
  output across modes (the autonomous run environment is
  expected to lack a running daemon, so both daemon-up and
  daemon-down transcripts will exercise the local-handler
  paths honestly rather than fabricating live session
  data).
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the
  current tree and fails on a deliberately re-introduced
  `SessionsListResult` / `SessionsSetAutonomyModeResult`
  declaration in `src/core/server/`.
