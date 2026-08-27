---
status: done
---

# Prevent autonomy workflows from committing pre-existing dirty worktree changes

## Problem

Add a workflow commit hygiene guard so non-owning workflows such as security-review cannot sweep unrelated tracked dirt left by a failed builder into their own commit. The guard should detect pre-existing dirty files before action steps, stage only declared/touched paths, and fail or route to recovery when unrelated dirt is present.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-17T09-20-02-435Z-progress-reviewer-xfwu8w.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-17T09-20-02-435Z-progress-reviewer-xfwu8w.

review verdict: needs-steering
review summary: Recent activity produced useful security-review output and task progress, but the batch shows a serious autonomy commit-boundary problem: a timed-out builder left dirty work, a later builder skipped because the tree was dirty, and security-review committed a large unrelated dirty diff under a task-creation commit.

Evidence ids:

- run:2026-06-17T06-19-56-000Z-builder-3yxnid
- run:2026-06-17T09-20-01-705Z-builder-xtu3o4
- run:2026-06-17T09-20-01-930Z-security-review-csweh4
- git:commit:7305e7f558aa

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused workflow/runtime test where a failed builder leaves tracked dirt, security-review creates a task, and the commit step either stages only the security-review task path or refuses to commit with a recovery artifact; regression asserts unrelated dirty paths are not included in the security-review commit.

## Completion Evidence

- Added `WorkflowCommitPathPolicy` support in `commitWorkflowChanges`, allowing workflows to commit only paths mutated after a captured baseline.
- Security-review now captures `capture-mutation-baseline` before candidate scanning/task creation and passes that baseline into its commit step.
- Added `src/modules/autonomy/workflows/security-review/commit-hygiene.test.ts`, which starts with dirty tracked builder residue, runs security-review through the workflow harness, and asserts the resulting commit contains only the created security-review task while the builder residue remains uncommitted.
- Post-check repair: updated MCP client and workflow validation warning tests to capture terminal diagnostic stderr output instead of obsolete console spies.
- Verification: `NODE_OPTIONS="--conditions=source --import tsx" pnpm exec vitest run src/modules/autonomy/commit.test.ts src/modules/autonomy/workflows/security-review/commit-hygiene.test.ts src/modules/autonomy/workflows/security-review/workflow.test.ts` passed.
- Verification: `NODE_OPTIONS="--conditions=source --import tsx" pnpm exec vitest run src/workflow-validation.integration.test.ts src/core/mcp/client.test.ts` passed.
- Verification: `pnpm exec tsc --noEmit --pretty false` passed.
- Verification: `pnpm run lint` passed.
