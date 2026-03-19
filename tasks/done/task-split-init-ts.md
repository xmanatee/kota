---
id: task-split-init-ts
title: Split src/init.ts — over 300-line limit
status: done
priority: p2
area: structure
summary: init.ts is 351 lines (17% over limit). Extract project/environment detection helpers into a co-located module.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/init.ts` is 351 lines, exceeding the 300-line file size limit.
It bundles two distinct concerns: project/environment detection utilities
(`detectProject`, `detectEnvironment`, `getDirectoryOverview`) and session
warmup context assembly (`buildSessionWarmup` and its recall helpers).

## Desired Outcome

Detection utilities move to `src/project-detection.ts`. `src/init.ts` keeps
only session warmup and recall logic, dropping well under the 300-line limit.

## Constraints

- No re-export facades. All consumers update their imports directly.
- Tests must still pass with updated import paths.

## Done When

- `src/init.ts` is under 300 lines.
- `src/project-detection.ts` contains the detection utilities.
- All consumers import from the correct module.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
