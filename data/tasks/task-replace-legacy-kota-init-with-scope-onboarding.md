---
status: open
priority: p1
depends_on: [task-add-one-transactional-external-scope-onboarding-se]
---

# Replace legacy kota init with scope onboarding

## Problem

`src/modules/init/index.ts` is a parallel setup implementation. It writes
`kota.config.ts`, but the current config loader reads `.kota/config.json`; no
production code consumes the generated TypeScript file. It also creates task
and runtime directories directly, outside the scope registry, trust, policy,
setup, and readiness mechanisms.

Keeping it would make a new onboarding flow immediately ambiguous: `kota init`
and Add Scope could produce different scope state and neither would be the
obvious correct path.

## Desired Outcome

Remove the obsolete scaffold implementation and the `kota init` command. The
only CLI onboarding entrypoint is `kota scope add <directory>`, a thin client
of the canonical inspect/plan/apply onboarding service with the same readiness
semantics as every other client.

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
- `kota init` is absent and `kota scope add` delegates to onboarding
  inspect/plan/apply without an alias or divergent scaffold.
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
