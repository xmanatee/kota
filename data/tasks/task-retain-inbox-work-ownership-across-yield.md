---
status: open
priority: p1
---
# Retain inbox work ownership across yield and resume

## Problem

At 12:53 UTC on September 11, eleven `inbox-sorter` runs were `waiting` with
`preserve-yield`, all admitted from repeated `autonomy.inbox.available` events
reporting one capture. Ten retain separate clean worktrees. None owns a durable
resource in `run_resources`. The first is
`2026-09-11T04-24-48-746Z-inbox-sorter-jkdwsr`; the latest is
`2026-09-11T11-47-36-251Z-inbox-sorter-5j8bez`.

The latest continuation correctly yielded its shared slot to higher-priority
tasks, but `inbox-sorter/workflow.ts` declares only an event cooldown and no
resource ownership. New dispatcher observations admit new identities instead of
recognizing unfinished inbox work. The runtime already preserves declared
run-lifetime resources across yields, as security-review and task claims show.
Cooldown and per-event deduplication cannot establish semantic work ownership.

## Outcome and approach

Use the existing workflow resource/admission/recovery contracts to represent one
unfinished inbox-triage owner per scope, or a narrower capture identity only if
the existing workflow genuinely supports disjoint batches. Prefer the simplest
declaration fitting the current whole-inbox operation. A yielded run releases
capacity, not its unfinished work identity. Later observations must not create
replacement sandboxes for that same work.

Verify the corresponding recovery path: when the higher-priority work or other
actual yield prerequisite clears, the original run becomes eligible and adopts
its retained checkout; it refreshes inbox intent before publication. New captures
must remain discoverable, and a completed/cancelled owner must not permanently
block later inbox work. Do not replace continuation judgment with a timeout,
globally serialize writers, add an inbox scheduler/store, or grant task-specific
exceptions to the shared runtime. This is the bounded ownership gap underlying
the observed duplicate runs, not a redo of the broader continuation-policy task.

## Acceptance

- Repeated equivalent events before/after yield and daemon restart retain one
  durable work owner, while unrelated scopes/tasks use available capacity.
- Clearing a real yield prerequisite resumes that identity and useful retained
  work, sorts the capture once, validates/publishes through normal integration,
  releases resources and permits subsequent captures. Unchanged blocked work
  must not consume repeated agent decisions merely because cooldown elapsed.
- Reconcile the eleven existing runs through normal runtime cancellation or
  recovery after inspecting their current artifacts and diffs. Keep one valid
  continuation where appropriate; preserve ambiguous or dirty work. Clean
  redundant sandboxes only with recorded terminal ownership, never direct
  database rewrites, branch deletion or blanket worktree removal.
- Use focused admission/yield/recovery proof and an attributable live inventory
  showing no new equivalent runs, safe cleanup and eventual inbox progress.
  Preserve the original capture and owner-authored task edits throughout.
