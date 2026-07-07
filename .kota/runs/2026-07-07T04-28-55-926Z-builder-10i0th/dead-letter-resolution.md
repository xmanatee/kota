# Source-To-Decision Builder DLQ Recovery

## Cited Item

- `dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0`
  - Canonical status during this run: `open`
  - Failed run: `2026-07-07T03-24-23-872Z-builder-bfdsot`
  - Claimed task: `task-add-source-to-decision-coverage-report-for-agent-r`
  - Failure: `autonomy-change-decision`

## Root Cause

The failed builder wrote `autonomy-change-decision.json` to the agent run
directory inside its task worktree:

`.../.worktrees/task-add-source-to-decision-coverage-report-for-agent-r-2026-07-07t03-24-23-872z-builder-bfdsot/.kota/runs/2026-07-07T03-24-23-872Z-builder-bfdsot/`

The builder repair check read from the canonical workflow run directory instead:

`/Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/2026-07-07T03-24-23-872Z-builder-bfdsot/`

That canonical directory did not contain the decision artifact, so the repair
loop dead-lettered even though the agent had produced the required file.

## Repair

`src/modules/autonomy/workflows/builder/repair-checks.ts` now passes
`builderAgentRunDir(ctx)` to `checkAutonomyChangeDecisionForRun`, matching the
run directory exposed to the builder agent and used by success criteria and
commit-message checks.

Regression coverage in
`src/modules/autonomy/workflows/builder/workflow-repair-checks.test.ts` creates
a staged material autonomy change, writes `autonomy-change-decision.json` only
under the agent run directory, and verifies the repair check passes.

`autonomy-check-reproduction.txt` records the original failure shape:

- repaired agent-run-dir lookup: `OK: autonomy-change-decision.json covers 1 material autonomy file(s)`
- old canonical-run-dir lookup: missing artifact for `src/modules/autonomy/report/source-decision-coverage-matching.ts`

## Remaining Canonical State

The root cause is fixed in this worktree, but the canonical runtime state is
outside this builder sandbox's writable roots:

- `claim-release-attempt.json` shows `releaseTaskClaim` for
  `task-add-source-to-decision-coverage-report-for-agent-r` failed with `EPERM`
  opening the canonical active claim file.
- `dlq-redrive-simulation-attempt.json` shows canonical `kota workflow dlq
  redrive --simulation` reached the workflow CLI but failed with `EPERM`
  opening `.kota/dead-letter-queue/items.json.tmp`.
- `canonical-dead-letter-open-item.json` preserves the still-open DLQ item.

The task is therefore blocked on operator-captured canonical mutation evidence,
not marked done from a worktree-local fix alone.
