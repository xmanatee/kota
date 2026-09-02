---
status: blocked
priority: p1
depends_on: [task-prove-agy-builder-parity-end-to-end]
---

# Make continuous AGY autonomy quota-aware and productive

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
- The three-hour and at least one six-hour canary artifacts quantify useful
  completions, failure causes, backoff ratio, retries, review yield, instruction
  adherence, unrelated edits, and final recovery hygiene.
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

## Blocked on
```
kind: operator-capture
path: .kota/runs/agy-continuous-live-canary/agy-continuous-canary/
description: Authenticated AGY live evidence — run the continuous daemon canary with run id agy-continuous-live-canary, establish its command-captured baseline through `pnpm kota agy-canary --run-id agy-continuous-live-canary --start`, capture the first three-hour and at least one six-hour observation through the matching `--phase` commands, and retain collected run/task evidence, cited diff-scope review, provider incidents, the continue-or-pause decision, and a runtime transcript proving quota suppression and preserved-work resumption under the path above.
```

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
agent dispatch and checkpoints those runs for later review. The task remains blocked on the elapsed
authenticated live evidence required by Acceptance Evidence.
