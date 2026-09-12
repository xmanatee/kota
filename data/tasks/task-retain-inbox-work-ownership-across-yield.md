---
status: open
priority: p1
---
# Retain inbox work ownership across yield and resume

## Current Contract

Reopened under the September 12 owner direction for implementable safe cleanup
and inbox progress. The shared priority/work-supply fix is intended to release
the current inbox yield; its activation and resulting live progress are not yet
claimed here. Validate the owning behavior with available supported proof and
report unperformed checks honestly. No operator-capture ritual or control of the
launching daemon is required to finish independently validated implementation.

This contract supersedes historical blocking and operational-capture requirements.


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

Finish safe missing-worktree disposition through the existing cleanup/recovery
owner. Use attributable branch, artifact and publication evidence to distinguish
settled work from ambiguous retained work; missing files or an empty historical
snapshot alone do not authorize cleanup. Reuse the shared priority and inbox
work-supply owners rather than duplicating their admission rules.

## Acceptance

- Repeated equivalent events before/after yield and daemon restart retain one
  durable work owner, while unrelated scopes/tasks use available capacity.
- Clearing a real yield prerequisite resumes that identity and useful retained
  work, sorts the capture once, validates/publishes through normal integration,
  releases resources and permits subsequent captures. Unchanged blocked work
  must not consume repeated agent decisions merely because cooldown elapsed.
- Validate missing-worktree disposition at the owning cleanup/recovery boundary:
  verified settled work can receive a durable disposition, while ambiguous or
  dirty work stays preserved. Reuse the completed reconciliations below; never
  forge a checkout, rewrite the database or relax ownership checks.
- Use proportionate supported admission/yield/recovery and cleanup/progress proof.
  Actual legacy-run reconciliation and live publication after activation remain
  runtime-owned operational follow-up, not this builder's completion gate.
  Preserve the original capture and owner-authored task edits throughout.

## Retained implementation

Inbox-sorter now declares one scope-local `autonomy:inbox-triage` resource.
Existing runtime ownership holds it across yield/restart and releases it only
through normal completion or cancellation. The shared latest-observation queue
keeps one pending successor, which cannot start or allocate a replacement
checkout while the original owner holds the resource. Other scopes and task
resources remain independent. New captures remain pending for fresh inspection;
normal integration reconciles retained changes with current published intent.

Focused proof covers workflow binding; event coalescing before/after yield and
restart; no cooldown-based retry of an unchanged wait; scope isolation; priority
blocker completion; retained checkout adoption; preservation of a new capture
and owner correction at integration; single publication and checkout cleanup;
and successor eligibility after success/cancellation. Run evidence is under
`2026-09-11T15-54-55-003Z-builder-cfxg15` (including test logs and
`reconciliation-assessment.json`). No capture or other task contract was edited.

## Observed Reconciliation And Follow-up

The declaration integrated as `c90520e42` and activated on September 11.
The September 12 operator inventory verified twelve resource-less, yielded
checkouts with zero tracked/untracked changes and zero commits beyond their
recorded bases. Normal `DELETE /workflow/runs/:id` cancellation returned 200
for each: x46pe9, 0s3tlk, ouquva, z6hbly, xh5md8, y9vsax, uqksrf, rueqdh,
lptjyr, 5j8bez, 43h32l and p4o7u8. Their September 11 durable run records now
show cancelled, no resources and removed worktrees; artifacts remain retained.
No direct database edits or manual Git deletion were used.

The original jkdwsr run already lacked its recorded worktree. Its continuation
snapshot contains no changes, but that alone cannot establish present branch
disposition. Normal cancellation returned 409 and preserved it as
needs_attention with missing-sandbox evidence. Resolve that disposition through
the existing recovery owner using actual branch/artifact evidence, not a forged
checkout or relaxed cancellation guard.

Keep `2026-09-11T16-44-52-830Z-inbox-sorter-udfvtw`, which uniquely owns
`scope:8nrg1m:autonomy:inbox-triage`, and its single queued successor y4pewi.
Repeated dispatcher observations update that successor without allocating a
new checkout. Live retained resume, inbox publication, release and subsequent
capture admission remain runtime-owned follow-up, not proven by cleanup alone.
The original capture and all dirty unrelated work remain untouched.

The builder's earlier scoped export covered only two runs and could not expose
host inspection/cancellation. The operator evidence above supplies the broader
inventory without giving candidate code daemon credentials or raw database
access. Consume attributable runtime exports, not repeated unchanged retries.

The static gate passed. Local behavior suites also expose execution restrictions:
one existing inbox scenario cannot launch its validator because `/bin/ps` is
denied; two process-tree restart cases report `spawn-failed`. These proofs need
an execution environment supporting the existing subprocess inspection contract;
no production guard or test expectation was weakened to conceal the failures.
