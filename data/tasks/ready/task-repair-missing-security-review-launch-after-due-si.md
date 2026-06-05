---
id: task-repair-missing-security-review-launch-after-due-si
title: Repair missing security-review launch after due signal
status: ready
priority: p1
area: autonomy
summary: Investigate why dispatcher emitted a high-risk `autonomy.security-review.due` signal but no newer `security-review` run appears afterward, then fix the routing, cooldown, scope filtering, or dispatch behavior that prevented launch.
created_at: 2026-06-05T20:32:31.143Z
updated_at: 2026-06-05T20:32:31.143Z
---

## Problem

Investigate why dispatcher emitted a high-risk `autonomy.security-review.due` signal but no newer `security-review` run appears afterward, then fix the routing, cooldown, scope filtering, or dispatch behavior that prevented launch.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-05T20-20-53-772Z-progress-reviewer-w3ky9h.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-05T20-20-53-772Z-progress-reviewer-w3ky9h.

review verdict: needs-steering
review summary: KOTA is making useful autonomous progress, but workflow health is not fully recovered: the improver failure path was repaired, while progress-reviewer still has an open P1 repair task and a due security-review signal appears not to have launched a newer security-review run.

Evidence ids:

- run:2026-06-05T20-07-46-967Z-dispatcher-syoiyn

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A focused test or run artifact showing a dispatcher due signal enqueues/runs `security-review`, plus a fresh run artifact where the due high-risk change is followed by a `security-review` run.
