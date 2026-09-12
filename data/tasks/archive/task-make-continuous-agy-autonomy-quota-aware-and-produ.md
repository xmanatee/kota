---
status: done
---
# Make continuous AGY autonomy quota-aware and productive

## Current Contract

Reopened under the September 12 owner waiver to finish canary setup and validate
quota suppression, successful-empty handling, durable windows and same-lineage
recovery through available supported context. A host-owned AGY rollout and its
real 3h/6h measurements are non-gating operational follow-up, superseding the
historical elapsed-evidence block. Do not switch Codex production, start a competing
daemon, waive quality pauses or represent simulated time as an observed live window.

This contract supersedes historical blocking and operational-capture requirements.

Run `2026-09-12T06-41-03-806Z-builder-3qkc11` encountered Codex provider capacity
after making useful changes, not a rejected task outcome. Its original dirty
worktree and claim remain retained. The shared classifier now recognizes the
observed capacity response as transient provider failure. Continue that run's
work through ordinary retained recovery; do not start another task owner.
Validate the same shared backoff/defer/resume contract across provider errors:
a capacity outage must not require a changed task or critic verdict to resume
after the provider recovers. Keep semantic rejection recovery distinct from
provider retry and preserve the selected production model.


## Problem

AGY quota is work-weighted and can be exhausted by long autonomous runs. The
previous rollout repeatedly entered provider backoff after expensive builder
attempts, while scheduled reviewers and retries continued adding run volume.
A live daemon can therefore look active while spending most of its useful
window waiting, repeating the same provider incident, or restarting work that
cannot finish before the next reset.

The current backoff mechanism protects the provider but does not yet prove
that an AGY-backed fleet allocates its available quota to the highest-value
dispatchable work or that it halts when output quality is materially worse.

The 2026-08-07 canary also showed that productivity gating cannot be limited to
quota errors. Four agent workflows, including two builders, returned AGY
`SUCCESS` frames with token usage but no final text. The daemon immediately
continued dispatching related reviewers and builders, producing six open DLQs
for three duplicate fingerprints before the operator paused it. A provider can
therefore be reachable and still yield no useful autonomous work.

## Desired Outcome

Make continuous AGY operation evidence-driven. Provider reset evidence,
current queue value, preserved work, recent completion yield, and quality
signals should determine whether to continue, park work, or request operator
attention. One quota incident should suppress redundant agent dispatch while
deterministic maintenance remains available.

Ship a canary protocol that observes the first three hours, then six-hour
windows, and compares completed useful tasks, failed/retried work, provider
backoff time, unrelated edits, instruction adherence, cleanup health, and
review yield. Material regressions pause AGY autonomy and preserve state;
minor issues become deduplicated tasks while useful work continues.

## Constraints

- Do not estimate quota from token counts or hardcode Google plan limits. Use
  provider reset/error evidence and supported AGY usage signals when present.
- Do not retry agent workflows while the same provider incident is active.
- Treat repeated output-contract failures with zero useful artifacts as one
  canary incident even when the provider process reports success; do not wait
  for quota backoff before parking agent dispatch.
- Do not discard partially completed work when parking for quota recovery.
- Keep one provider-backoff source of truth shared by dispatch, status, health,
  recovery, and resume paths.
- Avoid periodic reflection runs without new evidence. Canary review should be
  triggered by a meaningful observation window or state change.
- Quality gates must detect rushed work, ignored examples/guidelines,
  unrelated edits, shallow verification, and generated debris.

## Done When

- Repeated quota failures collapse into one incident with one visible reset
  horizon and no duplicate DLQ/task/reviewer storm.
- Dispatch does not launch AGY agent work while the incident is active, but
  resumes preserved eligible work after recovery evidence.
- The canary can collect its three-hour and subsequent six-hour windows with
  useful completions, failure causes, backoff ratio, retries, review yield,
  instruction adherence, unrelated edits and recovery hygiene. Validate the
  collection/decision path in supported context; elapsed production observations
  remain rollout follow-up, not a prerequisite for finishing this implementation.
- A material quality or productivity regression pauses autonomy automatically
  through the canonical control path and records why; minor findings are
  deduplicated without stopping productive work.
- A canary that records repeated successful-but-empty AGY results stops before
  dispatching more builders, preserves one representative incident, and does
  not create duplicate DLQs for the same workflow/error fingerprint.
- Status surfaces explain whether AGY is working, quota-parked, quality-paused,
  or idle without inferring health from process uptime alone.

## Source / Intent

Owner direction on 2026-08-07: run an AGY-backed KOTA canary, inspect it after
three hours and then about every six hours, keep it running only while it makes
real progress, and halt it if it is materially worse or makes harmful changes.
The owner specifically called out Google-model rushing, unrelated edits, and
failure to read examples or guidelines as quality risks.

## Initiative

Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- `.kota/runs/<run-id>/agy-continuous-canary/{three-hour,six-hour}/` with
  machine-readable metrics, sampled run/task evidence, diff-scope review,
  provider incidents, and the continue-or-pause decision.
- A runtime transcript showing redundant dispatch suppression during quota
  backoff and preserved-work resumption after recovery.

## Status (2026-09-02 builder)

Provider and quality incidents now share one daemon-wide durable
agent-backoff record across every hosted scope, including daemon-down resume
and restart recovery; every workflow-owned agent call, including repair agents
and code-step judges, crosses that fleet gate.
Classified provider failures apply it immediately, cancel other in-flight
agent calls, and deny later calls before another harness launch. A quality
pause retains a simultaneous provider recovery horizon, so explicit operator
retry cannot release work before provider recovery. Agent work is deferred
without deleting queued runs, while deterministic workflows remain available.
Status and `/health` project the same working, quota-parked, provider-parked,
quality-paused, or idle state, with working derived only from a live harness
attempt in the selected scope. The three-/six-hour canary establishes its own
baseline, collects canonical runs, task bodies, agent-step inputs, code-step
agent prompts/outcomes, applicable instructions, deduplicated provider
incidents with retained recovery horizons, and complete published writer
diffs. Successful-empty results exhaust their owning correction retry before
becoming one fleet incident, and per-observation timestamps plus actual
dismissal times keep each canary window's retry and backoff metrics local to
that window. It advances through one initial three-hour window and
non-overwriting consecutive six-hour windows, carrying baseline-time waiting
runs, later active runs, and settled runs awaiting an incident-blocked quality
review forward so their eventual terminal and integration evidence is attributed
exactly once.
A read-only reviewer must cite the collected evidence for every settled run
before the canary can decide. Its daemon one-shot review joins the fleet gate
before sending; a newly classified provider or successful-empty failure parks
agent dispatch and checkpoints those runs for later review. That attempt did not
observe the elapsed authenticated canary windows.

## Historical disposition (2026-09-10)

AGY host authentication/model discovery now works, but no command-owned canary
baseline and elapsed observation windows were established by today's readiness
check. Production is intentionally Codex-backed; do not silently switch it or
start a competing daemon to manufacture evidence. Use the existing agy-canary
--run-id <id> --start and matching --phase commands when an authorized controlled
AGY window is arranged through the host lifecycle. Preserve 3h/6h useful-work
review, quota suppression, same-lineage recovery and continue/pause evidence.
Do not reduce elapsed acceptance to a readiness check.


## Completion under the September 12 contract

Validated the existing quota and output-contract mechanisms in supported isolated
context and documented the host-owned canary setup in
`src/modules/autonomy/AGENTS.md`. No production preset or daemon was changed.
The current scope gate is authoritative; the historical September 2 fleet-wide
wording above is retained as history, not a new cross-scope guarantee.

Extended the command-owned canary journey through an incident-blocked review,
recovery, and another six-hour window. It proves that a retained run is reviewed
and consumed once, previous evidence remains unchanged, and early or evidence-free
repeated observations do not launch another reviewer. Its clock and daemon inputs
are controlled test inputs, not observed AGY rollout measurements.

The selected owner suites passed 116 tests: canary decisions/collection and
citations; provider reset coalescing, admission suppression and durable queued
identity; successful-empty correction and pause; DLQ deduplication; priority and
same-lineage writer/session recovery; and daemon quality-control routing. The
workflow DLQ suite now controls only the external port-availability probe using
the existing allocator seam, matching the lifecycle suite. Resource allocation,
persistence, workflow execution and restart remain real. This resolved six initial
sandbox listener failures before workflow execution; it does not claim live
listener availability.

Run `2026-09-12T06-41-03-806Z-builder-3qkc11` retains
`quota-canary-validation.log`, `runtime-recovery-validation.log`,
`canary-command-help.txt`, `check-fast.log`, and `validation-summary.md` in its
agent artifacts. The static gate validates types, lint, task state and generated
client bindings. Runtime publication remains the next workflow stage.

A host-owned AGY rollout must still capture real three-hour and consecutive
six-hour observations using the documented command series. That operational
follow-up is non-gating under the current owner waiver; no live productivity,
quota-benefit comparison or model-quality result is claimed here.
