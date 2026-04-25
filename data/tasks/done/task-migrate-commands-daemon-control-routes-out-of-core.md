---
id: task-migrate-commands-daemon-control-routes-out-of-core
title: Migrate /commands daemon-control routes out of core into the commands module
status: done
priority: p2
area: architecture
summary: Move the GET /commands and POST /commands/invoke daemon-control routes from src/core/daemon/daemon-control-commands.ts into the existing commands module via KotaModule.controlRoutes, mirroring the push-tokens/owner-questions/approvals/history migration pattern, expose enqueuePendingRun to modules through a small workflow-dispatcher provider so the migrated handler can trigger workflows without round-tripping back through HTTP, delete the core handler file, and add an import-guard test refusing reintroduction.
created_at: 2026-04-25T07:39:09.805Z
updated_at: 2026-04-25T07:51:33.050Z
---

## Problem

`src/core/daemon/daemon-control.ts` still hard-codes `GET /commands` and
`POST /commands/invoke` in `BUILTIN_ROUTE_SCOPES` and dispatches them
through `src/core/daemon/daemon-control-commands.ts`. The slash-command
catalog itself already lives in the `commands` module
(`src/modules/commands/`): the module's `onLoad` builds a
`SlashCommandCatalog` and registers it under the
`SLASH_COMMAND_PROVIDER_TYPE` provider type, and the module already
contributes its own web-server routes (`GET /api/commands`,
`POST /api/commands/invoke`) through `commandRoutes` against the same
catalog. The only reason the daemon-control endpoints stay in core is
that the invoke handler calls `handle.enqueuePendingRun(action.workflow)`
on `DaemonControlHandle`, and `ControlRouteRegistration` handlers do not
receive the daemon handle directly — module-contributed routes only see
`(req, res, params)`.

Every other recently-migrated daemon-control surface — push-tokens
(`task-migrate-push-tokens-daemon-control-route-out-of-co`,
`47914cf7`), owner-questions
(`task-migrate-owner-questions-daemon-control-routes-out-`,
`1d2728ea`), approvals
(`task-migrate-approvals-daemon-control-routes-out-of-cor`,
`6011d701`), history
(`task-move-daemon-control-history-route-handlers-out-of-`,
`d8655ed0`) — works because its module talks to a core-exposed singleton
(`getApprovalQueue()`, `getOwnerQuestionQueue()`, history-store
accessors). Commands has no equivalent for the
`enqueuePendingRun` operation. `daemon-control-workflow.ts` also calls
`handle.enqueuePendingRun(...)` for `POST /workflow/trigger`, but that
route stays in core because workflow-trigger is a daemon-control
primitive. The commands case needs a small core seam exposing the
dispatch capability to modules so the routes can move without core
gaining a hidden command-specific dependency.

The previous migration's done-task body explicitly named `commands` as
the next-clearest module-owned candidate among the remaining
`daemon-control-*` handlers (commands, metrics, sessions, webhook,
workflow), splitting them into module-owned candidates and
genuinely-core ones tied to runtime primitives.
`src/core/daemon/AGENTS.md` already updates the "Internal Subdomains"
list each migration to remove the moved handler; commands is the next
entry to drop from that enumeration.

## Desired Outcome

The `commands` module owns the daemon-control endpoints alongside its
existing web-server routes. Concretely:

- `src/core/daemon/daemon-control-commands.ts` is deleted.
- `src/core/daemon/daemon-control.ts` no longer imports
  `handleListCommands` / `handleInvokeCommand`, no longer carries
  `"GET /commands"` or `"POST /commands/invoke"` entries in
  `BUILTIN_ROUTE_SCOPES`, and no longer dispatches either path in its
  `handleRequest` switch.
- The `commands` module gains a `controlRoutes()` contribution that
  registers `GET /commands` (`capabilityScope: "read"`) and
  `POST /commands/invoke` (`capabilityScope: "control"`). Both handlers
  query the same `SlashCommandCatalog` the module already builds in
  `onLoad`, and reuse the existing `catalog.list()` / `catalog.resolve()`
  surface — the wire contract for both endpoints is preserved verbatim
  (catalog list shape, JSON body validation, 400 on invalid JSON, 400 on
  missing/empty `name`, 404 on unknown command, 409 on already-queued
  workflow, 200 with `{ kind: "skill", prompt }` for skill resolution,
  200 with `{ kind: "workflow", queued, runId }` for workflow
  resolution).
- A small core-exposed seam lets the `commands` module trigger
  workflow runs without holding a `DaemonControlHandle`. Implementation
  shape is the builder's choice but must satisfy these properties: the
  daemon registers the dispatcher once at startup; the commands
  controlRoute handler retrieves it through an existing module-visible
  surface (provider registry, module context, or a dedicated singleton
  accessor that mirrors `getApprovalQueue()` / `getOwnerQuestionQueue()`);
  the dispatcher exposes only what the commands handler needs (a
  `enqueuePendingRun(name): { ok, queued?, runId?, alreadyQueued?,
  error? }` result identical to the existing `DaemonControlHandle`
  return shape); no module is granted broader access to the daemon
  handle than it needs. The same seam should be reusable for any future
  module-owned route that needs to trigger workflows; do not name it
  `commands`-specific.
- A co-located `DaemonControlServer`-based test exercises both
  endpoints end-to-end through the registered controlRoutes (mirror
  `src/modules/owner-questions/daemon-control.test.ts` and the
  push-notification tests), covering: the `read` capability-scope check
  on `GET /commands`, the catalog-listing response, the `control`
  capability-scope check on `POST /commands/invoke`, the invalid-JSON
  400, the missing-`name` 400, the unknown-command 404, the
  already-queued 409, the skill 200 path, and the workflow 200 path with
  the dispatcher seam returning a `runId`.
- An import-guard test refuses any future reintroduction of
  `daemon-control-commands*.ts` under `src/core/daemon/`, modeled on
  `no-daemon-control-push-tokens.test.ts` and
  `no-daemon-control-owner-questions.test.ts`.
- `src/core/daemon/AGENTS.md` removes `daemon-control-commands.ts` from
  the "Internal Subdomains" list and adds `/commands*` to the
  parenthetical of module-owned daemon-control endpoints.
  `src/modules/commands/AGENTS.md` describes the new
  daemon-control surface alongside the existing web-route surface and
  notes the dispatcher seam it depends on.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam. Do not introduce a
  parallel registration path, a shadow router, or a second daemon
  control protocol.
- Preserve the wire contract on both endpoints exactly: route paths
  (`GET /commands`, `POST /commands/invoke`), capability scopes (`read`,
  `control`), bearer-token gating, status codes (200 / 400 / 404 / 409 /
  503), and response shapes (`{ commands: [...] }`,
  `{ kind: "skill", prompt }`, `{ kind: "workflow", queued, runId }`,
  `{ error }` bodies). Existing `DaemonControlClient` and CLI consumers
  must continue to work unmodified.
- Catalog availability: when the slash-command catalog is not yet
  registered (e.g. early daemon startup, module load failure), keep the
  current 503 `"Slash-command catalog unavailable"` behavior. When the
  workflow dispatcher seam is unavailable, return 503 with a similarly
  scoped error rather than silently falling back to a different shape.
- Do not weaken the repo-wide
  `src/core/agent-harness/no-module-imports-in-core.test.ts` guard. Add
  a dedicated `no-daemon-control-commands.test.ts` import-guard mirroring
  the existing precedents and refusing any future
  `daemon-control-commands*.ts` under `src/core/daemon/`.
- The dispatcher seam must be a primitive, not a commands-specific
  hook: any future module that contributes a controlRoute needing to
  trigger a workflow should reuse it. Pick a name that reflects that
  generality (`workflow-dispatcher`, `pending-run-dispatcher`, etc.).
  Do not place the seam under `#core/daemon/` if a more accurate
  location exists (e.g. `#core/workflow/` or `#core/modules/`); the
  daemon registers the dispatcher with the seam at startup, but the
  seam type itself is a workflow-runtime contract.
- The daemon-handle's `enqueuePendingRun` method stays where it is; the
  workflow-trigger control route, the daemon chat session pool, and any
  other in-core caller still use `handle.enqueuePendingRun(...)`
  directly. The new seam is for module-contributed controlRoutes only.
- Keep the route-key collision check in `DaemonControlServer` intact:
  the new module contribution must not collide with built-ins or with
  another module's contribution. The existing collision test in
  `daemon-control.test.ts` should continue to pass; add a focused
  collision test in the commands module if its co-located test does not
  already exercise that path.
- Module-load order: the daemon must register the workflow dispatcher
  before any module's `controlRoutes()` is invoked, so the commands
  controlRoute handler can find it during request dispatch (not during
  module load). If `controlRoutes()` is invoked during `onLoad`,
  capture the catalog reference but defer the dispatcher lookup to the
  per-request path.
- Update both `AGENTS.md` files (`src/core/daemon/AGENTS.md` and
  `src/modules/commands/AGENTS.md`) so each describes the new seam
  truthfully. Remove the `daemon-control-commands.ts` reference from
  the daemon `AGENTS.md` "Internal Subdomains" enumeration and extend
  the module-owned-endpoints parenthetical to include `/commands*`.
- Decide deliberately whether the new dispatcher provider lives under
  `#core/modules/` (alongside `slash-command-provider`) or
  `#core/workflow/` (closer to the runtime). Match the existing
  provider-registry pattern if you go that route; either way, expose a
  typed contract — do not pass the raw `DaemonControlHandle` through
  the provider.
- Do not introduce backward-compat shims, fallback dispatch paths, or
  legacy aliases. Delete the core file and the route-table entries;
  KOTA's policy is no legacy / no fallbacks (root `AGENTS.md`).

## Done When

- `src/core/daemon/daemon-control-commands.ts` is deleted.
- `src/core/daemon/daemon-control.ts` no longer references
  `handleListCommands`, `handleInvokeCommand`, `"GET /commands"`, or
  `"POST /commands/invoke"` in its imports, route-scope table, or
  dispatch switch.
- `src/modules/commands/index.ts` declares a `controlRoutes()`
  contribution registering both endpoints with the correct capability
  scopes, against the same `SlashCommandCatalog` the module already
  shares with its web routes.
- A new typed workflow-dispatcher seam exists (provider type or
  equivalent), the daemon registers it at startup, and the commands
  controlRoute handler retrieves it per-request to call
  `enqueuePendingRun(workflow)`.
- A co-located `DaemonControlServer`-based test in the commands module
  covers the listed contract paths (capability scopes, JSON-body
  validation, missing `name`, unknown command, already-queued, skill
  200, workflow 200) end-to-end through the registered controlRoutes.
- A new `src/core/daemon/no-daemon-control-commands.test.ts`
  import-guard refuses any future
  `daemon-control-commands*.ts` under `src/core/daemon/`.
- The repo-wide `no-module-imports-in-core` guard still passes
  unmodified.
- `pnpm test` passes on the resulting branch with the new module-side
  tests included.
- `src/core/daemon/AGENTS.md` and
  `src/modules/commands/AGENTS.md` describe the migration's outcome
  accurately; no stale references to
  `src/core/daemon/daemon-control-commands.ts` remain anywhere in the
  repo.

## Source / Intent

The just-landed push-tokens migration
(`task-migrate-push-tokens-daemon-control-route-out-of-co`, commit
`47914cf7`) closed the previous-clearest module-owned candidate and
explicitly named `commands` as the next one in its `## Initiative`
section: *"After this task lands, the remaining `daemon-control-*`
handlers in core (commands, metrics, sessions, webhook, workflow)
split into module-owned candidates (`commands` for `/commands*`,
possibly a future `metrics` module for `/metrics`) and
genuinely-core ones (`sessions*`, `webhook`, `workflow*`)."*
Owner direction throughout the architecture initiative has been
"minimal core, module-first": voice (`aa59e6f8`), Claude-SDK executor
(`f3a1b444`), architect mode (`85bb9176`), the `HistoryProvider`
inversion (`8f12be9e`), and four daemon-control migrations in the last
ten commits all moved capability out of `src/core/`. The commands
module is unique in this sequence because it already exists as a real
module — not a directory that needed to be created — and already owns
its catalog through the provider registry; only the daemon-control
endpoints lag behind. Closing that gap also pays down a second piece of
debt: the dispatcher seam introduced here is the reusable primitive
that any future module-owned controlRoute needing to trigger a
workflow will need (e.g. a future operator-facing module exposing
domain-specific shortcuts as workflow triggers).

## Initiative

Minimal-core, module-first architecture: every module-owned capability
should also own its operator-facing surfaces, including HTTP control
routes. Each migration like this one shrinks the core boundary and
makes the seam discoverable as the recommended pattern for future
module contributions. After this task lands, the remaining
`daemon-control-*` handlers in core split cleanly into genuinely-core
ones (`sessions*`, `webhook`, `workflow*`, the metrics aggregation that
spans daemon-wide state) and a single remaining module-owned candidate
(a future `metrics`/`daemon-ops` module for `/metrics` if owner
direction confirms it). The reusable workflow-dispatcher seam
introduced here also enables future module-owned shortcuts that
trigger workflows without re-deriving the daemon-handle dependency.

## Acceptance Evidence

- Diff showing `src/core/daemon/daemon-control-commands.ts` deleted,
  `daemon-control.ts` cleaned of `/commands` route-scope and dispatch
  entries, the new workflow-dispatcher seam typed and registered at
  daemon startup, the commands module's `controlRoutes()` contribution
  with both endpoints, and the new import-guard test.
- Co-located commands-module `DaemonControlServer` test output (or the
  filtered `pnpm test` subset) showing the listed contract cases green:
  capability-scope check on `GET /commands`, capability-scope check on
  `POST /commands/invoke`, 400 invalid JSON, 400 missing `name`, 404
  unknown command, 409 already-queued, 200 skill path, 200 workflow
  path with `runId`.
- `pnpm test` output (or filtered subset) showing the new
  import-guard test green and the existing
  `no-module-imports-in-core` guard still green.
- A short transcript or `curl` demo (saved under the run directory)
  hitting both daemon-control endpoints through the registered
  controlRoutes against a running daemon — confirms the wire contract
  is preserved end-to-end, not only in unit tests.
- Updated `src/core/daemon/AGENTS.md` (with `daemon-control-commands.ts`
  removed and `/commands*` added to the module-owned parenthetical) and
  `src/modules/commands/AGENTS.md` (describing the new daemon-control
  surface and the dispatcher seam it depends on).
