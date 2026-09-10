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

## Builder disposition (2026-09-09)

Partial implementation is retained: disposition-aware critic/builder guidance,
capture discovery separated from acceptance (including unavailable discovery),
suspended issue ownership, and atomic rejection of competing resource admissions
while preserving duplicate deliveries and same-run identity. No live blocker of
the four retained runs was proven removed, and none of the eight evidence tasks
was promoted. The owner's 70% goal and all admitted task contracts remain intact.

The required live owner inspection/recovery is unavailable in this step. Scoped
canonical run-directory enumeration returned EPERM; local CLI history is not
canonical evidence. Workflow/probe subprocess verification also encounters
spawnSync /bin/ps EPERM. This establishes execution-context limits, not missing
host credentials/tools. This writer cannot dispatch other retained owners before
integration. Existing permission does not need to be requested again.

Remaining implementation is explicit: automatic semantic capture collection and
review, relevant-change retry admission, and safe contract reconciliation through
the retained recovery owner. New files alone cannot reopen evidence work. The
ordinary terminal-failure decomposer must not contend with a suspended writer.
The four case-specific acceptance obligations in this task are still outstanding.

Proof: production/test typechecking, scoped lint, focused module and database
admission tests, and production discovery of the eight blocked task contracts.
Broader subprocess journeys and empirical critic calibration are not claimed.
Full comparison, case dispositions, commands/limitations, and discovery results
are retained in builder run 2026-09-09T16-49-09-994Z-builder-omacue agent artifacts
blocked-outcomes-summary.md and blocked-discovery.json.

## Current disposition (2026-09-10)

Reopened for the unfinished shared mechanism, not for another blind attempt at
the four retained builders. The earlier implementation and safe dispositions
remain valid, but automatic evidence collection/review, relevant-change retry
admission and retained-owner contract reconciliation are not implemented fully.
These are actionable repository changes; subsequent live acceptance must not
prevent implementing them. Do not mark this task blocked again merely because
its own candidate cannot control the launching daemon.

Reuse existing scoped runtime probes/exports, issue reconciliation, task mutation
and same-run recovery. Give investigators the narrowly authorized, read-only run
evidence they need without granting raw canonical SQLite, secrets, Docker socket
or daemon-control authority to candidate code. Carry provenance and unavailable
diagnostics, not a new evidence database/protocol. Correct publication must use
the owning resource boundary; do not enqueue an ordinary mutation against any
of the four retained owners or rewrite their admitted contracts out of band.

Host check today: Docker client/server 29.3.1 works on Linux ARM64 (16 CPUs,
about 7.65 GiB RAM); Codex CLI login is active; AGY 1.1.27 authenticated model
discovery succeeds. Existing OpenRouter credential authentication returned 200
through an operator read-only probe, while normal scope resolution found none.
Ollama answers but has zero installed models; LM Studio is not listening.
Container authentication and provider egress remain unproven. Readiness is not
a passed benchmark. Docker is already authorized; do not ask for that permission
again or reinterpret native sandbox denial as absent host capabilities.

Finish the four specific dispositions and eight evidence-task triages above.
Retries need relevant new evidence/capability/contract change; repeated unchanged
failure must not consume another repair loop. A completed task must cite actual
integration, owner-safe cleanup or intentional retention, and honest remaining
external prerequisites. Keep validation focused on these shared contracts.