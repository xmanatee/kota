---
status: done
---

# Security review: The decomposer does not bind the triggering failed run, claim artifact, current task, and active pending-decomposition claim into one ownership check before mutating canonical task state. A forged, traversing, or stale trigger/run artifact can therefore select a current task with the same id and make the decomposer create subtasks and drop it even when the failed builder run no longer owns that task.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/decomposer/assessment.ts
claim:

> The decomposer does not bind the triggering failed run, claim artifact, current task, and active pending-decomposition claim into one ownership check before mutating canonical task state. A forged, traversing, or stale trigger/run artifact can therefore select a current task with the same id and make the decomposer create subtasks and drop it even when the failed builder run no longer owns that task.

## Desired Outcome

> Canonicalize the source exclusively as .kota/runs/<validated-runId>, reject traversal and mismatched runDir, and validate metadata id, workflow, status, and canonical run directory. Before planner dispatch and again before apply-decomposition, require an active builder claim for the same task with status pending-decomposition and runId equal to the failed run; verify the artifact against that authoritative claim and reject missing, stale, or mismatched ownership. Add regressions for traversing runDir values, forged artifacts, replayed old failures after task replacement, missing claims, and a different builder run's pending-decomposition claim.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-06T11-39-01-012Z-security-review-6w0q2w.

finding id: decomposer-unbound-run-claim-confused-deputy
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/decomposer/workflow.ts:56
verdict: confirmed
rationale:

> resolveSourceRun accepts unvalidated runDir/runId values, and buildAssessment reads metadata and task-claim artifacts without enforcing the canonical .kota/runs/<runId> identity. The artifact validator checks only task-binding shape; it does not authenticate runId, workflow, status, active claim ownership, or compare its recorded snapshot with the reopened current task. apply-decomposition mutates and drops that current same-id task before finalize-source-claim, which accepts a missing claim or any builder pending-decomposition claim regardless of runId. The workflow test explicitly permits superseding a newer builder run's claim.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/decomposer/assessment.ts

line: 78

excerpt:

> resolveSourceRun accepts payload.runDir and payload.runId as arbitrary non-empty-typed strings and returns them without requiring runDir to equal the canonical .kota/runs/<runId> path or remain beneath the runs directory.

Evidence 2:

path: src/modules/autonomy/workflows/decomposer/assessment.ts

line: 118

excerpt:

> isVerifiedClaimBinding checks only the artifact's schema number, task id/path shape, and numeric snapshot fields; it does not compare the artifact with the active claim store or authenticate its runId and workflow ownership.

Evidence 3:

path: src/modules/autonomy/workflows/decomposer/assessment.ts

line: 177

excerpt:

> The selected metadata is cast from JSON and classified solely from its build-step failure; metadata.id, metadata.workflow, metadata.status, metadata.runDir, and the trigger's source identity are not cross-checked.

Evidence 4:

path: src/modules/autonomy/workflows/decomposer/assessment.ts

line: 201

excerpt:

> After extracting only candidateId from the artifact, findTaskById reopens whichever doing, blocked, or ready task currently has that id; the claim's recorded file snapshot and state are not compared with that current task.

Evidence 5:

path: src/modules/autonomy/workflows/decomposer/workflow.ts

line: 167

excerpt:

> finalizeSourceClaim accepts a missing claim and, when one exists, checks status and workflowId but not claim.runId against assessment.failedRunId; mutation and commit have already occurred before this ownership check runs.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/autonomy/workflows/decomposer src/modules/eval-harness/fixture-templating.test.ts` — 8 files and 45 tests passed, including canonical run-path, metadata, forged artifact, replaced-task, missing-claim, different-run claim, pre-apply ownership, materialized file-identity, and valid-claim symbolic-link regressions.
- `pnpm test src/modules/eval-harness/replay-smoke.test.ts -t "replays decomposer-agent-call-replay"` passed the production subprocess path through assessment, both agent steps, mutation, commit, and exact claim finalization.
- `pnpm build`, `pnpm typecheck`, changed-file Biome checks, the instruction-size guard, and `pnpm kota workflow validate` (29/29 definitions) passed. A full-suite retry reached 12,574 passing tests and exposed one instruction-cap issue that was fixed; the other 223 failures were restricted-runner `EPERM` denials for loopback, the tool-runtime parent, and the policy-denied Telegram env example rather than failures in the changed surfaces.
- Post-check repair replaced the impossible preserved-inode assumption with exact source-content and transition-stable task-contract digests. A production `claimTask` + `moveTaskById` regression proves `ready/` → `doing/` changes the inode while retaining ownership; same-path replacement and any non-canonical or contract-changing move still fail closed. The 40-test decomposer suite, 18 focused claim tests, production subprocess replay, build, typecheck, changed-file Biome checks, strict-types/task-file/instruction guards, and all 29 workflow definitions passed.
- Repair attempt 3 made the linked-task regression non-vacuous: its run artifact and authoritative pending-decomposition claim now carry identical valid content/contract digests, and the test asserts rejection by the no-follow symbolic-link guard before sibling content can reach an agent. `pnpm test src/modules/autonomy/workflows/decomposer` passed all 40 tests.
