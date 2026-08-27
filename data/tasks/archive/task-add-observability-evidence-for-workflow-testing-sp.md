---
status: done
---

# Add observability evidence for workflow testing split helpers

## Problem

Builder run 2026-06-27T08-06-19-202Z-builder-dti9px resolved the core workflow testing source-size advisory, but its observability-obligation diagnostic still reports missing inspectable evidence for src/core/workflow/testing/index.ts and src/core/workflow/testing/results.ts after runtime-sensitive workflow testing changes.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T08-25-28-718Z-progress-reviewer-ri0f8l.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution Evidence

- Added `src/core/workflow/testing/harness-results.test.ts` with focused assertions for the two files flagged by `observability-obligation-review.json`.
- `src/core/workflow/testing/index.ts` is mapped to public `WorkflowTestHarness` / `HarnessRunResult` assertions: validation failures become explicit failed run results, emitted events are visible, and restart requests are visible.
- `src/core/workflow/testing/results.ts` is mapped to result-shaping assertions: decoder failures are preserved as explicit failed step errors, and `makeStepResult` keeps harness-facing and internal step result fields aligned.
- Wrote `.kota/runs/2026-06-27T10-33-29-094Z-builder-en8pxe/observability-evidence.json` as the run artifact mapping both missing files to the focused evidence.
- Verification: `pnpm test src/core/workflow/testing/harness-results.test.ts` passed; `pnpm test src/core/workflow/testing` passed; `pnpm run validate-tasks` passed; `pnpm run typecheck` passed; `pnpm run lint` exited 0 with existing style infos outside this change.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T08-25-28-718Z-progress-reviewer-ri0f8l.

review verdict: needs-steering
review summary: Recent KOTA activity is mostly on track: Safety 1, Platform 10, Product 0, Meta 0, Unclassified 8, with no reported operator-journey risks or open dead letters. Steering is needed because the latest successful builder run closed the source-size task but left a concrete observability-obligation warning for two workflow testing split files.

Evidence ids:

- run:2026-06-27T08-06-19-202Z-builder-dti9px
- artifact:2026-06-27T08-06-19-202Z-builder-dti9px:observability-obligation-review.json
- git:commit:af2edc368765

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up builder run or explicit run artifact maps src/core/workflow/testing/index.ts and src/core/workflow/testing/results.ts to structured logging, typed events, explicit error-result evidence, focused test assertions, or an explicit observability-obligation rationale; the diagnostic reports no unresolved missing files or a justified waiver; focused workflow testing tests and task validation pass.
