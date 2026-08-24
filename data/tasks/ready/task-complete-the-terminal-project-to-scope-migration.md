---
id: task-complete-the-terminal-project-to-scope-migration
title: Complete the terminal project-to-scope migration
status: ready
priority: p1
area: architecture
task_class: Platform
production_replacement: true
summary: Replace every KOTA-owned project-as-scope contract across runtime, clients, schemas, state, tests, and docs, then delete all compatibility paths.
created_at: 2026-08-24T02:13:38.791Z
updated_at: 2026-08-24T02:13:38.791Z
---

## Problem

`scopeId` is documented as canonical, yet KOTA still requires `forProject`,
serves `/projects`, emits dual `scopeId`/`projectId` event identity, and exposes
project-named registries, clients, selectors, config, storage, tests, and docs.
The compatibility surface spans hundreds of production files and is now the
larger practical contract.

## Desired Outcome

Perform one terminal migration to scope identity across the complete live and
recovery assembly. Use `scopeId` for runtime identity, `scopeRoot` for a
directory-backed scope, `repoRoot` for Git-specific behavior, and
`workspaceRoot` for an isolated run checkout. No KOTA-owned project-as-scope
alias, route, field, type, filename, reader, or fallback remains afterward.

## Constraints

- Move core, daemon, events, policies, stores, approvals, workflows, modules,
  CLI, web, mobile, Apple, schemas, generated contracts, fixtures, tests, task
  data, and durable docs in the same replacement initiative.
- Replace `/projects`, `forProject`, `ProjectId`, `ProjectScoped*`,
  `ProjectContext`, `ProjectSelector`, `trustedProjects`, and dual event fields;
  do not retain deprecated aliases or optional fallbacks.
- Rename project-directory variables according to their actual domain:
  `scopeRoot`, `repoRoot`, or `workspaceRoot`; do not perform a blind word swap.
- Convert supported mutable state before the new runtime starts. A temporary
  migration utility may be used during implementation but is not committed as
  a permanent legacy reader.
- Preserve immutable historical evidence without allowing active code to parse
  it as a current contract. External vendor concepts such as a Vercel project
  stay isolated in their vendor adapter.
- Keep the repository compiling and production/restart proof honest; do not
  land a long-lived dual-stack intermediate state.

## Done When

- Scope selection, authority, routing, events, storage, approvals, sessions,
  workflows, and all clients use one required `scopeId` contract.
- `/scopes` is the only KOTA scope route and `forScope(scopeId)` is the only
  client selector.
- Config and mutable runtime state use scope terminology and load without a
  project compatibility reader.
- KOTA-owned production source, schemas, clients, tests, fixtures, task text,
  and current docs contain no project-as-scope symbols or filenames.
- A structural check rejects any reintroduction while permitting explicit
  vendor-owned project concepts through narrow ownership rules.

## Production Replacement Proof

oldBoundary: projectId identity, /projects routes, forProject clients, project-scoped events, and compatibility storage readers
replacementOwner: ScopeRegistry, required scopeId contracts, /scopes routes, and scope-selected clients
liveIngresses: daemon scope registration and selection | scoped workflow dispatch and approval delivery | CLI web mobile and Apple scope switching
restartIngresses: persisted scope registry restoration | workflow and event recovery | client reconnection after daemon restart
observableEffect: every live and restored operation resolves one scope identity while project-named KOTA ingress is unreachable
productionEntrypoints: src/core/daemon/scope-registry.ts | src/core/events/project-scope.ts | src/core/server/project-scoped-kota-client.ts | src/modules/daemon-ops/projects-daemon.ts | clients/web/src/lib/project-context.tsx | clients/mobile/src/context/DaemonContext.tsx
productionTests: src/core/daemon/scope-lifecycle.test.ts | src/core/events/project-scope.test.ts | src/core/server/project-scoped-kota-client.test.ts | clients/web/src/lib/project-context.test.tsx | clients/mobile/src/__tests__/ProjectSelector.test.tsx
retiredPathCheck: KOTA-owned project identity types, fields, routes, selectors, files, config, event payloads, compatibility readers, and fallback branches are unreachable
evidenceArtifact: .kota/runs/project-to-scope-migration/evidence/artifacts/production-replacement-proof.json

## Source / Intent

Owner approval on 2026-08-24 explicitly requires the migration to finish with
no leftovers, redundancy, compatibility adapter, or legacy path. The audit
found required `forProject` with optional `forScope`, `/projects` routes, dual
event identity, project-named client state, and broad project terminology in
active runtime code.

## Initiative

One canonical KOTA runtime identity: scope.

## Acceptance Evidence

- Production replacement artifact covering live daemon use, restart recovery,
  approval routing, and every supported client.
- Rendered CLI/web/mobile/Apple evidence showing scope selection with no
  project compatibility request.
- Structural search and architecture-check report proving the retired symbols,
  routes, filenames, and active readers are absent.
