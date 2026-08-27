---
status: done
---

# Redrive or clear open dead letters from harness readiness errors

## Problem

    Review and redrive or dismiss the 5 open dead letters in .kota/dead-letter-queue/items.json resulting from temporary harness authentication and readiness failures now that AGY tool execution has been restored.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-07T15-39-14-530Z-progress-reviewer-xgb86h.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-07T15-39-14-530Z-progress-reviewer-xgb86h.

review verdict: blocked
review summary:

    Progress review for scope 8nrg1m (kota): Scoped activity shows 5 open dead-letter entries caused by past agent harness authentication and readiness failures, despite recent progress decomposing long-horizon routing tasks into four ready items and restoring AGY tool execution.

Evidence ids:

- dead-letter:dlq-0c1b11d9-f186-4098-b624-e1094a76718c
- dead-letter:dlq-811d393c-d4ac-4876-94a7-e147c0a3c864
- dead-letter:dlq-93265ef9-37bd-4c8b-a556-a69a9e0e5760
- dead-letter:dlq-bb093ba6-242b-4129-b831-053f170cd628
- dead-letter:dlq-c1502b7f-d4bd-432a-a21c-27dce4b18991
- git:commit:2072e2f142b8

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    All 5 open dead letters are redriven or dismissed, and workflow dispatches resume without harness readiness blockages.

## Resolution

On 2026-08-11, all five cited AGY authentication and readiness dead letters were dismissed as historical incidents after global routing returned to Codex. Dispatch resumed, subsequent Codex builders completed successfully, and `workflow dlq list --json` reported zero open dead letters.
