---
id: task-fix-daemon-startup-to-fully-load-runtime-module-pr
title: Fix daemon startup to fully load runtime module providers
status: done
priority: p0
area: architecture
summary: The daemon command currently passes module HTTP routes from a commandsOnly loader into the runtime, so routes exist while provider onLoad initialization is skipped. Rework daemon startup so runtime routes, provider-backed seams, workflows, channels, and health checks come from a fully loaded module context, with tests covering the actual CLI daemon path.
created_at: 2026-04-28T22:35:06.195Z
updated_at: 2026-04-29T00:41:34.732Z
---

## Problem

The shipped daemon command currently starts from the CLI module loader in
`commandsOnly` mode:

- `src/cli.ts` creates `new ModuleLoader(config, false, { commandsOnly: true })`.
- `src/core/modules/module-loader.ts` intentionally skips `mod.onLoad` in
  `commandsOnly` mode.
- `src/modules/daemon-ops/index.ts` then constructs `new Daemon(...)` with
  `ctx.getRoutes()`, `ctx.getContributedControlRoutes()`, workflows, channels,
  and health checks from that partial context.

That produces a bad runtime state: daemon HTTP routes exist, but provider-backed
module initialization did not run. A live daemon can therefore answer `/status`
while routes such as knowledge, memory, history, recall, and answer fail with
"provider not initialized" errors.

The same trap is already documented in `src/modules/mcp-server/mcp-server-operations.ts`:
MCP re-loads modules in non-`commandsOnly` mode because runtime dispatch needs
fully registered contributions. Daemon startup needs the same class of boundary.

## Desired Outcome

Starting KOTA through the real operator path (`pnpm build && node dist/cli.js daemon`)
must produce a daemon whose runtime contributions come from fully loaded modules:

- provider `onLoad` hooks have run before provider-backed routes are exposed;
- module HTTP routes, control routes, workflows, channels, health checks, agents,
  skills, and config-key summaries are internally consistent;
- CLI command registration can still use a lightweight path without loading
  unrelated runtime side effects;
- the runtime cannot silently combine partial CLI registration state with daemon
  runtime state again.

## Constraints

- Preserve the fast `commandsOnly` CLI startup behavior for ordinary subcommands.
- Do not duplicate module discovery logic in an ad hoc daemon-only fork; factor a
  clear helper if both MCP and daemon need full runtime loading.
- Do not make optional providers mandatory. Routes may still report
  semantic/provider unavailable when configuration genuinely lacks a provider,
  but they must not fail because daemon startup skipped module lifecycle hooks.
- Keep launchd/supervisor behavior intact; fix both foreground child daemon mode
  and service-launched daemon mode.
- Work with the broader module-lifecycle direction in
  `data/tasks/ready/task-codify-module-lifecycle-modes-so-runtime-cannot-co.md`
  instead of deepening the `ModuleContext` service-locator problem.

## Done When

- `src/modules/daemon-ops/index.ts` no longer constructs the daemon from a
  `commandsOnly` context for runtime contributions.
- A fully loaded runtime context is used for daemon routes/controlRoutes,
  workflows, channels, health checks, agents, skills, provider-backed seams, and
  config-key summaries.
- Existing CLI subcommands still register from the lightweight path and do not
  unexpectedly run full runtime side effects before ordinary commands.
- A regression test proves a provider-backed daemon route cannot be exposed from
  a context whose `onLoad` did not run.
- Existing daemon, module-loader, MCP-server, and CLI-command tests remain green.

## Source / Intent

2026-04-28 owner-visible regression: the macOS menu bar initially appeared
offline because it pointed at the wrong project, then connected to the correct
daemon but showed repeated provider errors. Manual probing showed the daemon was
running and authenticated routes existed, but provider-backed endpoints failed:

- `GET /api/knowledge/search?...` -> provider not registered / initialized.
- `GET /api/memory/search?...` -> provider not registered / initialized.
- `GET /api/history/search?...` -> provider not registered / initialized.
- `POST /recall` -> recall provider not initialized.
- `POST /answer` -> answer provider not initialized.

Root cause from code inspection: daemon runtime consumed module routes from the
CLI `commandsOnly` loader. Commit `68619f33` ("Serve module HTTP routes through
the daemon control server") added `routes: ctx.getRoutes()` to the daemon
constructor path, but the integration test built `new Daemon(...)` directly and
did not cover the actual CLI startup path.

## Initiative

Daemon/module runtime correctness: thin clients should be able to trust that a
reachable daemon has loaded the runtime capabilities it advertises.

## Acceptance Evidence

- A test transcript showing the daemon startup path no longer exposes
  provider-backed routes from a `commandsOnly` context.
- A local smoke transcript or fixture hitting at least one provider-backed route
  through the actual daemon command path after build.
- Notes in the task/run artifact identifying the old failure mode and the new
  guard that prevents it from recurring.
