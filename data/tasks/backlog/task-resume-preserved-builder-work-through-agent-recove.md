---
id: task-resume-preserved-builder-work-through-agent-recove
title: Resume preserved builder work through agent recovery review
status: backlog
priority: p1
area: architecture
task_class: Meta
summary: Route terminal builder worktrees with preserved changes to an agent-owned continuation that can finish, validate, merge, and disposition the original claim without operator salvage.
created_at: 2026-07-28T12:22:49.676Z
updated_at: 2026-07-28T12:22:49.676Z
---

## Problem

When a terminal builder run leaves a dirty worktree, the finalizer correctly unlocks and preserves it, but the runtime stops at a `needs-review` projection. No workflow owns that review. The original claim remains active, later builders skip the task, and a provider disconnect after useful edits requires an operator to inspect, commit, merge, resolve the claim, dismiss the DLQ, and remove the worktree by hand.

Run `2026-07-28T10-56-30-662Z-builder-nqjbz3` demonstrated the gap. Its agent completed a focused fix and validation before the provider stream disconnected. The finalizer preserved the three-path dirty worktree and the failure escalators deliberately ignored the one-off provider failure, leaving no automated continuation.

## Desired Outcome

Make preserved builder work an explicit agent-owned continuation of the existing builder lifecycle. The continuation must inspect the original task, run metadata, worktree diff, evidence, claim, and DLQ; decide whether the work is complete, needs repair, or should remain for review; and use the normal builder validation, commit, merge, claim, worktree, and DLQ disposition paths when it can finish safely.

Use the existing recovery projection as the cross-store decision source. Do not create another recovery database, duplicate the builder completion pipeline, or infer completion from elapsed time alone.

## Constraints

- Never discard dirty or conflicted work automatically.
- Never mutate an active worktree or take over a run whose process or run metadata is still active.
- Preserve the original task and run lineage in continuation metadata and recovery artifacts.
- Keep deterministic code limited to selecting a terminal preserved candidate and enforcing safety invariants; let the recovery agent judge completeness and the required repair.
- Reuse builder evidence screening, repair checks, commit, merge gate, claim release, runtime-resource cleanup, and worktree cleanup rather than adding parallel implementations.
- A provider outage may delay the continuation, but must not make the task permanently claim-blocked.

## Done When

- A failed or interrupted builder with a dirty, unlocked worktree queues exactly one recovery continuation after the terminal finalizer records preservation.
- The continuation runs in the preserved workspace and can complete or repair the existing diff through the standard builder finish protocol.
- An accepted continuation lands the reviewed commit, releases or supersedes the original claim with durable evidence, dismisses the related DLQ, and removes the now-safe worktree.
- Ambiguous or conflicted work remains preserved with a clear review artifact and no destructive action.
- Repeated completion events, daemon recovery, and provider retries do not create duplicate continuations or duplicate DLQs.
- Claim and standalone worktree projections report the same recommendation for preserved uncommitted changes.

## Source / Intent

Created from the live daemon audit on 2026-07-28 after builder run `2026-07-28T10-56-30-662Z-builder-nqjbz3` failed on a provider stream disconnect at 2026-07-28T12:14:08Z. Evidence: `.kota/runs/2026-07-28T10-56-30-662Z-builder-nqjbz3/metadata.json`, `terminal-worktree-finalizer.json`, and `workflow-state-recovery.json`.

The preserved implementation was reviewed and recovered as branch commit `4dea8cba9`, then merged into canonical main. DLQ `dlq-1069d7eb-4939-4c64-bfb5-ad93988bed84`, the stale claim, and the worktree were dispositioned through `workflow state-recovery resolve`. This task closes the remaining operator-only recovery gap exposed by that incident.

## Initiative

Agent-owned autonomous run recovery.

## Product / Safety Link

Closes a reliability blocker for P1 Safety tasks: provider failure after a security fix currently strands the fix and prevents the same task from being dispatched again until an operator manually salvages it.

## Acceptance Evidence

- A focused workflow fixture that starts from a terminal failed builder run with a dirty preserved worktree and proves one continuation finishes the standard builder pipeline.
- Recovery projection output showing no unresolved claim, stale worktree, or open related DLQ after the continuation succeeds.
- A second fixture proving conflicted or ambiguous work remains preserved and receives one review artifact without duplicate continuation dispatch.
