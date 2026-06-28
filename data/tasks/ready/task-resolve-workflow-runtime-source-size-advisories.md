---
id: task-resolve-workflow-runtime-source-size-advisories
title: Resolve workflow runtime source-size advisories
status: ready
priority: p3
area: architecture
summary: Builder run 2026-06-28T16-33-23-932Z-builder-hooa3m completed the guarded parallel-dispatch task but left source-size advisories for src/core/workflow/runtime-runs-control.ts and src/core/workflow/runtime.ts. Split cohesive runtime helpers or record a narrow justified exception with evidence; the current ready source-size task covers different files.
created_at: 2026-06-28T17:14:39.764Z
updated_at: 2026-06-28T17:14:39.764Z
---

## Problem

Builder run 2026-06-28T16-33-23-932Z-builder-hooa3m completed the guarded parallel-dispatch task but left source-size advisories for src/core/workflow/runtime-runs-control.ts and src/core/workflow/runtime.ts. Split cohesive runtime helpers or record a narrow justified exception with evidence; the current ready source-size task covers different files.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T17-10-41-959Z-progress-reviewer-duvrnn.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T17-10-41-959Z-progress-reviewer-duvrnn.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 3, Meta 0, Unclassified 5. The monitored workflows succeeded and inspected fan-out, calibration, and security artifacts were quiet, but the latest builder run left new source-size advisories for two workflow runtime files not covered by the existing ready source-size task.

Evidence ids:

- run:2026-06-28T16-33-23-932Z-builder-hooa3m
- git:commit:ad10edb553c7
- task:task-resolve-current-source-size-advisories-from-progre

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record before/after line counts and source-file-size diagnostics for src/core/workflow/runtime-runs-control.ts and src/core/workflow/runtime.ts; each advisory is gone or has a narrow documented exception tied to the active-run reservation change; focused core workflow tests and task validation pass.
