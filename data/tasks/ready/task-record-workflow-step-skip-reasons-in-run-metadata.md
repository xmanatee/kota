---
id: task-record-workflow-step-skip-reasons-in-run-metadata
title: Record workflow step skip reasons in run metadata
status: ready
priority: p2
area: observability
summary: Capture a typed reason when a workflow step is skipped so operators can tell from run artifacts and workflow.completed payloads why a when predicate or recovery guard suppressed a step
created_at: 2026-04-18T15:49:25.310Z
updated_at: 2026-04-18T15:49:25.310Z
---

## Problem

When a workflow step is skipped — by a `when` predicate, by a branch
arm losing the branch, by a parallel child whose parent never ran, or
by the recovery-aware `onNormalTrigger` guard — the run artifact
records `status: "skipped"` and the step output becomes the opaque
sentinel `{ skipped: true }`. Nothing in the run metadata,
`workflow.completed` payload, or operator clients explains *why* the
step was suppressed. Debugging a missing step requires re-reading the
workflow definition and mentally re-evaluating the predicate against
the run context, which operators cannot easily do from the web, CLI,
or attention digest. The recovery-skip pattern is especially opaque:
two different workflows can both emit "skipped" with identical
artifacts when one was intentionally gated on a recovery trigger and
the other silently tripped a misconfigured predicate.

## Desired Outcome

- Every skipped `WorkflowStepResult` carries a typed `skipReason`
  drawn from a small enum that covers the real skip sources (the
  step's own `when` predicate, a parent branch/parallel/foreach
  collapsing, recovery-trigger gating, and anything else the runtime
  already knows at skip time).
- The reason survives into on-disk run metadata, the
  `workflow.completed` event payload, and the control-API run views
  that operator clients consume.
- Where a skip is caused by a named predicate helper (for example
  `onNormalTrigger`), that predicate can attach a short label so the
  artifact reads as "skipped: recovery-trigger-gate" rather than
  "skipped: when-predicate".

## Constraints

- Extend the existing `WorkflowStepResult` and run-metadata schemas;
  do not introduce a second parallel skip-reporting surface.
- Keep the reason a closed typed enum at the core boundary, not a
  free-form string. Predicate-attached labels are an optional, typed
  descriptor on top of the enum, not a replacement.
- No new operator-facing flag or toggle. Recording the reason is
  unconditional; absence of a reason on a skipped step is a runtime
  invariant violation.
- Keep this change additive for downstream readers — old tests and
  clients that ignore the field continue to work until they opt in.
- Do not regress trace/metric output shape. The OTLP span for a
  skipped step should carry the reason as a structured attribute,
  not as a message suffix.

## Done When

- `WorkflowStepResult` includes a required `skipReason` field (typed
  enum plus optional label) whenever `status === "skipped"`, and the
  run-metadata writer persists it.
- `workflow.completed` payloads and the control-API session/run
  endpoints expose the reason per skipped step; at least one
  operator client surface (CLI status or web run view) renders it.
- `onNormalTrigger` and any other skip predicates used in the
  autonomy workflows annotate their reason; tests assert the label
  appears in run metadata for recovery-triggered runs.
- Unit tests cover branch-arm, parallel-child, foreach-empty, and
  `when`-false skip paths, each asserting a distinct reason.
- OTLP workflow-step span for a skipped step carries the reason as
  an attribute.
