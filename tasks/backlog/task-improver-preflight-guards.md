---
id: task-improver-preflight-guards
title: Add preflight lint/test guards to the improver workflow
status: backlog
priority: p2
area: workflow
summary: The builder workflow checks lint and tests before spending agent budget, but the improver workflow goes straight to the agent step. Adding the same preflight guards to improver prevents burning budget when the baseline is already broken.
created_at: 2026-03-27T19:00:00Z
updated_at: 2026-03-27T19:00:00Z
---

## Problem

The builder workflow runs `preflight-lint` and `preflight-test` steps before the `build` agent step. This fails fast when the codebase is already broken, avoiding wasted agent budget. The improver workflow has no equivalent guard — it always runs the `improve` agent step regardless of baseline lint or test health.

When a builder run leaves the codebase in a broken state (rare but possible), the next improver run wastes budget trying to improve a broken baseline rather than failing fast and surfacing the problem.

## Desired Outcome

The improver workflow runs preflight lint and test steps before the `improve` agent step, mirroring the builder's pattern. If the baseline is broken, the improver step is skipped and the failure is visible in the run log.

## Constraints

- Mirror the builder's preflight pattern (`preflight-lint`, `preflight-test`) rather than inventing a new approach.
- Preflight failures should produce a clear skip (not an error) for the `improve` step.
- Do not change the improver's trigger logic or verification steps.

## Done When

- The improver workflow includes `preflight-lint` and `preflight-test` steps before `improve`.
- A broken baseline causes the `improve` step to be skipped, not failed.
- `npm run typecheck` and `npm test` pass.
