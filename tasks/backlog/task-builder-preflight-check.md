---
id: task-builder-preflight-check
title: Add pre-flight task validation before builder agent run
status: backlog
priority: p2
area: workflow
summary: Before spending a full agent run on a task, the builder workflow should validate that the selected ready task is well-formed and actionable. Malformed or incomplete task specs should be rejected early with a clear log message rather than discovered mid-build.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The builder workflow pulls from `tasks/ready/` and immediately starts an agent run. If the task file is malformed (missing required sections, bad frontmatter, vague done criteria), the builder may burn an entire agent run producing low-quality output or failing without a useful signal. There is no gate between queue inspection and agent dispatch that checks task quality.

## Desired Outcome

- A `preflight` code step runs between `inspect-ready-queue` and `build` in the builder workflow.
- The step validates the selected task has: required frontmatter, non-empty `## Problem`, `## Desired Outcome`, and `## Done When` sections, and a clear success criterion.
- On validation failure, the step logs a specific complaint, the `build` agent step is skipped (via `when` predicate), and the run is marked as failed with a clear reason.
- Optionally, the preflight step could push the malformed task back to `inbox/` for re-triage.

## Constraints

- Validation logic should live as a small pure code step, not inside the agent prompt.
- Do not add runtime flags or production test hooks — the check is a real quality gate.
- Keep the validation heuristics simple: structural checks only, not semantic quality judgements.
- Must not block valid tasks; false positives are worse than false negatives.

## Done When

- A `preflight` step exists in the builder workflow before the agent step.
- Malformed tasks (missing sections, empty done criteria) cause the build step to be skipped.
- Tests verify the preflight rejects bad tasks and passes well-formed ones.
