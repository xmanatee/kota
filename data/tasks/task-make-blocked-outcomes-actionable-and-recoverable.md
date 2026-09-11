---
status: blocked
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
- hjhox7, retained verification work: the September 11 owner decision changes
  the initiative to a 50% minimum and 70% stretch, preserving the frozen baseline.
  Its same-id task now owns bounded publication of the retained changes; separate
  owner-sized children and `task-verify-fifty-percent-test-reduction` own the rest.
  Reconcile the old immutable admission through recovery before applying this
  revised intent. Do not demand global reduction from this one retained writer.
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
Never weaken sandboxing, invent a pass, lower the owner-approved 50% minimum,
or request broad credentials. Historical 70%-mandatory wording below describes
earlier attempts, not current acceptance. This task is independent of held work.

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

## Shared implementation and remaining live acceptance (2026-09-10, 2e94l1)

Automatic scoped collection and independent precondition review, content-based
review restraint, and runtime-owned retained builder reconciliation are now
implemented. The recovery transaction preserves run ID, sandbox and logical
resources, records the prior trigger and new dispatch identity, and rejects
unchanged semantic inputs. Builder supplies the freshly admitted canonical task.
Blocked-promoter owns its task resources and rechecks source contracts before
publication. Existing issue reconciliation requests relevant business recovery;
publication journals remain with their existing owner. No competing task,
mutator, sandbox, evidence database or host-authority exception was introduced.

The shared implementation was completed before assessing the remaining external
evidence. This disposition does not defer that implementation or infer missing
host capability from the candidate's inability to control the daemon. Exact
read-only canonical metadata observations for three established run IDs returned
EPERM. The fourth complete ID was not guessed. Current attributable live owner
outcomes remain unavailable; historical contracts are not substituted for them.

Intentional retention is the safe proposed disposition of all four owners:
qj0mm4 still needs its pinned calibration cohort and existing August 14 trajectory;
hjhox7 retains its stale-anchor correction and the 70% goal, with real work beyond
14.506% still required; 720nnv needs Linux child denial plus allowed-read proof;
un8vlq needs secure persistence beyond disabling saves. Their resources, task
contracts and diffs were left intact. No live blocker was proven removed and no
live retention/recovery/cleanup decision was fabricated.

The eight-task triage identifies six external-evidence blockers and two tasks
already open for implementation (cross-preset parity and the live rollout matrix).
No evidence task was promoted. Docker, Codex and AGY host readiness remain accepted
observations; container authentication, provider egress and actual result rows
are separate prerequisites. OpenRouter operator authentication is distinct from
scope credential resolution. Full per-task obligations and source limitations
are in the ordinary run summary.

Proof: check:fast; 111 focused owner tests; a 29-test recovery/lifecycle/builder
follow-up; and 20 final collection/critic tests. Tests use real task/state owners
and a controlled external reviewer port; they do not claim model calibration.
Broader workflow integration validation encountered spawnSync /bin/ps EPERM.
The anchored reader now handles the authorized root's OS alias while rejecting
links inside the evidence tree. Runtime-owned integration and actual four-owner
acceptance remain unmeasured.

Evidence: builder run 2026-09-10T02-03-15-088Z-builder-2e94l1, agent artifacts
blocked-outcomes-summary.md, live-owner-inspection.json, owner-tests.log,
recovery-tests.log, collection-critic-tests.log and workflow-journey.log.

## Critic repair (2026-09-10, attempt 2)

Recovery now observes task-linked scoped execution and capability exports in the
owning assessment. Unrelated activity, collection timestamps and the retained
writer's own artifacts do not admit another attempt. The blocked-precondition
reviewer now declares deny-all filesystem authority through the shared agent
launch contract, enforced by the tool and native sandbox boundaries before
publication. Task reopening remains a workflow-owned mutation after review.
These repairs do not establish the outstanding live owner outcomes above.

## Critic repair (2026-09-10, attempt 4)

Recovery fingerprints now discard execution timestamps, duration and attempt
identifiers while retaining source, isolation and result facts. An unchanged
failed execution cannot admit another builder attempt merely by running later.
Discovery-based promoter task resources remain the runtime's admitted snapshot
on restoration, including after publication changes the blocked queue. Declared
probes recheck trusted declaration provenance and executable repository source
identity before consulting cached reviews, so corrected source is collected and
reviewed again. Task-only commits do not invalidate that source identity.

The production recovery, review and SQLite queue paths pass 25 focused tests.
The broader workflow/lifecycle collection passes 18 tests, including the promoter
resource binding, while six publication journeys encounter the existing
spawnSync /bin/ps EPERM boundary. The source-tree query was also exercised
read-only against this checkout. These repairs do not establish live publication,
cleanup or the four external owner outcomes; their outstanding acceptance and
retained ownership remain as recorded above. Commands and results are retained
in this run's ordinary summary and repair-4 logs.

## Latest live owner outcomes

September 10 monitoring verified original run `720nnv` integrated `1743ee4d3`
at 18:20:12Z, published its completion, released every resource and removed its
worktree. Its task remains blocked for the real Linux confinement proof; this
is a successful safe incomplete disposition, not security acceptance.

Original run `qj0mm4` returned to `needs_attention` at 18:12:33Z. Its recovery
assessment started before coordinator task commit `76bf6d037` and retained the
old `af342f0f...` digest; canonical now has `41b708fd...`. Preflight skipped the
agent, and the post-reconciliation invariant prevented publishing retained work
against stale intent. The worktree and single task claim remain preserved.
The expensive asynchronous assessment/source-drift correction belongs to
`task-bound-recovery-evidence-collection-to-relevant-work`; do not duplicate it
or retry the unchanged stale admission. Confirm recovery against current intent
through the existing owner once the assessment is coherent.

`un8vlq` is active in its original worktree, and `hjhox7` is queued with its
original retained work. Neither has a new accepted outcome yet. Preserve the
browser persistence obligation and retained verification work; apply the current
owner-approved reduction contract rather than restoring its obsolete target.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Attributable current scoped runtime exports and owner dispositions for qj0mm4, hjhox7, 720nnv and un8vlq after the shared recovery path is integrated; prove relevant-change same-lineage recovery or explicit owner retention/cleanup, and distinguish each remaining prerequisite. Existing authorized runtime exports/probes may collect these results automatically; no new permission or ceremonial capture location is required.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-11T06:22:46.511Z -->
