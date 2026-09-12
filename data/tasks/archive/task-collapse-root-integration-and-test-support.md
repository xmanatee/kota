---
status: done
---
# Collapse root integration and obsolete test support

## Scope / Starting Points

Inventory root and cross-module integration tests, built/source CLI variants, local/daemon variants, route/client/CLI mirrors, numbered suites, fake runtimes, global resets, catalogs, snapshots, migration fixtures, compatibility aliases, legacy branches, and all authored test-support consumers.

## Required Changes

- Record the exact packaging, process, protocol, persistence, or operator composition defect for every retained journey.
- Retain real boundaries; remove integrations whose mocks eliminate the boundary they claim to prove.
- Collapse built/source, local/daemon, and route/client/CLI variants unless each catches a distinct packaging or process failure.
- Delete helpers, fixtures, snapshots, fake runtimes, numbered parts, resets, aliases, migration paths, and legacy branches immediately after their final current consumer is removed.
- Simplify production ownership instead of adding cleanup hooks to preserve test fixtures.

## Must Not Complete While

Any integration/support file is unclassified, any retained journey lacks a distinct composition failure, any compatibility path lacks a current support policy, or deleted LOC has moved into helpers/fixtures/generated data.

## Done When

The journey/support inventory has zero unresolved rows; every retained journey crosses a real boundary; all obsolete support and production compatibility mechanisms are deleted with their consumers.

## Acceptance Evidence

Provide the journey/failure/disposition matrix, final support-consumer graph, and before/after root integration, authored-support, fixture, and implicated production LOC.

## Initiative

Final cleanup stage before the program-wide reduction audit.

## Completion evidence

Run 2026-09-08T15-32-51-032Z-builder-z8t1un reported classifying 140 journey paths and 409 support/fixture paths with zero unresolved rows. That completeness claim was too strong: commit `5443aedb5` still retained a recovery case in `workflow-step-executor-agent.integration.test.ts` which never executed recovery and ended with `expect(true).toBe(true)`. Later cleanup `d48581536` removed it. This correction records a missed acceptance condition and subsequent repair, not a reason to reopen already-fixed code.

The original run reported root integration LOC 25,877 → 17,739; all test LOC −7,031 including owner relocations; internal support −520; fixtures unchanged; public scenario API −44; other implicated production −233. Those measurements do not establish that every retained scenario was meaningful or that the wider cleanup goal was achieved.

Removed false integrations, duplicate numbered repair setup, unused helper exports, model-double production exports/global ID reset, and test-only normalized scenario aliases. Workflow scenarios now delegate child admission and waits, settlement and writer publication to the production coordinator, lifecycle and integration policy. Synthetic checkout overrides are removed, and SQLite fixture state has explicit cleanup ownership. Real session history/delegation and retry/approval boundaries remain.

Acceptance evidence is retained with this run under agent/: journey-matrix.md/json, support-consumer-graph.md/json, support-policy.md, support-mechanisms.json, loc.md/json, validation.md, repair-validation.md and command reports. Final production/test typechecking, source lint, production emission and the emitted API's writer invariant probe passed. Focused consumer and no-diff writer state/event checks passed; modified-writer integration probes remain blocked by the sandbox's denial of /bin/ps. The packed consumer passed before repair and was not rerun afterward. The reports retain those validation limits explicitly.

Second critic repair removed scripted child outcomes and four more orphan value exports. The real scope-improver/writer handoff now proves policy revocation before child execution produces a durable denial result and deferred publication. State fixtures bind the selected scope, and obsolete lifecycle directories are gone. Production/test types, all-source lint, 45 focused checks, production emission, and emitted public-API child success/failure probes passed. The expanded symbol audit includes 691 value exports with no unresolved rows; repair-2-validation.md records the exact proof and the unsuccessful exploratory standalone-host/modified-writer limits. The task remains done.
