---
id: task-add-multi-project-daemon-isolation-integration-tes
title: Add multi-project daemon isolation integration test
status: ready
priority: p2
area: architecture
summary: Add a daemon integration test that boots one daemon configured with two projects, runs a workflow in each, and asserts events, runs, sessions, owner questions, and approvals never cross projectId boundaries.
created_at: 2026-05-08T00:57:07.098Z
updated_at: 2026-05-08T18:16:00.123Z
---

## Problem

The daemon foundation slices (registry primitive, per-project bundle
factory, projectId on event payloads, projectId on control-API routes)
each ship focused unit/contract tests. The cross-cutting end-to-end
property — *one daemon hosting two projects produces no cross-project
leakage* — only gets exercised by a deliberate integration test that
spans event bus, store persistence, control-API filtering, and workflow
execution together.

Without this test, a future regression that subtly leaks state between
project bundles (a forgotten `getDefault()` call, a typo in a route
filter) can ship undetected.

## Desired Outcome

A daemon integration test under `src/` (or `src/core/daemon/`) that:

- Boots one `Daemon` instance configured with two `projects` entries.
- Triggers one workflow run in each project (or emits one
  `runtime.idle`-like event per project).
- Reads back the run store, task store, scheduler, approvals, owner
  questions, and event-bus subscriber output.
- Asserts every emitted event, every persisted run, every approval, every
  owner question, and every session carries the correct `projectId` and
  none cross the boundary.

The test runs as part of the standard `pnpm test` pipeline. Failure
output names the offending event/payload/store so a regression points
straight at the leaky subsystem.

## Constraints

- The test boots a real `Daemon`; it does not stub the runtime or the
  event bus.
- The test owns a temporary state directory and tears it down after.
- The two configured projects use distinct `projectDir` paths so the
  registry derives distinct projectIds deterministically.
- No production code changes in this task — the test exercises the
  contract built by the prior three slices.

## Done When

- A two-project daemon integration test exists and passes locally and in
  CI.
- The test asserts isolation across at least: emitted events, persisted
  runs, persisted approvals, persisted owner questions, registered
  sessions.
- The test failure output names the offending payload field for a
  cross-project leak so the regression is debuggable.

## Source / Intent

Decomposition slice (acceptance evidence) of the daemon foundation for
multi-project supervision (parent:
`task-surface-project-selection-in-operator-clients-for-`, foundation:
`task-add-daemon-project-registry-and-projectid-attribut`). The parent
acceptance criteria explicitly require a daemon integration test that
boots one daemon with two configured projects.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the same
daemon control contract.

## Acceptance Evidence

- `pnpm test` showing the new two-project integration test green.
- The test source file demonstrating real boot of `Daemon` with two
  projects and assertions on cross-project isolation.

## Unblock Precondition

```
kind: task-done
ref: task-thread-projectid-through-module-event-emits
```

Promote this task to `ready/` when the final event-bus projectId sub-slice lands
in `done/`. The Done-When list explicitly requires the test to assert
"every emitted event ... carries the correct `projectId` and none cross
the boundary"; without slice 3 the bus payload has no `projectId` field
to assert against, so the test cannot honestly exercise the contract
the prior three slices were meant to deliver. Slice 4 (control-API
projectId routing) and slice 2 (per-project ProjectRuntime bundle) have
already landed in `done/`; only the decomposed event-bus projectId sweep
gates this isolation test. Builder run
`2026-05-08T04-15-47-506Z-builder-qxep1j` re-blocked this task after
backlog-promoter promoted it on the strength of slice 4 alone.
