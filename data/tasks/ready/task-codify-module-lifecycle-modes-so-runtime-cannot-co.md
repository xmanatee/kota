---
id: task-codify-module-lifecycle-modes-so-runtime-cannot-co
title: Codify module lifecycle modes so runtime cannot consume partial contributions
status: ready
priority: p1
area: architecture
summary: Turn the commandsOnly/full-runtime distinction into an explicit typed lifecycle contract with guardrails, so daemon runtime, MCP, CLI, tests, and future modules cannot accidentally consume routes, providers, workflows, health checks, or tools from a partially loaded context.
created_at: 2026-04-28T22:35:43.974Z
updated_at: 2026-04-28T22:35:43.974Z
---

## Problem

`commandsOnly` is currently a boolean optimization on `ModuleLoader`. It is
easy for callers to forget what can and cannot be consumed from that context.
The daemon bug happened because runtime routes were read from a context whose
`onLoad` hooks were intentionally skipped.

This is a structural risk, not just a daemon bug. Future modules, tests, or
clients can repeat the same mistake with routes, provider registries, tools,
skills, workflows, channels, health checks, or local client handlers.

## Desired Outcome

Module lifecycle modes become explicit protocol boundaries:

- command-registration context: safe for CLI command shape and lightweight local
  handlers only;
- full-runtime context: safe for daemon/MCP/workflow runtime contributions that
  require `onLoad`, providers, tools, skills, channels, health checks, and routes;
- tests and helper APIs make the selected lifecycle mode visible in names and
  types;
- consumers cannot accidentally call full-runtime getters on a command-only
  loader without an explicit failure.

## Constraints

- Coordinate with existing broader work in
  `data/tasks/backlog/task-split-module-context-into-capability-contexts.md`;
  this task should land targeted lifecycle safety without requiring the entire
  ModuleContext split.
- Preserve ordinary CLI startup performance.
- Do not break source compatibility more than necessary; staged deprecations are
  acceptable if the unsafe calls are mechanically flagged.
- Keep MCP behavior intact; it already documents the need for non-commandsOnly
  loading.
- Include guardrails in tests, not only comments.

## Done When

- `ModuleLoader` or its returned context exposes lifecycle-appropriate accessors
  rather than one ambiguous set of getters for every mode.
- Calling runtime-only contribution getters from command-only state throws a
  clear error or is prevented by types.
- Daemon, MCP, CLI, metadata, and module tests use lifecycle-specific helpers or
  names so future reviewers see which mode they are exercising.
- Scoped docs under `src/core/modules/AGENTS.md` describe the lifecycle contract.
- A regression fixture proves the exact daemon bug class cannot recur through a
  silent partial context.

## Source / Intent

2026-04-28 investigation found that `commandsOnly` was technically correct but
too easy to misuse. The project already had one local precedent in MCP
documenting "fully-loaded modules (not commandsOnly)", but that knowledge did
not protect daemon startup. The owner asked for tasks that eliminate this type
of inconsistency across clients, modules, core, mechanisms, and structures.

## Initiative

Module lifecycle integrity: make invalid module-loading combinations impossible
or loud.

## Acceptance Evidence

- Test output showing command-only contexts reject runtime-only contribution
  consumption.
- A before/after type or API summary in the run artifact.
- Existing CLI, daemon, MCP, and module-loader tests remain green.
