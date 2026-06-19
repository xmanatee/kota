# Dead-Letter Resolution

Resolved task: `task-resolve-open-health-reviewer-and-security-review-d`

## Root Cause

- `dlq-3dee14c8-48ca-4e91-bcd9-f8e93ec5ff17` came from an autonomy-health-reviewer run that created `task-health-workflow-improver-interrupted-run.md` before the task file had the required `## Initiative` section and before it was staged/tracked.
- `dlq-36859e8d-b4d9-474d-a4e6-66593913c382` came from security-review `investigate-candidates` seeing `data/tasks/ready/task-health-workflow-improver-interrupted-run.md` appear during its pre/post write-scope snapshot and attributing that concurrent task-file creation to the scoped `security-reviewer` agent.

## Repair

- `src/core/workflow/runtime-dispatch-concurrency.ts` now treats explicit `concurrencyGroup: "agent"` on code-only workflows as an exclusive agent slot. Such workflows wait for active agent workflows and block new agent workflows while they run.
- `autonomy-health-reviewer` already declares `concurrencyGroup: "agent"` because it can create or refresh task files; its comment and unit test now describe the exclusive behavior.
- The regression test `src/core/workflow/runtime-dispatch.test.ts` queues `security-review` `investigate-candidates`, then queues an `autonomy-health-reviewer` code-only task mutation while `agentConcurrency` is 2. The health workflow does not start until the security-review agent step releases, preventing the cited write-scope false attribution path.

## DLQ State

- `dlq-3dee14c8-48ca-4e91-bcd9-f8e93ec5ff17`: dismissed as superseded after the health task became tracked and valid with `## Initiative`.
- `dlq-36859e8d-b4d9-474d-a4e6-66593913c382`: dismissed after the scheduler repair and focused regression test.
- `pnpm dev workflow dlq list --status open --json` reported `open=0`, `dismissed=25`, `redriven=0`.

## Evidence

- `dlq-3dee14c8-before-dismissal.json`
- `dlq-3dee14c8-after-dismissal.json`
- `dlq-36859e8d-before-dismissal.json`
- `dlq-36859e8d-after-dismissal.json`
- `pnpm test src/core/workflow/runtime-dispatch.test.ts`
- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.test.ts`
