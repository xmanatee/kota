---
status: done
---

# Complete the terminal project-to-scope migration

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
- Active KOTA contracts, production source, generated schemas, clients, tests,
  fixtures, and current docs contain no project-as-scope symbols or filenames.
- Stable task identities and immutable historical evidence may retain their
  original wording, but no active reader or runtime contract may consume it as
  current project-as-scope state.
- A structural check rejects any reintroduction while permitting explicit
  vendor-owned project concepts through narrow ownership rules.

## How We Will Know

- Representative live and restarted daemon operations resolve one scope
  identity through the production owner.
- CLI, web, mobile, and Apple clients select the same scope contract.
- The compiler, generated bindings, and a migration-time search reveal no
  KOTA-owned project-as-scope ingress; the temporary search is removed when
  the migration is complete.

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

## Result

`ScopeId`, `ScopeRegistry`, `ScopeSelector`, `/scopes`, and `forScope` now own
KOTA runtime identity from configuration through daemon routing, events,
durable workflow state, trust and approval decisions, modules, CLI, and every
supported client. The project-named types, selectors, routes, event fields,
configuration keys, storage fields, filenames, precedence rules, and reverse
aliases were removed rather than retained behind a compatibility adapter.

The active `.kota` state inspected for this migration contained no retired
identity record that required conversion. Immutable run evidence and completed
task history were preserved, and no current reader treats their historical
wording as a live contract. Canonical types, schemas, generated UI bindings,
and client decoders now expose only scope identity; the temporary migration
search was removed instead of becoming a permanent source-absence test.

Verification observed a clean production build and schema/binding freshness;
1,105 owner files with 11,229 passing tests; 135 integration files with 883
passing tests; and 81 evaluation files with 364 passing tests. Web passed its
typecheck, production build, and 153 tests; mobile passed its typecheck and 456
tests; Apple built and passed 309 tests. Repository and web lint, test and
production typechecks, task validation, copied-fixture consistency, and diff
whitespace validation also passed.
