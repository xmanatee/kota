---
id: task-replace-legacy-kota-init-with-scope-onboarding
title: Replace legacy kota init with scope onboarding
status: backlog
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-one-transactional-external-scope-onboarding-se]
summary: Remove the unread kota.config.ts scaffold path and make all initialization delegate to the canonical scope onboarding service.
created_at: 2026-07-31T16:12:53.613Z
updated_at: 2026-07-31T16:12:53.613Z
---

## Problem

`src/modules/init/index.ts` is a parallel setup implementation. It writes
`kota.config.ts`, but the current config loader reads `.kota/config.json`; no
production code consumes the generated TypeScript file. It also creates task
and runtime directories directly, outside the scope registry, trust, policy,
setup, and readiness mechanisms.

Keeping it would make a new onboarding flow immediately ambiguous: `kota init`
and Add Scope could produce different project state and neither would be the
obvious correct path.

## Desired Outcome

Remove the obsolete scaffold implementation and make local initialization a
thin client of the canonical onboarding service. Preserve a discoverable CLI
entrypoint only if it is useful, but it must inspect/plan/apply the same
operation as every other client and print the same readiness semantics.

## Constraints

- Delete the `kota.config.ts` template and all instructions that claim it is a
  supported config source. Do not add a loader fallback for it.
- Do not retain direct directory creation in the init module as a compatibility
  path. Shared scaffolding belongs behind the onboarding service.
- Existing valid task data, `.kota/config.json`, guidance, and runtime state
  are preserved and reported; `--force` must not overwrite them blindly.
- Use current rendering and daemon/client contracts; no init-specific output
  protocol.

## Done When

- `kota.config.ts` is absent from production setup code and user guidance.
- `kota init`, or its explicit replacement, delegates to onboarding
  inspect/plan/apply and cannot create an unregistered divergent scaffold.
- Existing, empty, partially initialized, and already registered directories
  produce deterministic plans without data loss.
- A source search finds one implementation of task/runtime project scaffolding
  used by onboarding entrypoints.

## Source / Intent

Architecture audit on 2026-07-31 found `src/modules/init/index.ts` generating
`kota.config.ts` while `src/core/config/config.ts` reads JSON from `.kota`.
This is a concrete legacy path that would conflict with the requested Add
Project experience.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- A CLI transcript on an empty temp directory shows inspect, accepted plan,
  created state, registered scope, and final readiness through the shared
  service.
- A second invocation transcript shows an idempotent no-op.
- A search artifact proves the dead `kota.config.ts` template and direct init
  scaffold path are gone.
