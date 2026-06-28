---
id: task-resolve-harness-parity-scenario-loader-diagnostics
title: Resolve harness-parity scenario loader diagnostics
status: ready
priority: p3
area: modules
summary: Builder run 2026-06-28T23-20-45-779Z-builder-83fehs closed the confirmed scenario-id containment issue, but its post-build diagnostics still report missing observability evidence for src/modules/harness-parity/scenario.ts and source-size advisories for scenario.ts and scenario.test.ts.
created_at: 2026-06-28T23:37:17.900Z
updated_at: 2026-06-28T23:37:17.900Z
---

## Problem

Builder run 2026-06-28T23-20-45-779Z-builder-83fehs closed the confirmed scenario-id containment issue, but its post-build diagnostics still report missing observability evidence for src/modules/harness-parity/scenario.ts and source-size advisories for scenario.ts and scenario.test.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T23-33-56-119Z-progress-reviewer-mebdfr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T23-33-56-119Z-progress-reviewer-mebdfr.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 15. The reviewed KOTA batch landed the security fix with successful downstream monitors, no open dead letters, no owner questions, and no operator-journey risks, but the latest builder left untracked observability and source-size diagnostics on the harness-parity scenario loader.

Evidence ids:

- run:2026-06-28T23-20-45-779Z-builder-83fehs
- git:commit:b8e6319e62f4
- task:task-security-review-harness-parity-accepts-requested-s

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A recheck artifact shows the observability-obligation diagnostic has no missingFiles for src/modules/harness-parity/scenario.ts, and before/after line counts or a narrow typed source-size cleanup exception cover src/modules/harness-parity/scenario.ts and scenario.test.ts. Focused harness-parity scenario and operations tests, typecheck, and validate-tasks pass.
