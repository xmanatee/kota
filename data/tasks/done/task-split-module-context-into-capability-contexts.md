---
id: task-split-module-context-into-capability-contexts
title: Split ModuleContext into capability contexts
status: done
priority: p1
area: architecture
summary: Replace the broad ModuleContext service-locator surface with smaller capability-scoped contexts so modules only receive the protocol powers they need.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-05-02T18:11:13.372Z
---

## Problem

`ModuleContext` has grown into a broad service locator. It exposes config,
storage, routes, workflows, channels, tools, events, sessions, providers,
middleware, prompt-state providers, cleanup hooks, pre-send hooks, harness
hooks, agent/skill lookup, health checks, registered config keys, and the
global `KotaClient`.

This makes module authoring easy, but it weakens protocol boundaries. A module
that only contributes a route can also call tools directly, inspect all module
summaries, register hooks, and resolve providers. As the module system grows,
this broad context will make dependencies harder to reason about and harder to
enforce mechanically.

## Desired Outcome

The module API is split into smaller, explicit contexts:

- Contribution context for static module declarations and lightweight local
  handlers.
- Runtime context for `onLoad` / `onUnload` lifecycle services.
- Provider context for typed provider registration and resolution.
- Event context for typed event emit/subscribe.
- Client context for CLI-local `KotaClient` access.
- Hook contexts for loop/harness decoration.

Modules should receive only the context needed by the hook they implement. The
public `KotaModule` protocol remains easy to use, but the implementation no
longer hands every module every capability everywhere.

## Constraints

- Keep the migration source-compatible where possible, but prefer a clear
  staged deprecation over retaining the god context indefinitely.
- Do not split purely by line count. Each new context must map to a real
  capability boundary.
- Coordinate with the typed-provider-token task so provider context does not
  preserve the old string/unknown registry.
- Preserve existing module load order, dependency validation, and
  `commandsOnly` CLI startup behavior.

## Done When

- `ModuleContext` is either reduced to a small compatibility wrapper or
  replaced by narrower context types at module hook boundaries.
- Existing modules compile without receiving unrelated powers in narrow hooks.
- A test proves a route-only or command-only module cannot accidentally use
  provider/harness/session capabilities through its contribution hook.
- Scoped `AGENTS.md` guidance under `src/core/modules/` documents which
  context belongs to each module surface.

## Source / Intent

2026-04-28 review flagged `src/core/modules/module-types.ts` lines around
`ModuleContext` as the most obvious service-locator pressure point. The owner
asked for "nice and clean abstracts and protocol" and for mechanisms to be
reviewed "on the matter of abstracts and protocols".

External comparison:

- MCP separates server features into tools, resources, and prompts instead of
  handing every feature one universal context.
- Claude Code scopes settings, hooks, and subagents by lifecycle/surface.

## Initiative

Module-first architecture: keep KOTA extensible without letting each module
implicitly depend on every runtime capability.

## Acceptance Evidence

- Before/after type surface summary for module contexts.
- Compile-time or test fixture demonstrating unavailable capabilities in a
  narrow context.
- Existing module load, CLI command, route, workflow, and channel tests remain
  green.

