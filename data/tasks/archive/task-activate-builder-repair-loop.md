---
status: done
---

# Activate repair loop on the builder workflow's build step

Implemented by the broader validation-rails refactor: the builder's `build`
agent step now runs a repair loop with task-queue, typecheck, lint, test, and
build checks, and the older hardcoded bookkeeping path was removed.

## Problem

The builder workflow's `build` step runs the agent, then separately runs `verify-typecheck`, `verify-lint`, `verify-test`, and `verify-build` as sequential tool steps. If those checks fail, the full step is re-run as a retry with full budget. There is no tighter loop where the agent can fix a specific check failure and re-verify in the same run.

The `repairLoop` field on `WorkflowAgentStep` provides exactly this: post-step checks with automatic small repair agent runs on failure. It is already implemented in the runtime but unused in the builder workflow.

## Desired Outcome

The builder's `build` step uses `repairLoop` with the four verification checks (typecheck, lint, test, build). When a check fails after the initial build, the repair loop gives the agent a focused retry to fix only the failing check, then re-runs the checks. The full step only fails if the repair loop exhausts `maxRepairAttempts`.

## Constraints

- Activating this must not make the verify steps redundant — the existing sequential verify steps serve as the commit gate and should remain.
- `maxRepairAttempts` should start conservatively (e.g. 2) to avoid runaway repair spend.
- The repair agent prompt should be the same builder agent, not a different one.
- Do not change the commit gate logic — only a full verify pass still triggers commit.

## Done When

- The `build` step in the builder workflow has a `repairLoop` config with all four verify checks.
- A failed typecheck, lint, test, or build check triggers a repair run rather than an immediate step failure.
- The existing `verify-*` steps remain as the commit gate and are not removed.
- The builder workflow tests pass.
