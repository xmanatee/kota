---
status: done
---

# Validate operator-capture proof before blocked-promoter promotion

## Problem

Blocked-promoter moved the Telegram deploy task from blocked to backlog because the capture directory existed, while the task body still says only smoke.txt exists and the required Telegram status exchange is missing. Tighten operator-capture promotion so partial captures keep the task blocked with refreshed instructions until the required proof is present.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-16T14-41-55-204Z-progress-reviewer-1ral56.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-16T14-41-55-204Z-progress-reviewer-1ral56.

review verdict: needs-steering
review summary: Recent build and security activity mostly progressed, but blocked-promoter promoted a Telegram operator-capture task from blocked to backlog while its task body still records missing proof. Open DLQ debt is visible but already covered by an existing runtime-health backlog task.

Evidence ids:

- artifact:2026-06-16T14-12-25-953Z-blocked-promoter-hz3mgh:blocker-actions.json
- artifact:2026-06-16T14-12-25-953Z-blocked-promoter-hz3mgh:steps/promote-deterministic.json
- task:task-publish-kota-telegram-production-deploy-artifact
- git:commit:a0689e3c419e:file:1
- git:commit:a0689e3c419e:file:2

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused blocked-promoter test with a partial operator-capture directory keeps the task blocked and refreshes instructions; a complete capture fixture promotes it; validation transcript shows task queue checks pass.
