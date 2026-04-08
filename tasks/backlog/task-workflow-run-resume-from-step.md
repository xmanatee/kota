---
id: task-workflow-run-resume-from-step
title: Resume a failed workflow run from a specific step without full re-execution
status: backlog
priority: p2
area: runtime
summary: When a workflow fails partway through, operators must re-trigger the entire workflow from step one. A resume-from-step capability would replay only steps from the failure point onward, reusing already-completed step outputs and skipping upstream work.
created_at: 2026-04-02T11:03:04Z
updated_at: 2026-04-08T16:30:00Z
---

## Problem

Workflows with many agent steps or expensive upstream steps (data fetch, code generation, model calls) fail for reasons unrelated to those early steps — a downstream tool failure, a transient API error, or an approval rejection. The existing `kota workflow replay` command creates a new run from scratch, re-executing every step from the beginning and incurring the full cost again.

Operators currently have no way to say: "resume from step `generate-pr` — steps before it already succeeded, skip them." This forces costly full re-runs even when only the tail of the workflow needs to be retried.

## Desired Outcome

A `kota workflow resume <run-id> --from-step <step-id>` command (or equivalent) that:
1. Loads the completed step outputs from the source run up to the named step.
2. Creates a new run (or re-activates the source run via a resume marker) with those outputs pre-populated.
3. Executes only the steps from `--from-step` onward, using upstream step results from the original run as inputs where the workflow wires them.

The run log clearly shows which steps were skipped/reused vs. newly executed, and the resumed run is linked back to the source run in the causal chain.

## Constraints

- The source run must be in a terminal state (failed or completed-with-warnings); resuming an active run is not supported.
- Steps before `--from-step` that the resumed steps depend on must have completed successfully in the source run; if they didn't, an error is returned.
- The feature does not require changes to workflow definition files — it is purely a runtime/run-store capability.
- For-each and parallel steps are out of scope for the initial implementation; only linear step sequences need to be supported first.

## Done When

- `kota workflow resume <run-id> --from-step <step-id>` starts execution from the named step, reusing prior step outputs.
- The new run's metadata references the source run ID (similar to `causedByRunId`).
- Attempting to resume from a step whose prerequisite steps did not complete successfully returns a clear error.
- `kota workflow show` on the resumed run indicates which steps were reused.
