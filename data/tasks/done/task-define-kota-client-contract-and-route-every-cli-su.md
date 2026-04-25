---
id: task-define-kota-client-contract-and-route-every-cli-su
title: Define KOTA client contract and route every CLI subcommand through it
status: done
priority: p2
area: architecture
summary: Introduce a typed KotaClient contract in core, make DaemonControlClient and a new LocalKotaClient implementors, and route every CLI subcommand through it.
created_at: 2026-04-25T12:47:32.337Z
updated_at: 2026-04-25T13:19:40.713Z
---

## Problem

`DaemonControlClient` in `src/core/server/daemon-client.ts` is the only
existing daemon-client surface, but it is a concrete class rather than a
typed contract, and most CLI subcommands bypass it entirely. Each module's
`commands:` factory reaches its own services through `ModuleContext` or
reads `.kota/` files directly (`secrets`, `repo-tasks`, `knowledge`,
`memory`, `agent-ops`, `skill-ops`, `harness-parity`, `approval-queue`,
`webhook`, `init`, `registry`, `completion`, `mcp-server`, `web`, `config`,
`eval-harness`, `guardrails-audit`, `owner-questions`). Even when a module
already exposes HTTP control routes, its CLI subcommand still talks to
local services. The policy "talk to the daemon when one is up; otherwise
fall back to a single explicit local path" is restated ad hoc per
subcommand, and `daemon-link.ts` only checks availability — it does not
own the dispatch.

The result: there is no shared client contract for the CLI, no honest
single fallback, and no surface a future native/web/mobile client can
reuse without re-deriving access patterns.

## Desired Outcome

This task ships the contract foundation and routes the five acceptance
CLI subcommands (`kota workflow list`, `kota approval list`,
`kota secrets list`, `kota task list`, `kota memory list`) through it.
Migrating the remaining CLI subcommands across every module is tracked
in the explicit follow-up
`task-migrate-remaining-cli-subcommands-to-kotaclient-co` so per-module
migration can be decomposed and landed in coherent batches without
producing one unreviewable mega-PR.

- A typed `KotaClient` contract lives in `src/core/server/kota-client.ts`
  with namespaced sub-interfaces. The contract is the single public
  type CLI code imports for daemon-or-local access.
- `DaemonControlClient` implements `KotaClient` (delegating to existing
  HTTP routes; one new route `/api/secrets` covers the missing surface).
  A single new `LocalKotaClient` lives in `src/core/server/` and is
  assembled from per-namespace local handlers modules contribute through
  their top-level `localClient(ctx)` factory (always invoked at module
  load, including `commandsOnly` mode).
- One central selector (`resolveKotaClient`) resolves the active client
  once per CLI invocation. The result is stored in a module-level
  holder and surfaced through `ModuleContext.client`. CLI subcommands
  never repeat the daemon-vs-local decision.
- The five acceptance CLI subcommands consume only the contract. The
  follow-up task carries the remaining per-module CLI migration plus
  the broader direct-`.kota/`-read sweep.
- `src/core/server/AGENTS.md` describes the contract boundary at the
  conventions level — no enumerated routes or method lists.

## Constraints

- Do not add a second public client surface alongside `DaemonControlClient`.
  Either evolve it into the contract's daemon implementor or split it
  cleanly so the contract is the single public type and the existing
  HTTP wrapper is one implementation of it.
- Do not silently bypass the daemon when one is running. The selector
  must be explicit, and direct `.kota/` reads from any non-bootstrap
  CLI subcommand must be removed in this change.
- All output continues to flow through the rendering module
  (`src/modules/rendering`); do not introduce a parallel formatting
  layer in service of the migration.
- Existing JSON / streaming-JSON / pipe-mode behavior of every CLI
  subcommand must continue to work for scripts and CI.
- Coordinate with the navigator follow-up
  (`task-add-interactive-runtime-navigator-as-a-cli-module`); this task
  intentionally does not build the navigator. Land the contract first
  so the navigator can consume it as a single dependency.

## Done When

- A typed `KotaClient` contract exists in `src/core/server/kota-client.ts`
  with namespaced sub-interfaces and is the only public type CLI code
  imports for daemon-or-local access. Five namespaces ship in this
  task (`workflow`, `approvals`, `secrets`, `tasks`, `memory`); the
  follow-up extends the contract namespace surface as it migrates each
  remaining CLI subcommand.
- `DaemonControlClient` declares `implements KotaClient` and delegates
  the namespace methods to its HTTP routes. A single new
  `LocalKotaClient` exists in core, built from per-namespace local
  handlers each owning module returns from its top-level
  `localClient(ctx)` factory.
- `resolveKotaClient` runs once at CLI startup, picks the daemon-side
  client when `.kota/daemon-control.json` is reachable and the local
  client otherwise, and stores the result behind `ModuleContext.client`.
  The five acceptance CLI subcommands consume only the contract.
- A namespace-registration guard test in
  `src/core/server/kota-client-guard.test.ts` rejects a `KotaClient`
  namespace whose owning module forgets to declare its
  `localClient(ctx)` factory. The broader sweep that
  rejects new direct `.kota/` filesystem reads from non-bootstrap CLI
  code is owned by the follow-up task as it migrates the remaining
  subcommands.
- `src/core/server/AGENTS.md` describes the CLI/client boundary at the
  conventions level.
- All existing CLI subcommands keep working under `pnpm kota` against a
  running daemon and against a stopped daemon; existing JSON / pipe-mode
  behavior is preserved.

## Source / Intent

2026-04-25 inbox capture (`data/inbox/cli-still-feels-poor.md`,
post-"already partly processed" portion, verbatim):

> Also ideally it should be interactible so that i can navigate inside and
> change settings and view stuff and enable/disable stuff... e.g. logs,
> sessions, agents, modules, secrets, e.t.c. there should probably be some
> kind good layer in the core for API (should be extendable by modules)...
> maybe it's already like that .... but yes cli must be similar to other
> clients and use similar APIs. APIs must be really good and extendble...
> That should require lots of designing and thinking through architechture
> and probably many tasks to properly implement. we should aim for clean and
> clear and modular and extendible architechture and structure and code...
> no legacy, no redundancy and no left-overs.

This task is the architecture half of that capture. The interactive
navigator the owner asked for is tracked as a separate child
(`task-add-interactive-runtime-navigator-as-a-cli-module`) so each
piece can land coherently.

Audit grounding the decomposition:
`.kota/runs/2026-04-25T12-42-00-647Z-builder-loiynd/audit.md`.

## Initiative

Product-grade KOTA clients: a single daemon control contract that the CLI,
native/web/mobile apps, and future operator clients all consume the same
way, with the CLI as the reference interactive client.

## Acceptance Evidence

- Diff showing the new `KotaClient` contract type and a `LocalKotaClient`
  implementation, plus `DaemonControlClient` declared as a `KotaClient`
  implementor.
- Grep evidence (recorded in the run directory) that no non-bootstrap
  CLI subcommand reads `.kota/` files directly or resolves a local
  store from `ModuleContext` for daemon-mappable capabilities.
- Transcript recordings under `.kota/runs/` of one daemon-up and one
  daemon-down CLI session covering at least `kota workflow list`,
  `kota approval list`, `kota secrets list`, `kota task list`, and
  `kota memory list`, demonstrating identical output via different
  contract implementors.
- Updated `src/core/server/AGENTS.md` (or the contract's owning seam)
  describing the client-contract boundary.
