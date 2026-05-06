---
id: task-drop-the-placeholder-promise-self-cast-in-runtime-
title: Drop the placeholder Promise self-cast in runtime-dispatch.ts by holding a deferred Promise<WorkflowRunExecutionResult>
status: done
priority: p2
area: core
summary: Replace the Promise.resolve() as unknown as Promise<WorkflowRunExecutionResult> placeholder in runtime-dispatch.ts with a typed deferred promise so the slot reservation no longer round-trips through unknown.
created_at: 2026-05-06T08:47:20.683Z
updated_at: 2026-05-06T08:56:31.477Z
---

## Problem

`src/core/workflow/runtime-dispatch.ts:181` claims a workflow concurrency
slot through a two-phase init that types-only-by-cast: a placeholder
`Promise.resolve() as unknown as Promise<WorkflowRunExecutionResult>` is
written into `reservation.promise`, the reservation is registered into
`state.activeRuns`, and only afterwards is the real promise from
`executeWorkflowRun` assigned over the placeholder (line 202). The
self-cast is the canonical strict-types-policy violation the past 24
hours have been picking off (`AgentLoopState`, `ModuleEventProxy`,
`DaemonSseEvent`, `NotificationGate.bus.emit`): a load-bearing core
boundary round-trips through `unknown` because the runtime helper at the
top of the two-phase init carries the wrong typed shape, then the
resolved value is force-cast back onto the strict contract.

The two-phase init is not incidental — the inline comment is explicit
that the slot must be claimed synchronously before `executeWorkflowRun`
runs because `executeWorkflowRun` emits `workflow.started` on the bus
synchronously and the wildcard handler re-enters `maybeStartNext` on the
same call stack. Until the reservation is present in `activeRuns`, the
concurrency-cap check sees zero active agent runs and a second agent
workflow can dispatch past the cap. So the placeholder cannot just be
deleted; the typed primitive that fits the reservation has to be a
deferred promise the dispatch path resolves (or rejects) once the real
promise is in hand.

`Promise.withResolvers<T>()` is the natural typed primitive (Node 22
native; the repo already runs on `v22.19.0` with `@types/node ^22`). It
yields a `Promise<T>` plus paired `resolve`/`reject` functions, all
typed end-to-end on `T`. The placeholder cast disappears at the root.

## Desired Outcome

`runtime-dispatch.ts` claims its concurrency slot synchronously through
a typed deferred `Promise<WorkflowRunExecutionResult>`. The reservation
holds the deferred promise as its `promise` field; the real promise
returned by `executeWorkflowRun` is chained into the deferred resolver
(via `.then(deferred.resolve, deferred.reject)`) so any consumer that
awaits `reservation.promise` sees the same outcome as awaiting
`executeWorkflowRun`'s direct return. The
`Promise.resolve() as unknown as Promise<WorkflowRunExecutionResult>`
line and the subsequent `reservation.promise = promise` reassignment
both go away. `src/strict-types-policy-baseline.json` drops
`src/core/workflow/runtime-dispatch.ts` from 3 by at least 1, and the
strict-types-policy integration test passes without new offenders
elsewhere.

## Constraints

- Preserve the synchronous-slot-claim invariant. The reservation must be
  visible in `state.activeRuns` before `executeWorkflowRun` is called,
  because the synchronous wildcard handler re-enters `maybeStartNext` on
  the same call stack.
- Pick one mechanism. Either `Promise.withResolvers<WorkflowRunExecutionResult>()`
  (preferred — typed by construction; Node 22 native) or a manually
  closed-over resolver pair created via `new Promise<T>((res, rej) => ...)`.
  Do not ship both.
- Do not weaken the reservation's typed shape.
  `WorkflowRuntimeDispatchState.activeRuns` is currently
  `Map<string, { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController }>`;
  the field stays non-optional and stays `Promise<WorkflowRunExecutionResult>`.
  A field-narrowing trick like `Promise<WorkflowRunExecutionResult> | undefined`
  is not an acceptable substitute for the cast — that is the optionality
  anti-pattern named in `AGENTS.md` (`No gratuitous optionality`).
- Do not introduce a new `as unknown as` cast or a `Record<string, unknown>`
  boundary elsewhere in the dispatch path.
- The deferred promise must observe the outcome of `executeWorkflowRun`
  exactly: a rejected real promise rejects the deferred promise with the
  same reason; a resolved real promise resolves with the same value.
  Tests that currently observe `reservation.promise` (e.g. cancellation
  paths, dirty-completion paths) continue to see the same final value
  shape.
- No backwards-compatibility shim that keeps the placeholder-`Promise.resolve()`
  pattern as a fallback.

## Done When

- `src/core/workflow/runtime-dispatch.ts:181` no longer contains the
  `Promise.resolve() as unknown as Promise<WorkflowRunExecutionResult>`
  line. The reservation is built from a typed deferred promise.
- `reservation.promise = promise` (line 202) is removed. The real
  promise is chained into the deferred resolver instead.
- `src/strict-types-policy-baseline.json` is regenerated and
  `src/core/workflow/runtime-dispatch.ts` drops from 3 by at least 1.
  No new offenders elsewhere — the strict-types-policy integration test
  (`src/strict-types-policy.integration.test.ts`) passes.
- The existing `runWorkflow` / `maybeStartNext` behavior tests still
  pass: synchronous slot claim before `workflow.started` re-entry, agent
  vs code concurrency caps, dirty-completion handling, agent-backoff
  application.
- If the deferred-promise path is not already exercised, add a focused
  unit test (e.g. wildcard-handler re-entry observes the reservation's
  promise as still-pending; rejection of `executeWorkflowRun` rejects
  `reservation.promise` with the same reason).

## Source / Intent

Continues the strict-typed-protocol thread the past 24 hours have
landed:

- `task-tighten-daemonsseevent-to-a-typed-discriminated-un` (commit `f61a1647`)
- `task-remove-as-unknown-as-agentloopstate-self-casts-in-` (commit `7dafb3b4`)
- `task-remove-as-unknown-as-moduleeventproxy-self-cast-in` (commit `26b97de6`)
- `task-replace-the-notificationgate-busemit-monkey-patch-` (commit `1eb441d4`)

Each one identified a load-bearing core boundary where a strict typed
contract was round-tripped through `as unknown as` because the runtime
helper carried a less-strict signature, then replaced the
monkey-patch / placeholder / loose-helper shape with a native typed
primitive that drops the cast at its root. The runtime-dispatch
placeholder-promise cast is the next sister target with the same
canonical shape, at the dispatch primitive every workflow run flows
through to claim its concurrency slot.

The architectural payoff is that the dispatch path's two-phase init
becomes typed-by-construction. The deferred-promise primitive is also
the right shape for the next time the dispatcher needs to expose a
not-yet-resolved run handle (e.g. cancellation routing, late-arriving
backpressure signals, future external claim primitives).

## Initiative

Strict typed core protocols: every load-bearing core boundary should
expose its strict contract as a first-class typed primitive instead of
round-tripping through `as unknown as`. Drops one more daemon/runtime
primitive cast and replaces the placeholder-promise pattern with a
typed deferred-promise primitive that fits the existing shape of
`WorkflowRuntimeDispatchState.activeRuns`.

## Acceptance Evidence

- Diff shows `runtime-dispatch.ts` building the reservation from a
  typed deferred promise (e.g. `Promise.withResolvers<WorkflowRunExecutionResult>()`)
  and removing both the placeholder cast (line 181) and the
  reassignment (line 202).
- `src/strict-types-policy-baseline.json` shows
  `src/core/workflow/runtime-dispatch.ts` dropping from 3 to 2 (or lower).
- `pnpm test` passes including the existing dispatch / concurrency-cap
  / dirty-recovery tests and the strict-types-policy integration test.
- If a new deferred-promise unit test lands, it exercises the
  synchronous-claim ordering and the rejection-propagation path.
