---
status: open
priority: p1
---
# Make automation continuation evidence driven and priority aware

## Current Contract

Reopened under the September 12 owner waiver: use available scoped trajectories
and supported lifecycle probes, not an exact 200-run export or prescribed directory.
Missing historical snapshots are non-gating calibration follow-up; completion-only
records cannot prove decision correctness or counterfactual hours saved. Keep
preserve-yield/resume, checkpoint-failure and integration-observability proof.
Run qj0mm4 has published `13b64d459` and released its resources/sandbox; the
historical access limitation below is not a retained claim or a new credential need.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

During the 61-hour Codex-backed run from 2026-08-13 through 2026-08-15,
builders occupied the only agent slot for about 57 hours and recorded roughly
994 million input tokens. Three individually useful builders lasted about 9.0,
9.6, and 6.5 hours. One P1 run remained active after a P0 runtime defect had
been proven, because an active builder has no way to checkpoint and yield.

This is not a timeout defect. `agent-policy.test.ts` intentionally requires
unbounded builder turns and repair attempts, while `repair-loop.ts` stops only
after three identical no-progress states. A sequence of changing failures,
diffs, or verification commands can therefore continue indefinitely even when
the remaining work should be decomposed, preserved for later, or temporarily
yielded to more urgent work. The current signals prove activity, but no owner
decides whether another iteration remains the best use of the single agent
slot.

## Desired Outcome

Give any long or expanding agent run one evidence-based continuation decision.
Normal productive runs remain uninterrupted. When accumulated run evidence
shows repeated repair, material scope expansion, unresolved acceptance
criteria, or newly available higher-priority work, a capable agent receives a
compact packet of the task contract, current diff, verification trajectory,
remaining failures, and queue priorities. It decides to continue, decompose,
preserve and yield, or escalate a genuinely ambiguous decision.

A yield is a first-class resumable transition: the runtime-owned sandbox,
task resource, agent evidence, and exact next action remain durable, the agent
slot becomes available, and later continuation resumes the same run lineage
rather than starting duplicate work.

## Constraints

- Do not add a hard elapsed-time, token, cost, turn, or repair-attempt cap.
- Do not invoke another reviewer after every repair iteration or on a fixed
  cadence. Reuse the repair trajectory and queue revision already available,
  and request judgment only when that evidence creates a new decision.
- Keep one continuation authority in the universal run lifecycle. Do not add a
  watchdog, parallel scheduler state, or a second recovery queue.
- Never discard unpublished work or release the task resource before durable
  attention evidence exists. A failed checkpoint must leave the run owning its
  sandbox.
- P0 Safety or runtime work may justify a yield, but priority alone must not
  abort a healthy nearly-complete run. The decision must cite concrete progress
  and remaining-risk evidence.
- Task decomposition must retain the original product intent, dependencies,
  and acceptance evidence and must deduplicate against existing tasks.

## Done When

- Run metadata exposes one concise continuation packet and a typed
  decision: `continue`, `decompose`, `preserve-yield`, or `needs-owner`.
- A normal agent run with fresh verification progress completes without an extra
  AI call or lifecycle transition.
- Replay available attributable historical trajectories through the candidate
  policy and record the first genuinely new continuation decision. Preserve the
  cited 9.0-, 9.6- and 6.5-hour cases as calibration targets, explicitly reporting
  unavailable snapshots; repeated unchanged evidence is a no-op.
- A fixture proves that preserved-yield frees the agent slot for newly proven
  P0 work and later resumes the same task, sandbox, resource, diff, and
  evidence lineage without duplicate publications or tasks.
- A changing-but-unproductive repair trajectory can be decomposed or preserved
  instead of running forever, while a changing-and-converging trajectory is
  allowed to continue.
- Status and run artifacts explain why the builder continued or yielded and
  distinguish that state from failure, cancellation, and integration attention.

## Source / Intent

Owner-requested productivity audit on 2026-08-16. The owner wants capable
agents trusted to finish difficult work, but not for the single agent slot to
be monopolized by mechanically changing repair iterations. The target is a
better decision with existing evidence, not a stricter resource limit.

## Initiative

Evidence-driven productive autonomy.

## Product / Safety Link

This Meta repair returns the only agent slot to higher-priority Product and
Safety work when a large builder should be preserved or decomposed, while
protecting valuable in-progress implementation from forced termination.

## Acceptance Evidence

- A pinned available run cohort comparing builder agent-hours, repair iterations,
  yielded/resumed runs, task outcomes and duplicate work where records support it.
- Focused lifecycle artifacts for normal completion, converging continuation,
  preserve-yield-resume, decomposition, and checkpoint failure.

## Live Coverage Gap, September 10

Integration repair must participate in the same evidence contract. Restored runs
`2026-09-10T02-03-15-088Z-builder-2e94l1` and
`2026-09-10T02-03-15-660Z-builder-59xofb` spawned Codex integration agents and
published successfully, but `continueRunIntegration` in
`core/workflow/run-integration-policy.ts` supplied no event/progress persistence,
set `persistSession: false`, and discarded the successful response and usage.
Process identity and eventual validation survived; an ordinary agent trajectory
was not recorded. Successful publication is not proof of complete observability.

Reuse the existing agent event/artifact mechanism for every integration conflict
and validation continuation, including errors and cancellation. Correlate it to
the original run and repair attempt; retain a concise result, verification and
usage without exposing private reasoning or credentials. Prove that monitoring
can distinguish active repair, serialized publication waiting and a genuine stall
without a separate logger, watchdog, agent protocol or workflow-specific state.

## Retained implementation and evidence, September 10

The shared integration policy now records each conflict/validation agent invocation
through the ordinary run handle under its original run. Distinct invocation ids
preserve repeated and recovered attempts; timestamped redacted streams, neutral
verification summaries, typed outcomes, and measured usage survive success,
error results, provider failures, thrown errors, and cancellation. Session
persistence is enabled when the harness supports it. An evidence initialization
failure prevents harness launch. Integration still owns validation and publication.

Workflow log inspection discovers streams before terminal step results exist;
following continues while durable integration remains active. A quiet stream must
be assessed alongside the existing publication wait and process evidence. No
new watchdog, scheduler, continuation authority, or resource cap was introduced.

Focused checks passed for repair evidence and redaction, usage aggregation,
continuation decisions, coordinator yield/resume, run retention, log following,
and the lifecycle's writer/checkpoint/integration cases. Four unrelated
read/none finalization scenarios also fail with the unmodified HEAD core files
because authority-critical fixture metadata is missing. A validation subprocess
case cannot run here because process supervision's `/bin/ps` call returns EPERM.
Those limitations are separate from the passing checks and do not establish
missing host capabilities.

The requested historical calibration was not established. The supplied issue export
only links this task through an unrelated September 8 recovery-state capture.
The writer inventory exposes one readable July metadata record. Targeted
canonical historical and September 10 metadata reads returned PermissionError;
the suggested calibration directory returned ENOENT. These observations neither
establish absence of the underlying historical runs nor provide the requested
cohort. No historical decision correctness, latest-200 comparison, or
counterfactual agent-hour savings is claimed.

Evidence for this retained attempt is under
`.kota/runtime/2026-09-02t01-15-20-966z-builder-23282ba73a7cf12e43e230520e1b8868eb2e3d1e7fe94b7419a2eb5bed232770/agent/`:
`integration-observation-transcript.txt` renders a controlled harness through the
production integration policy, run store, and CLI log renderer;
`continuation-evidence-access.json` pins the inspected evidence inventory and
access outcomes; `baseline-lifecycle-validation.txt` records the unchanged-code
comparison; `verification.md` records proof selection and remaining limitations.
The controlled inspection fixture is not a live canonical-runtime calibration;
the current contract distinguishes usable proof from unobserved history.
