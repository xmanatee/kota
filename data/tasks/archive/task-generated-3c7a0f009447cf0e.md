---
status: done
---
# Bind web and control command catalogs to their owning runtime host

## Problem

Process-global sharedCatalog/ensureCatalog state competes with the host-local slash-command provider. Web route construction precedes onLoad, so handlers capture stale or foreign loader callbacks and prompt-read authority. Reproduced outcomes include returning another host's synthetic skill prompt and losing the web command palette when the CLI bootstrap loader unloads.

Investigation: Following the recent prompt-read repair through its catalog consumer exposed a separate lifecycle defect. The commands module retains a process-global sharedCatalog. ModuleLoader constructs web routes before onLoad replaces that catalog and registers another instance in the host provider registry. Consequently, web routes can capture another loader's context while control routes use their own host. A probe using real loaders and registered handlers demonstrated that host B's web invocation returned host A's synthetic prompt; B's control endpoint correctly rejected A's skill. A second probe reproduced an empty runtime web catalog after commands-mode bootstrap teardown. Source inspection connects that sequence to CLI serve startup. Existing catalog and prompt-containment tests construct catalogs directly and miss this registration interaction. Active tasks and related archived work revealed no owner covering this outcome. The shared prompt-read repair remains useful but does not fix catalog ownership. Consolidating at the existing host-local provider removes competing state without changing core lifecycle ordering. Probes used synthetic files and HTTP streams; no live server or full suite was run. No supplied delivery issue was causally linked, and no settled scanner observation was reassessed.

Evidence:
- git:6d3ef157bd3caca28095cd5c1eb9769945e977ae
- git:dc80d5b00941c6ca597b391fa3023444ec1997eb
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- src/modules/commands/AGENTS.md
- src/modules/commands/index.ts
- src/modules/commands/catalog.ts
- src/modules/commands/routes.ts
- src/modules/commands/control-routes.ts
- src/core/modules/module-loader-load-phases.ts
- src/core/modules/module-context.ts
- src/core/modules/runtime-module-discovery.ts
- src/cli.ts
- src/modules/web/web-operations.ts
- src/modules/commands/catalog.test.ts
- src/modules/commands/daemon-control.test.ts
- src/prompt-loading.integration.test.ts
- src/built-cli-serve.integration.test.ts
- data/tasks/archive/task-security-review-f0c3e6364fd6ae5785c968c0.md
- data/tasks/archive/task-migrate-commands-daemon-control-routes-out-of-core.md
- data/tasks/archive/task-codify-module-lifecycle-modes-so-runtime-cannot-co.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t03-22-21-376z-archite-6c5f02b8819a7308a6b04fff39c19f81928712ad5cf0bee45a32df7ac973e6dd/agent/commands-catalog-review.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t03-22-21-376z-archite-6c5f02b8819a7308a6b04fff39c19f81928712ad5cf0bee45a32df7ac973e6dd/agent/commands-catalog-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t03-22-21-376z-archite-6c5f02b8819a7308a6b04fff39c19f81928712ad5cf0bee45a32df7ac973e6dd/agent/commands-catalog-probe.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t03-22-21-376z-archite-6c5f02b8819a7308a6b04fff39c19f81928712ad5cf0bee45a32df7ac973e6dd/agent/commands-catalog-startup-probe.json

## Desired Outcome

Each host's web and control command endpoints resolve contributions and prompt authority from that host throughout startup, overlapping loads, and teardown. CLI bootstrap cleanup leaves the serving host's command palette usable. Expected simplification is removal of global catalog cache/reset logic; implementation and benefits remain unverified.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Web slash-command listing and skill invocation through /api/commands and /api/commands/invoke
- Daemon-control command listing and invocation through /commands and /commands/invoke
- CLI serve startup composing commands-mode and runtime ModuleLoaders

Alternatives considered:
- Leave the code unchanged: rejected because both catalog misattribution and bootstrap-teardown failure were reproduced.
- Use the existing host-local slash-command provider for both surfaces: preferred because activation and withdrawal already have an owner.
- Build separate catalogs per context: avoids global leakage but retains parallel ownership and requires proving their lifecycle agreement.
- Introduce a context-keyed cache: adds unnecessary cache lifecycle state beside the existing provider registry.

Migration and retirement: Create the catalog during commands-module activation and resolve it through the owning context/provider at route invocation. Remove sharedCatalog, ensureCatalog, and reset-based ownership. Preserve existing route contracts and transport-specific workflow dispatch behavior. Keep factories side-effect-free and make unavailable or withdrawn providers fail visibly. Update module guidance to describe the actual ownership. Link the repair to the prior command-route migration and prompt-containment task as related provenance.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise the real commands module with two loaders having distinct skills, prompt roots, and prompt-read policies. Verify both surfaces list and invoke only their owner's commands before and after another host unloads, including unload/reload. Cover commands-mode bootstrap followed by runtime activation and bootstrap cleanup. Extend the existing built CLI serve journey to demonstrate a usable skill command after cleanup where execution is available. Retain distinct prompt-containment, control authorization, and workflow-dispatch checks; run affected portfolios and the static gate.

Show that both route surfaces use the existing host provider authority and that process-global catalog/cache/reset state is gone. Demonstrate that registration order and another loader's teardown cannot select a foreign catalog. Add focused composition coverage for this failure without duplicating existing catalog, HTTP, or filesystem-security test matrices.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

## Completion evidence

The commands module now creates its catalog only during activation. Web listing
and invocation resolve the owning context's `slash-command-catalog` provider per
request, matching the control surface. Removed `sharedCatalog`, `ensureCatalog`,
the reset lifecycle, and the control factory's optional process-registry fallback.
The control HTTP fixtures now supply an explicit registry. Web daemon transport
and control workflow-dispatcher behavior remain with their existing owners.
Module guidance describes the host registry as the single catalog authority.

`commands-host.integration.test.ts` passes both real-loader compositions: distinct
skills, prompt roots and host permissions across overlapping loads, withdrawal,
reload and the other host's teardown; and commands-mode bootstrap cleanup with a
usable runtime palette. Existing prompt-containment tests pass (2), as do catalog
owner tests (9). The existing built CLI serve journey now asserts skill listing
and invocation. The production build and `pnpm check:fast` passed.

The compiled-code stream probe in this run's artifacts records both surfaces
returning only their host's synthetic prompts, foreign-command 404s, withdrawn
provider 503s, and a surviving host after bootstrap and peer cleanup. This is
observed behavior, not a claimed performance improvement. The new composition
checks add the missing lifecycle proof without replacing the distinct catalog,
prompt-security, authorization or workflow-dispatch checks.

Validation limitation: this sandbox rejects localhost listeners with EPERM, so
all 13 existing control HTTP cases and the built CLI serve case could not execute
their journeys. The additional daemon-runtime-load suite passed its mode guard
but its live restart case failed because its control-address fixture was absent.
No live CLI, daemon restart, full-suite or native-client pass is claimed. Native
client source and shared wire contracts did not change. Build, static validation,
real-loader handler checks and the compiled stream transcript provide scoped
proof of this catalog ownership repair. Logs and the probe source/results are
retained under this builder run's artifact directory.

Related provenance: [command route migration](task-migrate-commands-daemon-control-routes-out-of-core.md)
and [prompt containment repair](task-security-review-f0c3e6364fd6ae5785c968c0.md).
