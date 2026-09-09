---
status: open
priority: p1
---
# Make blocked outcomes actionable and recoverable

## Problem

At 2026-09-09 16:38Z, four builders retain dirty sandboxes and task resources,
with no active/queued builder. Their latest stored attempts contain 36 repair
iterations. Each ends needs_attention with critic-review and cleanup-blocked.
Builder permits a blocked outcome, but critic can demand full completion instead
of reviewing whether the incomplete disposition and partial changes are safe.
Blocked-promoter checks capture filenames/extensions, not successful outcomes.
Decomposer's terminal-failure input does not cover a preserved suspended writer.

Owning paths: autonomy/workflows/builder/prompt.md; autonomy/critic.ts;
repo-tasks/blocked-precondition.ts; repo-task-mutation-boundary.ts;
core/workflow/runtime-runs-control.ts; autonomy issue reconciliation/decomposer.

## Desired Outcome

Make one coherent disposition distinguish unfinished implementation, hard task
dependency, unavailable capability/evidence, and contradictory acceptance.
An agent resolves intent and stale requirements using the actual contract,
repository and scoped evidence; code enforces authority and honest publication.
Critic separately judges completed work and a safe incomplete disposition.
Blocked must never automatically approve broken or unsafe partial code.

Use existing task mutation, issue reconciliation, runtime probes, preservation
and same-run recovery. Automatically collect evidence through already authorized
capabilities; do not require a human to execute an otherwise permitted command
or put a transcript in one ceremonial directory. Conversely, sandbox denial is
not proof that the host lacks credentials, tools or evidence. Scope-authorized
exports/probes must not expose raw secrets or grant candidate code host authority.
Capture discovery is not acceptance: inspect outcome, provenance and required
positive/negative behavior before promotion. Only a relevant contract, evidence,
capability or dependency change should restart a failed attempt.

## Current Cases To Resolve

- qj0mm4, continuation: 21 repairs. Pin the latest-200 calibration cohort at
  assessment time instead of chasing a moving window. The August 14 6.47-hour
  trajectory exists with 14 repairs; try authorized scoped evidence access
  before requesting export. Separate replayed decision correctness from an
  unprovable counterfactual claim about hours saved; report missing trajectories.
- hjhox7, verification closure: the retained candidate already removes the
  retired-anchor contradiction. Preserve that correction and the owner's 70%
  baseline/goal. Latest critic measures only 14.506% reduction: this is real
  implementation/audit work, not merely a /bin/ps permission wait. Decompose
  coherent remaining ownership work through the existing task mechanism if needed.
- 720nnv, database confinement: actual Linux child boundary proof is missing.
  Argument inspection is insufficient; use synthetic data to prove denial of
  database and late journals while permitted repo/artifact reads still work.
- un8vlq, browser persistence: disabling all saves is containment, not a secure
  persistence implementation. Keep that implementation work explicit.
- Eight existing blocked evidence tasks: distinguish permission already granted,
  unavailable execution capability, real provider prerequisite and missing result.
  Use current eval isolation contracts, not obsolete host-default recipes.

## Constraints

Do not invent another issue queue, worker, task state, retry counter, or evidence
protocol. Preserve run IDs, diffs and resource lineage. Do not silently rewrite
admitted contracts or enqueue an ordinary mutator against another retained owner.
Route safe contract reconciliation through the owning recovery operation.
Never weaken sandboxing, invent a pass, drop the 70% goal, or request broad
credentials. This task is independent of the held tasks and can execute now.

## How We Will Know

Use representative existing scenarios for safe blocked publication, unsafe
partial-change rejection, stale-contract reconciliation and unchanged-blocker
restraint. In live evidence, each of the four retained runs gets a truthful
disposition through its owner; relevant changes resume the same lineage without
duplicate tasks or sandboxes. Record which blockers were actually removed and
which concrete external prerequisite remains. New files alone cannot promote
the eight blocked evidence tasks or claim their live acceptance passed.