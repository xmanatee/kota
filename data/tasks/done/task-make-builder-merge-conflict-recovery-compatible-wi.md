---
id: task-make-builder-merge-conflict-recovery-compatible-wi
title: Make builder merge-conflict recovery compatible with native-tool harnesses
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Repair builder capability routing so a merge-conflict recovery path does not dead-letter when the active codex harness advertises native rather than KOTA-routable tool control. Select a compatible resolver or fail deterministically before dispatch without weakening merge safety gates.
created_at: 2026-07-25T11:53:49.851Z
updated_at: 2026-07-25T13:00:45.118Z
---

## Problem

    Repair builder capability routing so a merge-conflict recovery path does not dead-letter when the active codex harness advertises native rather than KOTA-routable tool control. Select a compatible resolver or fail deterministically before dispatch without weakening merge safety gates.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-25T11-48-47-927Z-progress-reviewer-4qm8xv.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-25T11-48-47-927Z-progress-reviewer-4qm8xv.

review verdict: needs-steering
review summary:

    Directory scope kota (8nrg1m), task-count review of three committed builds from 2026-07-24T11:51:11.069Z to 2026-07-25T11:51:11.069Z: three Meta repairs closed with evidence, but a distinct builder harness/resolver mismatch still dead-letters and security-review remains classifier-blocked. The 20-task balance is 0 Product, 7 Safety, 2 Platform, 9 Meta, and 2 Unclassified; no operator-journey risks were reported. Evidence included 20 runs, 20 tasks, 3 events, 40 artifacts, 56 git refs, and 3 open dead letters; run and artifact collections and one commit file list were truncated as disclosed. Action: propose one builder follow-up; create no duplicate security task and ask no owner question.

Evidence ids:

- dead-letter:dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused workflow fixture configures builder with codex/native tool control and a merge-conflict recovery case, proves that a compatible resolver or deterministic safe fallback reaches a terminal non-dead-letter outcome, and retains existing routable-harness behavior. Redrive the cited dead letter to a terminal outcome or dismiss it with durable rationale.

- Candidate evidence from builder run `2026-07-25T12-37-16-777Z-builder-mxhqzo`:
  - `src/modules/autonomy/workflows/builder/merge-conflict-resolver.test.ts` creates a real divergent Git/worktree text conflict with a codex-named native-tool harness. The merge gate now returns `pending-conflict`, persists `pending-merge`, records the unsupported-tool-control attempt, and never invokes the unguardable harness.
  - The existing KOTA-routable resolver test still proves the conflict-path guard and file-tool allowlist.
  - `.kota/runs/2026-07-25T12-37-16-777Z-builder-mxhqzo/validation.txt` records 33 builder/git test files and 269 tests passing, plus clean typecheck and Biome results.
  - `.kota/runs/2026-07-25T12-37-16-777Z-builder-mxhqzo/dead-letter-disposition.json` preserves `dead-letter:dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d`, explains why stale-run redrive is not valid candidate evidence, and records the chosen dismissal. The canonical mutation was attempted through both the local client and authenticated daemon control route, but the managed filesystem and loopback-network boundaries blocked those external writes; the item was still observed as open.
  - Ready follow-up `task-dismiss-superseded-native-harness-builder-dead-let` owns the post-merge canonical dismissal and requires durable before/after evidence that the cited item no longer appears in the open builder dead-letter list.
