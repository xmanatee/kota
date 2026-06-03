---
id: task-promote-projects-into-hierarchical-scopes
title: Promote projects into hierarchical scopes
status: backlog
priority: p1
area: core
summary: Generalize KOTA's project registry/runtime/event scoping into a minimal hierarchical scope model, with directories as the first scope provider and project terminology kept only as compatibility UI language where needed.
created_at: 2026-06-03T13:40:04.426Z
updated_at: 2026-06-03T13:41:17.000Z
---

## Problem

The daemon currently has a typed multi-project foundation:
`ProjectRegistry`, `ProjectRuntimeRegistry`, `ProjectScopedEventBus`,
`projectId` event payloads, `/projects`, and project-aware client contracts.
That implementation works for directory-backed code projects, but the owner
explicitly wants the core abstraction to be scope, not project. A scope can be
global or directory-backed at first, and scopes should be arranged in a
hierarchy without typed project categories.

Leaving project as the core word will push non-code use cases such as trip
planning, birthday planning, self-reflection, and channel communities into a
code-project mental model. It also makes cross-scope autonomy and channel
routing harder to explain cleanly.

## Desired Outcome

Generalize KOTA's project registry/runtime/event boundary into a scope
registry while preserving current directory-backed behavior. Directory scopes
are the first provider, but the protocol must not encode project types or
domain-specific scope classes.

The scope model should support:

- Stable `scopeId`, display name, optional parent scope, and optional directory
  root.
- A global/root scope.
- Per-scope runtime bundles where a directory runtime exists.
- Scope-aware events, workflows, stores, owner questions, approvals, sessions,
  and clients.
- Compatibility aliases or route shims where existing clients still expect
  project terminology during migration.

## Constraints

- Do not introduce typed project categories such as code/travel/personal.
  Scopes are equal; domain behavior comes from scoped files, module config,
  workflows, agents, and local `AGENTS.md`.
- Keep directory scopes as the first practical implementation. Non-directory
  scope providers may be represented by the protocol but do not need full
  implementation in this slice.
- Preserve current multi-project behavior and tests while renaming or
  generalizing the contract.
- Keep core small. Scope registry/runtime belong in core daemon/event
  contracts only where runtime isolation requires it.
- Avoid nullable compatibility fallbacks. If a route supports both project and
  scope terminology during migration, decode both explicitly and validate
  conflicts loudly.

## Done When

- The architecture docs define `scope` as the canonical abstraction and
  describe `project` as a directory-scope compatibility term, not a core
  primitive.
- Core types expose a scope registry/projection that can represent a global
  scope and directory-backed child scopes.
- Event payloads and workflow route filters have a scope-aware path with
  compatibility coverage for existing `projectId` callers.
- Clients consume the scope projection or a compatibility adapter instead of
  deriving behavior from `.kota` files.
- Existing project-registry and project-runtime isolation tests are migrated or
  mirrored to prove scope isolation.
- `pnpm test` for daemon, event, workflow, and client-contract tests passes.

## Source / Intent

Owner follow-up on 2026-06-03: "there shouldn't be a concept of project in core
abstractions, but there probably should be concept of scope and an example of
scope could be a directory with a project... every scope is equal and scopes
could be arranged in a hierarchy. probably we could start with scopes being
directories."

Current relevant code includes `src/core/daemon/project-registry.ts`,
`src/core/daemon/project-runtime.ts`, `src/core/events/project-scope.ts`,
`src/modules/daemon-ops/projects-cli.ts`, `clients/AGENTS.md`, and
`clients/web/AGENTS.md`.

## Initiative

Scope-first KOTA: one daemon can host global and directory-backed contexts
without forcing every context to look like a software project.

## Acceptance Evidence

- Updated architecture docs and scoped `AGENTS.md` files.
- Unit/integration test output for scope registry, runtime isolation,
  event filtering, and client-contract decoding.
- A control-API fixture showing at least one global scope and two
  directory-backed child scopes.
