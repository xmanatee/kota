---
id: task-add-observability-evidence-for-harness-parity-runn
title: Add observability evidence for harness-parity runner split
status: ready
priority: p2
area: modules
summary: Builder run 2026-06-28T21-08-32-117Z-builder-p2tzx5 split the harness-parity runner successfully, but its observability-obligation diagnostic still marked runner-constants.ts, runner-files.ts, runner-trace-summary.ts, runner-trajectory-json.ts, runner-types.ts, and runner.ts as missing inspectable runtime evidence.
created_at: 2026-06-28T22:16:34.039Z
updated_at: 2026-06-28T22:16:34.039Z
---

## Problem

Builder run 2026-06-28T21-08-32-117Z-builder-p2tzx5 split the harness-parity runner successfully, but its observability-obligation diagnostic still marked runner-constants.ts, runner-files.ts, runner-trace-summary.ts, runner-trajectory-json.ts, runner-types.ts, and runner.ts as missing inspectable runtime evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T21-51-41-804Z-progress-reviewer-swyi8l.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T21-51-41-804Z-progress-reviewer-swyi8l.

review verdict: needs-steering
review summary: KOTA is making mostly successful maintenance progress: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 12, with no operator-journey risks or open dead letters reported. Steering is needed because a successful harness-parity runner split left a concrete observability-obligation warning for six runtime-sensitive files without a matching active task.

Evidence ids:

- artifact:2026-06-28T21-08-32-117Z-builder-p2tzx5:observability-obligation-review.json
- git:commit:6588cc4a8611

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up builder run or explicit run artifact maps each missing harness-parity file to structured logging, event/run-artifact evidence, explicit result, focused test assertion, or a narrow waiver rationale; the observability-obligation diagnostic reports no unresolved missing files for this change; focused harness-parity validation and validate-tasks pass.
