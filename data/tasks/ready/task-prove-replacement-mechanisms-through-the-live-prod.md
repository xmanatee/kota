---
id: task-prove-replacement-mechanisms-through-the-live-prod
title: Prove replacement mechanisms through the live production assembly
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Require cross-cutting runtime replacements to prove that the production assembly uses the new mechanism and that the retired path is no longer reachable before the task can complete.
created_at: 2026-08-16T08:35:47.222Z
updated_at: 2026-08-16T08:36:30.000Z
---

## Problem

Two recent large changes passed focused tests while their intended replacement
was not complete in the live assembly:

- `634e84ef0` removed polling escalators in favor of module event subscribers,
  but production module loading invoked `onLoad` before attaching the EventBus,
  so every replacement subscription silently became a no-op. A separate P0
  repair was required.
- `d25d5784b` removed periodic and completion-count reflection triggers and
  added pre-queue admission, but daemon restart restored persisted runs without
  applying current trigger membership or admission. Two obsolete reviews
  remained queued and the P0 task had to be reopened.

Both implementations tested their new components. Neither proved, through the
real production composition root and restart lifecycle, that every producer
and recovery ingress used the new mechanism before the old behavior was
retired.

## Desired Outcome

Add one behavioral completion contract for tasks that replace a cross-cutting
runtime mechanism. The task identifies the old boundary and its replacement;
verification exercises the production assembly, including startup/restart and
persisted-state ingress where relevant; and completion evidence proves that
the replacement receives real traffic while the retired path is unreachable.

This is not a catalog of configuration literals or a generic broad test suite.
It is a reusable way for each replacement task to declare and prove its own
observable adoption boundary.

## Constraints

- Reuse production composition roots, workflow definitions, and lifecycle
  harnesses. Do not build a parallel test-only daemon or duplicate runtime
  wiring in fixtures.
- Test behavior and ownership, not copied configuration values, file names, or
  implementation catalogs.
- Keep the contract task-declared and narrow. Do not force unrelated local
  refactors through an expensive end-to-end gate.
- Fail when any live or recovery ingress bypasses the declared replacement;
  do not add compatibility fallbacks, legacy paths, or migration exceptions.
- Preserve focused unit tests for local logic; this contract covers the missing
  production adoption proof, not every implementation detail.

## Done When

- A replacement task can declare its old boundary, new owner, production
  ingress points, restart/recovery ingress, and observable success effect.
- The verification mechanism runs against the same production assembly used by
  the daemon and fails if the replacement is unbound, silently inactive, or
  bypassed by restored state.
- Regression fixtures reproduce both `634e84ef0`'s unattached EventBus and
  `d25d5784b`'s restore-admission bypass, then pass only after the live paths use
  their declared owners.
- Completion evidence includes a positive live effect and a negative search or
  reachability proof that the retired behavior no longer has an ingress.
- Architecture and task-authoring guidance requires this behavioral proof for
  future mechanism replacements without introducing a literal config test.

## Source / Intent

Manual review of the last 50 commits and live daemon recovery on 2026-08-16.
The owner asked for capable agents to be trusted, while ensuring that broad
architectural replacements are proven where they actually run rather than
declared complete from isolated component tests.

## Initiative

Production-proven single-mechanism architecture.

## Acceptance Evidence

- Production-lifecycle regression artifacts for the EventBus subscription and
  workflow-queue restore cases.
- One task-authored example showing a future replacement contract, its live
  effect, and retired-path reachability result.
