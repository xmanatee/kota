---
status: done
---

# Add merge gate and automated conflict resolver for worktree runs

## Problem

Worktree-backed agents still have to merge into the real project. External
measurements show merge conflict is not rare for agentic work: AgenticFlict
reports a 27.67% conflict rate in its processed agentic PR set. If KOTA simply
commits branches and leaves merging to the user, parallel work will pile up and
lose much of its value. If KOTA merges blindly, it can corrupt the repo.

## Desired Outcome

KOTA has an integration gate for completed worktree runs:

- verify the canonical checkout is clean enough to integrate;
- fetch/rebase or merge the worktree branch onto the current base;
- detect conflicts and classify textual, binary, generated, and high-risk
  paths;
- run a bounded conflict-resolver agent only on allowed textual conflicts;
- rerun validation after every automated resolution attempt;
- fast-forward or merge into the canonical branch only after validation passes;
- leave unresolved worktrees locked, visible, and resumable.

## Constraints

- Never auto-merge over a dirty canonical checkout.
- Never delete a conflicted worktree as part of cleanup.
- Binary conflicts, repeated validation failure, high-risk generated files, and
  semantic contradictions must block with an actionable pending-merge artifact.
- Conflict resolution must be bounded by attempt count and validation, not by
  the resolver claiming success.
- Do not hide conflict markers or unresolved paths from status.

## Done When

- Completed builder worktree branches enter a merge gate before cleanup.
- Disjoint branches merge without conflict and cleanup safely.
- A textual conflict fixture invokes the resolver, validates, and either merges
  or records a pending-conflict state.
- A binary or blocked-path conflict refuses automated resolution and records
  the reason.
- Merge-gate state survives daemon restart.

## Source / Intent

The owner asked for agents to "cleanly merge into the repo/project and resolve
any conflicts." AgenticFlict's 27.67% conflict rate makes this a first-class
safety feature, not a cleanup detail:
https://arxiv.org/html/2604.03551v2

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/autonomy src/modules/git` or the nearest affected
  merge-gate tests pass.
- A fixture transcript shows one clean merge, one auto-resolved textual
  conflict with validation rerun, and one blocked conflict that remains visible
  and resumable.

Completed in builder run `2026-06-27T08-31-15-455Z-builder-qhdcq7`:

- `pnpm test src/modules/autonomy src/modules/git` passed on 2026-06-27.
- `src/modules/git/worktree-merge-gate.test.ts` covers a clean worktree branch
  fast-forward plus cleanup, a text conflict resolved by a bounded resolver
  with validation, and a binary conflict that records pending-merge state while
  leaving the conflicted worktree visible.
- Builder workflow tests cover prepared worktree runs entering `merge-gate`,
  a configured resolver plus bounded attempt budget on the production merge
  gate call, successful merge cleanup, PR creation being skipped for local
  worktree integration, and legacy non-worktree branch/PR behavior staying
  intact.
- Fixture transcript:
  `.kota/runs/2026-06-27T08-31-15-455Z-builder-qhdcq7/merge-gate-fixture-transcript.txt`.
