---
id: task-accept-scopeid-on-project-scoped-daemon-controls
title: Accept scopeId on project-scoped daemon controls
status: ready
priority: p2
area: architecture
summary: Make project-scoped daemon control routes and KotaClient filters accept canonical scopeId selectors, keeping projectId as an explicit compatibility alias with conflict rejection.
created_at: 2026-06-21T09:32:23.925Z
updated_at: 2026-06-21T09:32:23.925Z
task_class: Platform
---

## Problem

KOTA's architecture now treats `scopeId` as the canonical runtime context and
keeps `projectId` as directory-scope compatibility language. The daemon
contract already exposes scope projections, and event declarations require
scope-aware payloads, but many control-plane selectors and `KotaClient`
filters still accept only `projectId`.

That leaves compatibility language as the de facto API for project-scoped
state. It also makes the next non-directory scopes harder: external channels
and clients can see `scopeId` in projections and run artifacts, but they must
fall back to `projectId` to list or mutate scoped sessions, workflow runs,
approvals, owner questions, memory, knowledge, history, tasks, and related
control surfaces.

Completed predecessor work deliberately kept `projectId` alive while
multi-project routing stabilized. This task is the bounded follow-up: accept
canonical `scopeId` selectors everywhere current project-scoped daemon controls
already accept `projectId`, without removing the compatibility alias in the
same slice.

## Desired Outcome

Project-scoped daemon controls and module-owned `KotaClient` namespaces accept
a canonical `scopeId` selector. Existing `projectId` callers keep working as a
compatibility path, but selector normalization is explicit:

- `scopeId` alone routes to the selected scope.
- `projectId` alone routes through the existing directory-scope compatibility
  path.
- matching `scopeId` and `projectId` values are accepted only when they resolve
  to the same runtime scope.
- conflicting `scopeId` / `projectId` values fail before any state read,
  mutation, owner answer, approval execution, or workflow operation starts.

The implementation should use a shared decoder/helper or an equivalent typed
pattern so new module-owned daemon controls do not copy ad hoc query parsing.
Internal runtime resolution should prefer scope language at the boundary where
that type already exists, while preserving existing project-runtime plumbing
only where directory-backed stores still require it.

## Constraints

- Do not rename or remove public `projectId` routes/fields in this task.
  Retiring compatibility language is a later migration once clients have
  adopted the canonical selector.
- Do not add a parallel registry, store, client, or route family. Use the
  existing scope registry, project-runtime compatibility adapter, daemon
  transport, and module-owned control routes.
- Normalize external selectors once at the route/client boundary. Avoid
  nullable fallbacks or "prefer one when both are present" behavior; conflicts
  must be loud.
- Keep exact namespace inventories in source tests, not docs. A guard test that
  enumerates `projectId`-only client filters or route parsers is preferred over
  a durable prose catalog.
- Preserve single-project behavior. Existing callers that omit a selector
  should still hit the default scope/project exactly as they do today.
- Do not broaden this into non-directory scope storage. This task enables the
  selector contract; it does not need to implement new scope providers.

## Done When

- A shared `ScopeSelector` / decoder / serializer path, or a clear equivalent
  typed pattern, supports `scopeId`, compatibility `projectId`, default-scope
  fallback, and conflict rejection.
- Every daemon control route and module-owned `KotaClient` filter that already
  accepts `projectId` for scoped state also accepts `scopeId`.
- `KotaClient.forProject(projectId)` remains available as a compatibility
  convenience, and a scope-first client helper or filter path exists for new
  callers.
- Focused tests cover `scopeId` success, `projectId` compatibility success, and
  conflicting selector rejection before side effects for representative
  namespaces including approvals, owner questions or owner decisions, sessions
  or workflow runs, and one store/task namespace.
- A guard or coverage test makes remaining `projectId`-only project-scoped
  selectors visible, with explicit exemptions only for intentionally
  compatibility-named surfaces.
- The shared client conformance fixture and decoders are updated if any public
  response or request fixture shape changes.

## Source / Intent

Explorer run `2026-06-21T08-27-39-472Z-explorer-d58wbc` found zero actionable
ready/doing/backlog tasks. The strategic blocked alternatives all still
require operator-captured evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

Local source checked:

- `docs/ARCHITECTURE.md` defines `scopeId` as canonical and says `projectId`,
  `/projects`, and project route parameters are compatibility language for
  directory-backed scopes.
- `data/tasks/done/task-promote-projects-into-hierarchical-scopes.md` completed
  the scope abstraction while explicitly allowing compatibility aliases during
  migration.
- `data/tasks/done/task-thread-projectid-through-control-api-routes-and-up.md`
  predates the scope-first migration and intentionally threaded `projectId`
  through the control API.
- Current client types still expose many `projectId?: string` selectors in
  module-owned namespaces, while conformance fixtures already carry rich
  `scopeId` projections.

Local overlap check:

- `task-promote-projects-into-hierarchical-scopes` established the core scope
  model, not the control-plane selector migration.
- `task-thread-projectid-through-control-api-routes-and-up` made
  multi-project routing possible before scope terminology existed.
- `task-map-a2a-tenant-routing-to-kota-project-scoping` normalized A2A tenant
  routing at one channel boundary only; it still maps to daemon
  `projectId`-based session selectors.
- Recent safety tasks covered approvals, notifications, and remote MCP
  injection-defense behavior, not the remaining scope/project selector debt.

## Initiative

Scope-first KOTA control plane: one daemon can route operator clients,
channels, and automation through canonical scopes while retaining explicit
directory-project compatibility.

## Acceptance Evidence

- Focused unit/integration test output for the changed control routes and
  `KotaClient` namespaces, including success through `scopeId`, compatibility
  success through `projectId`, and conflict rejection.
- `pnpm test src/core/server/project-scoped-kota-client.test.ts` or its
  successor coverage showing scoped client injection prefers canonical
  selectors while preserving `forProject`.
- Queue or guard validation output showing there are no untracked
  `projectId`-only project-scoped selectors, or that each remaining occurrence
  is named as an intentional compatibility surface in source tests.
- `pnpm run typecheck`.
