---
id: task-split-oversized-a2a-push-notification-config-test-
title: Split oversized A2A push notification config test surface
status: done
priority: p3
area: modules
summary: The authenticated A2A callback security fix passed, but its builder source-size advisory records src/modules/a2a-channel/push-notification-configs.test.ts at 321 lines after 60 changed lines. Existing ready split tasks cover other test surfaces, so split cohesive push-notification config scenarios or helpers without changing A2A behavior.
created_at: 2026-06-22T06:09:55.426Z
updated_at: 2026-06-22T06:15:49.930Z
---

## Problem

The authenticated A2A callback security fix passed, but its builder source-size advisory records src/modules/a2a-channel/push-notification-configs.test.ts at 321 lines after 60 changed lines. Existing ready split tasks cover other test surfaces, so split cohesive push-notification config scenarios or helpers without changing A2A behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T06-04-00-345Z-progress-reviewer-upsely.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T06-04-00-345Z-progress-reviewer-upsely.

review verdict: needs-steering
review summary: Needs one narrow p3 maintainability follow-up. Balance: Product 0, Safety 2, Platform 4, Meta 0, Unclassified 13. The two A2A Safety fixes landed with successful builder and monitor evidence, but one successful build left an untracked source-size warning for the A2A push-notification config test surface.

Evidence ids:

- run:2026-06-22T05-39-20-986Z-builder-9fm5ko
- artifact:2026-06-22T05-39-20-986Z-builder-9fm5ko:source-file-size-review.json
- task:task-split-oversized-a2a-channel-route-test-surface
- task:task-split-oversized-cli-and-daemon-client-test-surface

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts show src/modules/a2a-channel/push-notification-configs.test.ts no longer triggers the 300-line source-size guideline, or a narrow justified exception is recorded; focused A2A push-notification config tests pass; typecheck, lint, and validate-tasks pass.
- 2026-06-22 builder run 2026-06-22T06-09-59-064Z-builder-0lzbuq split malformed-config validation into src/modules/a2a-channel/push-notification-config-validation.test.ts. Line counts: src/modules/a2a-channel/push-notification-configs.test.ts 321 before, 185 after; new validation test 157. Focused test `pnpm test src/modules/a2a-channel/push-notification-configs.test.ts src/modules/a2a-channel/push-notification-config-validation.test.ts` passed (2 files, 4 tests). `pnpm typecheck`, `pnpm lint`, and `pnpm validate-tasks` passed.
