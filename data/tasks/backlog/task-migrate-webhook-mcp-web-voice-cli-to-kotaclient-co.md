---
id: task-migrate-webhook-mcp-web-voice-cli-to-kotaclient-co
title: Migrate webhook, mcp-server, web, and voice CLIs to KotaClient
status: backlog
priority: p2
area: architecture
summary: Migrate the webhook, mcp-server, web, and voice CLI subcommands to ctx.client.<namespace>.<method> so external interaction surfaces all consume the KotaClient contract.
created_at: 2026-04-25T20:31:21.442Z
updated_at: 2026-04-25T20:31:21.442Z
---

## Problem

The `webhook`, `mcp-server`, `web`, and `voice` modules each expose
CLI subcommands that today resolve their data through services on
`ModuleContext` or direct `.kota/` reads inside the action
handlers. They have not been migrated to the `KotaClient` contract.
These four modules cluster as the "external interaction surfaces"
— each owns one or more transports KOTA exposes to the outside
world, and each has a small CLI footprint operators use to
inspect and reconfigure those transports.

## Desired Outcome

- Every `kota webhook`, `kota mcp-server`, `kota web`, and
  `kota voice` subcommand routes through
  `ctx.client.{webhook,mcpServer,web,voice}.<method>()`. No service
  resolution from `ModuleContext` or direct `.kota/` reads in the
  action handlers.
- `KotaClient` declares typed `WebhookClient`, `McpServerClient`,
  `WebClient`, and `VoiceClient` namespaces with discriminated
  result shapes per operation.
- `DaemonControlClient` and the per-module `localClient(ctx)`
  factories implement the namespaces. Subcommands that genuinely
  require the daemon (e.g. transport status that depends on a live
  server) surface `{ ok: false, reason: "daemon_required" }` from
  the local handler; the CLI maps that uniformly.
- Daemon adds matching HTTP routes for each namespace under bearer
  auth; existing routes are extended where they already exist.
- Focused tests cover the daemon-down branches per namespace.

## Constraints

- Do not introduce a second public client surface; everything routes
  through `KotaClient`.
- Output continues to flow through `src/modules/rendering`.
- Existing JSON / pipe-mode behavior for every migrated subcommand
  is preserved.
- Each module's mutation logic lives in a shared helper (mirroring
  `src/modules/repo-tasks/repo-tasks-operations.ts`) so daemon
  route handlers and local-client handlers cannot diverge.

## Done When

- All four modules' CLI subcommands route every read and mutation
  through `ctx.client.<namespace>.<method>()`.
- `KOTA_CLIENT_NAMESPACES` enumerates `webhook`, `mcpServer`, `web`,
  and `voice`; the namespace-registration guard test covers them.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green; the new
  unit tests run as part of the suite.
- Daemon-up and daemon-down CLI transcripts demonstrate parity for
  each migrated subcommand.

## Source / Intent

Decomposed from
`task-migrate-remaining-cli-subcommands-to-kotaclient-co` (see
that task's "Source / Intent" for the original 2026-04-25 owner
capture from `data/inbox/cli-still-feels-poor.md`). These four
modules cluster as the "external interaction surfaces" and ship
together so the contract grows by a coherent slice.

## Initiative

Product-grade KOTA clients: a single daemon control contract that
the CLI, native/web/mobile apps, and future operator clients all
consume the same way, with the CLI as the reference interactive
client.

## Acceptance Evidence

- Diff covering namespace additions to `kota-client.ts`, daemon-
  client property impls, route additions in each owning module, and
  `registerLocalClient(...)` calls.
- Updated namespace-registration guard test enumerating the four
  new namespaces.
- Daemon-up and daemon-down CLI transcripts under the run directory
  demonstrating parity for each migrated subcommand.
- Grep evidence in the run directory that no `kota webhook`,
  `kota mcp-server`, `kota web`, or `kota voice` action handler
  resolves services from `ModuleContext` or reads `.kota/` directly.
