---
id: task-make-continuous-agy-autonomy-quota-aware-and-produ
title: Make continuous AGY autonomy quota-aware and productive
status: backlog
priority: p1
area: autonomy
task_class: Platform
depends_on: [task-prove-agy-builder-parity-end-to-end]
summary: Use provider evidence to prevent continuous AGY operation from wasting cycles in quota backoff while preserving useful autonomous throughput.
created_at: 2026-08-07T01:04:44.227Z
updated_at: 2026-08-07T01:04:44.227Z
---

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
