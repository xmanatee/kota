---
id: task-recover-stale-builder-claim-blocking-the-daemon-ba
title: Recover stale builder claim blocking the daemon-backed TUI task
status: ready
priority: p1
area: workflow-runtime
task_class: Meta
summary: Recent builder dispatches found the P1 daemon-backed TUI task actionable but skipped it because task-replace-readline-navigator-with-a-real-daemon-back is still claimed by builder run 2026-07-06T15-29-18-209Z-builder-njj4hw. That referenced build was interrupted, so release, expire, or correctly resume the stale claim and let the task be retried.
created_at: 2026-07-06T18:08:22.341Z
updated_at: 2026-07-06T18:08:22.341Z
---

## Problem

    Recent builder dispatches found the P1 daemon-backed TUI task actionable but skipped it because task-replace-readline-navigator-with-a-real-daemon-back is still claimed by builder run 2026-07-06T15-29-18-209Z-builder-njj4hw. That referenced build was interrupted, so release, expire, or correctly resume the stale claim and let the task be retried.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-06T18-04-40-124Z-progress-reviewer-j2c2j6.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-06T18-04-40-124Z-progress-reviewer-j2c2j6.

review verdict: needs-steering
review summary:

    Scope 8nrg1m/kota included 20 runs, 15 tasks, 28 events, 40 artifacts, and 60 git refs. Balance is Safety 4, Product 3, Platform 1, Meta 7. Security work is tracked and prior webhook diagnostics are resolved, but a stale builder claim is blocking the P1 daemon-backed TUI task, so one recovery follow-up is needed.

Evidence ids:

- task:task-replace-readline-navigator-with-a-real-daemon-back
- run:2026-07-06T17-22-34-577Z-builder-zos2wu
- artifact:2026-07-06T17-22-34-577Z-builder-zos2wu:task-claim.json
- run:2026-07-06T17-54-22-700Z-builder-m131hk

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A recovery artifact or builder run shows the active claim for task-replace-readline-navigator-with-a-real-daemon-back was released, expired, or resumed from a live run; a subsequent builder claim step no longer reports all candidate tasks are claimed for that task and either starts the build or records a deliberate non-stale skip; task validation passes.
