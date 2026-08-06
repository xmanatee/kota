---
id: task-restore-native-harness-execution-and-clear-the-cur
title: Restore native harness execution and clear the current failure cluster
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Fix or fail over from native CLI launches that cannot read legitimate project or worktree configuration, Git metadata, and task executables. Distinguish filesystem-policy defects from transient provider quota exhaustion, prevent unavailable providers from producing repeated dead letters, and resolve the current builder items through canonical redrive or dismissal.
created_at: 2026-08-05T07:42:26.080Z
updated_at: 2026-08-06T04:26:47.608Z
---

## Problem

    Fix or fail over from native CLI launches that cannot read legitimate project or worktree configuration, Git metadata, and task executables. Distinguish filesystem-policy defects from transient provider quota exhaustion, prevent unavailable providers from producing repeated dead letters, and resolve the current builder items through canonical redrive or dismissal.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-05T06-15-02-757Z-progress-reviewer-ya6eqn.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-05T06-15-02-757Z-progress-reviewer-ya6eqn.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m (kota), run-count review covering 2026-08-04T07:40:00.917Z through 2026-08-05T07:40:00.917Z. Included 20 runs, 6 tasks, 30 events, 40 artifacts, 60 git references, and 8 open dead letters across 164 evidence references. Excluded policy-pruned payloads and truncated run, event, artifact, changed-file, git, and lower-detail evidence. Task balance was Safety 3, Meta 3, Product 0, and Platform 0. Runtime and security hardening is landing, but recurring native-harness permission and quota failures continue to impair reviewer and builder throughput. Applied action: propose one local P1 recovery task; no owner decision is required.

Evidence ids:

- dead-letter:dlq-8e33b0d0-9eba-4967-b949-81900b0e8edf
- dead-letter:dlq-36d8d8b7-d08e-4b3d-9a39-46079751f4c2
- dead-letter:dlq-d0b211a0-e677-4c67-b54b-1c776eb485d2
- dead-letter:dlq-7b3dd861-026f-4116-a40a-4f0715a9c8be
- event:evtj-000000207913
- event:evtj-000000207925

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Runtime probes from both the project root and a builder worktree show that required harness configuration, Git metadata, and task executables are readable while protected credentials remain denied. Provider quota exhaustion produces bounded backoff or healthy fallback without repeated dead-lettering. All eight current open items are canonically redriven or dismissed with rationale, and subsequent progress-reviewer and builder runs complete without the cited failure signatures.

## Verified Partial Progress

The finding was valid for the cited review window. The native execution and
failure-classification portions have concrete evidence:

- Commit `1aa26b0d` restored native `scopePolicy` execution instead of rejecting
  every Codex workflow at preflight. Commit `5b68d01af` separated provider
  authentication from tool execution and retained protected-project denial.
  Commit `a6fcb8e8e` assigned the native CLI as the single machine-authority
  owner so legitimate native configuration, Git metadata, and package-manager
  executables are available without a conflicting outer wrapper.
- Project-root runs `2026-08-05T10-10-15-492Z-progress-reviewer-9mlu60` and
  `2026-08-05T10-10-15-494Z-improver-v5hu6g` completed their Codex-backed
  agent steps after the fix. The still-active builder run
  `2026-08-05T13-21-34-959Z-builder-u1pptb` supplied a linked-worktree read
  probe only: it read the ancestor Codex configuration, resolved both Git
  metadata directories, and executed the source-mode task CLI. It is not
  presented as a completed builder run.
- Native sandbox bootstrap failures classify as non-transient `runtime`
  failures; provider quota/usage-limit responses classify as `rate_limit` with
  their reset timestamp. `AgentBackoffManager` persists a minimum 30-minute
  rate-limit backoff, and the workflow queue retains but does not dispatch
  agent work while it is active, preventing repeated unavailable-provider
  dead letters.
- The runtime dismisses a transient workflow dead letter only when a later
  successful run is linked to the failed lineage, preventing unrelated success
  from hiding a real failure.

Focused verification passed 45 checks across native readable-root and ownership
behavior, Codex scope projection, runtime-versus-quota classification, bounded
backoff/queue retention, dead-letter creation, and lineage-bound supersession.
The native sandbox root test now compares physical executable identity, so the
macOS `/var` to `/private/var` alias does not create a false failure inside a
managed native run. Detailed commands and the live read probe are recorded in
this run's `artifacts/validation.txt`.

## Resolution

The operator capture now exists at
`.kota/runs/2026-08-05T13-21-34-959Z-builder-u1pptb/evidence/artifacts/root-scope-closeout-proof.json`.
It records all eight review-window DLQ ids with open-to-dismissed actions and
per-item rationales, three successful post-fix builder runs, and successful
progress review `2026-08-05T14-47-27-900Z-progress-reviewer-ajw246` with zero
open dead letters and none of the cited native-harness failure signatures.

This run also closed the remaining linked-worktree transition defect exposed
by the canonical task CLI. Builder runtime resources now declare the existing
workflow host as the repo-task staging owner. A native task move retains its
filesystem transition only when `git add` is denied specifically because the
linked-worktree index is protected; undeclared, transient, and other staging
failures still roll back. The phase-1 builder repair continues to exact-stage
only the claimed task before queue validation. Current-run verification and
the live ready-to-doing-to-done transcript are recorded in
`.kota/runs/2026-08-06T03-13-33-350Z-builder-6grbwn/evidence/artifacts/validation.txt`.
