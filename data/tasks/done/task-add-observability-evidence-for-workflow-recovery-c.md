---
id: task-add-observability-evidence-for-workflow-recovery-c
title: Add observability evidence for workflow recovery command hints
status: done
priority: p2
area: modules
task_class: Platform
summary: Builder run 2026-07-08T07-22-16-062Z-builder-8lne6o landed source-mode workflow recovery hints, but its run summary reports an observability-obligation warning for runtime-sensitive changes in src/modules/workflow-ops/state-recovery-command.ts.
created_at: 2026-07-08T08:06:33.999Z
updated_at: 2026-07-08T08:11:38.666Z
---

## Problem

    Builder run 2026-07-08T07-22-16-062Z-builder-8lne6o landed source-mode workflow recovery hints, but its run summary reports an observability-obligation warning for runtime-sensitive changes in src/modules/workflow-ops/state-recovery-command.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-08T07-45-15-471Z-progress-reviewer-1kuc1k.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-08T07-45-15-471Z-progress-reviewer-1kuc1k.

review verdict: needs-steering
review summary:

    Balance is Safety 5, Product 3, Platform 5, Meta 7. Recent monitored workflows are completing and the new security finding is already queued, but steering is needed because the latest builder run left an unresolved observability-obligation warning and existing builder/provider owner questions remain pending.

Evidence ids:

- run:2026-07-08T07-22-16-062Z-builder-8lne6o
- git:commit:f56f7f24d20f
- task:task-make-generated-workflow-recovery-commands-use-a-ru

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up run artifact or focused test maps src/modules/workflow-ops/state-recovery-command.ts to structured logging, explicit error-result evidence, focused assertions, or a narrow waiver rationale; the observability-obligation diagnostic no longer lists that file as missing; focused workflow-ops/state-recovery tests and validate-tasks pass.

- Builder follow-up evidence (2026-07-08T07-45-38-648Z-builder-lh87x1):
    - `src/modules/workflow-ops/state-recovery-command.test.ts` now has an explicit diagnostic-evidence assertion covering the source-mode and package command strings exposed by `src/modules/workflow-ops/state-recovery-command.ts`.
    - `.kota/runs/2026-07-08T07-45-38-648Z-builder-lh87x1/observability-obligation-rationale.json` records the narrow rationale for using focused assertions instead of extra production logging/events in this deterministic command formatter.
    - `.kota/runs/2026-07-08T07-45-38-648Z-builder-lh87x1/observability-obligation-review.json` records an `ok` observability-obligation diagnostic with no missing files after the follow-up diff.
    - `.kota/runs/2026-07-08T07-45-38-648Z-builder-lh87x1/focused-test-transcript.txt` records the focused state-recovery test run: 5 files passed, 14 tests passed.
    - `.kota/runs/2026-07-08T07-45-38-648Z-builder-lh87x1/validate-tasks.txt` records `pnpm run validate-tasks` passing.
