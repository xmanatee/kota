---
status: done
---

# Add per-step failure strategy to control run abort behavior

## Problem

All workflow step failures currently abort the run immediately. This is correct for critical steps but too strict for optional or informational steps. For example, a Telegram notification step that fails due to a transient API error should not cancel a successful build verification sequence. There is no way to mark a step as non-blocking today.

## Desired Outcome

- Workflow step definitions (tool and agent steps) support an optional `continueOnFailure?: boolean` field.
- When `true`, a step failure is recorded in the run result but does not abort the run.
- Subsequent steps that use `when` predicates referencing a failed step with `continueOnFailure: true` can still check its outcome.
- `kota workflow show` marks such steps as failed-but-continued visually.

## Constraints

- Do not change the default behavior: missing `continueOnFailure` means `false` (abort on failure).
- The step result must still record the failure status accurately so it is visible in history.
- Apply the change narrowly in `step-executor.ts` / `run-executor.ts` — do not change the overall run status to success if a `continueOnFailure` step failed; use a distinct status like `"completed-with-warnings"` or surface it via metadata.
- Update validation to accept the new field.

## Done When

- `continueOnFailure` is defined in step type definitions.
- `step-executor.ts` / `run-executor.ts` respects the flag.
- A failed `continueOnFailure` step does not abort subsequent steps.
- Validation accepts and validates the field.
- Tests cover the continue-on-failure path.
