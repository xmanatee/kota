---
id: task-split-oversized-a2a-channel-route-test-surface
title: Split oversized A2A channel route test surface
status: ready
priority: p3
area: modules
summary: The A2A push-notification work passed and recorded protocol evidence, but its builder run still reported src/modules/a2a-channel/routes.test.ts above the source-size guideline. Extract cohesive route scenarios or helpers into smaller focused tests without changing A2A route behavior.
created_at: 2026-06-22T04:48:51.777Z
updated_at: 2026-06-22T04:48:51.777Z
---

## Problem

The A2A push-notification work passed and recorded protocol evidence, but its builder run still reported src/modules/a2a-channel/routes.test.ts above the source-size guideline. Extract cohesive route scenarios or helpers into smaller focused tests without changing A2A route behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T03-02-14-344Z-progress-reviewer-vlg9z5.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T03-02-14-344Z-progress-reviewer-vlg9z5.

review verdict: needs-steering
review summary: Needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 4, Meta 0, Unclassified 11. The Safety and Platform work is landing with critic/evaluator checks, but the A2A push-notification completion left an oversized route-test warning with no active duplicate task.

Evidence ids:

- task:task-add-a2a-push-notification-configuration-support
- git:commit:7af8793cfaaf
- task:task-split-oversized-cli-and-daemon-client-test-surface

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts show src/modules/a2a-channel/routes.test.ts no longer triggers the source-size guideline or records a justified typed exception; focused A2A route and push-notification tests pass; typecheck, Biome, and validate-tasks pass.
