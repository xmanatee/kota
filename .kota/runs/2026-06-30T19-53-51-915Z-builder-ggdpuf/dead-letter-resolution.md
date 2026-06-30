# Progress Reviewer Write-Scope DLQ

## Cited Item

- id: `dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7`
- status before repair: `open`
- workflow: `progress-reviewer`
- failed run: `2026-06-29T17-00-00-002Z-progress-reviewer-2njdt0`
- trigger: `autonomy.progress-review.scheduled`
- failure: `review-evidence` was blamed for source edits outside `.kota/runs/`.
- cited paths: `src/modules/autonomy/workflows/builder/branch-per-task.ts`, `builder-config.ts`, `runtime-resource-cleanup-step.ts`, `runtime-resource-ports.ts`, `runtime-resources.ts`.

## Root Cause

`review-evidence` is a passive named agent with read-only tools and a `.kota/runs/`
write scope. The failed paths are builder workflow source files, so the failure
shape is false attribution from another agent workflow mutating the same
checkout during the progress-reviewer pre/post write-scope diff window.

The existing dispatch gate serialized some code-only task mutators against
active agent workflows, but it still allowed two agent workflows to share a
workspace when `agentConcurrency` was greater than one. The write-scope
pre-snapshot was also captured before the agent run limiter, so time spent
waiting for an agent slot could be included in the mutation window.

## Repair

- `AgentRunLimiter` now has a keyed exclusive lane.
- `executeAgentStep` runs named agent write-scope attribution inside the
  workspace lane: pre-snapshot, harness execution, cleanup, post-snapshot,
  trajectory artifact, and violation artifact writing.
- Repair-agent iterations use the same workspace lane.
- A runtime regression test queues a builder agent and a passive
  progress-reviewer agent against the same checkout with `agentConcurrency: 2`;
  the progress-reviewer step starts only after the builder step completes and
  does not produce `review-evidence.write-scope-violation.json`.
- Post-check repair split the SecretStore tests and trimmed the agent executor
  below the source-size guideline, reducing the staged severe source-size
  review from blocking to advisory.

## Validation

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/core/workflow/runtime-dispatch.test.ts`
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/builder/runtime-resources.test.ts src/modules/daemon-ops/operator-ui-worktree-status.test.ts src/modules/daemon-ops/status-cli-worktrees.test.ts`
- `pnpm run typecheck`
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/core/config/secrets.test.ts src/core/config/secrets-store.test.ts`
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/core/workflow/runtime-dispatch-write-scope.test.ts`
- `node --conditions=source --import tsx -e "const { checkSevereSourceFileSize } = await import('./src/modules/autonomy/source-size-escalation.ts'); console.log(checkSevereSourceFileSize(process.cwd()));"` now reports advisory warnings only.
- `pnpm exec biome check src/core/config/secrets.test.ts src/core/config/secrets-store.test.ts src/core/workflow/steps/step-executor-agent.ts src/core/workflow/runtime-dispatch-write-scope.test.ts`

## DLQ Store Status

The canonical DLQ item was read from
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`.
This sandbox can write only the task worktree and temp roots; attempts to use
normal lifecycle commands that write git/worktree state failed with
`Operation not permitted` while creating the worktree index lock. The same
permission profile does not allow this builder step to mutate the canonical
project `.kota/dead-letter-queue/items.json` store for dismissal. The source
root cause is fixed and covered; the canonical open item still needs dismissal
from an environment with canonical project-state write access.
