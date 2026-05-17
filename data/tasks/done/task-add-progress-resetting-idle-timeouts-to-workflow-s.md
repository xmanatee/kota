---
id: task-add-progress-resetting-idle-timeouts-to-workflow-s
title: Add progress-resetting idle timeouts to workflow steps
status: done
priority: p2
area: core
summary: Add a strict idle-timeout policy for workflow and agent steps so stalled streams fail or retry after no observable progress, without imposing a shorter hard wall-clock cap on productive long runs.
created_at: 2026-05-17T05:25:16.639Z
updated_at: 2026-05-17T05:45:48.865Z
---

## Problem

KOTA workflow steps already have `timeoutMs`, but that rail is a hard
wall-clock budget. Long-running autonomous agent steps therefore need a large
wall budget to avoid killing productive work, and a stalled provider stream or
silent tool loop can sit until that larger budget expires or until a
provider-specific idle error bubbles up. The runtime cannot currently express
"this step may run for a long time, but it must keep making observable
progress."

LangGraph's 1.2 fault-tolerance docs separate hard run timeouts from
progress-resetting idle timeouts, where idle timers reset on stream chunks,
state writes, child work, callbacks, or explicit heartbeats. KOTA should adopt
the runtime reliability pattern without adopting LangGraph's graph DSL or
adding a second workflow engine.

## Desired Outcome

Workflow step execution supports a strict, typed idle-timeout policy alongside
the existing hard `timeoutMs` behavior. Agent steps can declare that the step
must emit runtime-observable progress within `idleTimeoutMs`; when no progress
arrives before the deadline, the executor aborts the current attempt with a
structured idle-timeout failure that participates in the existing retry,
failure-alert, and run-record paths.

Progress signals are explicit runtime events, not log-text heuristics. For
agent steps, streaming assistant deltas, tool-call lifecycle events, and
completed turn/output writes reset the idle clock. Code steps that need this
rail get an explicit heartbeat/progress API rather than relying on stdout
noise.

## Constraints

- Keep `timeoutMs` as the hard wall-clock cap; do not silently change existing
  step budgets or default timeout semantics.
- Extend the existing workflow step protocol, validators, and executors. Do
  not introduce a parallel graph/checkpoint DSL.
- The idle-timeout error must be distinguishable from provider-originated
  stream-idle errors, while still routing through the same retry classifier
  when the step is retryable.
- Await-event and ask-owner waits keep their current suspension/deadline
  semantics. Their protocol-level wait timeout is not replaced by the new
  idle-progress rail.
- Observable progress must be emitted by trusted runtime boundaries. Do not let
  arbitrary untrusted content reset the timer unless the adapter converts it
  into a typed runtime progress event.

## Done When

- Workflow step input types and validators accept a strict idle-timeout field
  or typed timeout policy, and reject malformed or ambiguous combinations.
- Agent-step execution resets the idle clock on typed progress signals and
  aborts with a structured idle-timeout error when progress stops.
- Retry/error classification treats KOTA idle-timeout failures consistently
  with other transient agent-step infrastructure failures, without masking them
  as successful runs.
- Tests cover: a long productive agent step that exceeds `idleTimeoutMs` in
  total but keeps progressing; an idle agent step that fails or retries at the
  idle deadline; hard `timeoutMs` still winning when it fires first; malformed
  idle-timeout config rejection; and await-event steps remaining governed by
  `awaitTimeoutMs`.
- Narrow workflow-runtime guidance mentions the distinction between hard
  timeout and idle-progress timeout without cataloging every field.

## Source / Intent

Explorer run `2026-05-17T05-22-44-177Z-explorer-r7pfva` checked the empty
queue. The strategic blocked alternatives were all operator-capture gated and
not movable:
`task-add-cross-preset-runtime-parity-gate`,
`task-capture-an-end-to-end-coding-task-parity-artifact-`,
`task-enable-autonomous-access-to-auth-walled-sources-so`, and
`task-introduce-a-rich-cli-rendering-abstraction-for-all`.

External signal: LangGraph 1.2 fault-tolerance docs now describe separate
`run_timeout` and `idle_timeout` behavior, progress signals, explicit
heartbeats, and retryable timeout failures:
https://docs.langchain.com/oss/python/langgraph/fault-tolerance

Local inspection found KOTA's current `timeoutMs` rail in
`src/core/workflow/run-executor-step.ts`,
`src/core/workflow/steps/step-executor-foreach.ts`, and
`src/core/workflow/steps/step-executor-parallel.ts`, plus provider stream-idle
classification in `src/core/workflow/steps/step-executor-retry.ts`. The
missing piece is KOTA-owned idle-progress timing at the runtime boundary.

## Initiative

Workflow runtime resilience: long-running autonomous work should be allowed to
run when productive and fail promptly when it stops making observable progress.

## Acceptance Evidence

- Focused test transcript for workflow step validation and executor behavior,
  including the productive-long-run and idle-stall cases.
- A run-record fixture or integration test showing a failed idle-timeout agent
  step records a structured idle-timeout reason and emits the normal workflow
  failure path.
