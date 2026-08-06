---
id: task-run-progress-and-scope-reflection-only-at-semantic
title: Run progress and scope reflection only at semantic boundaries
status: backlog
priority: p0
area: autonomy
task_class: Meta
depends_on: [task-replace-autonomy-escalators-with-issue-driven-ai-r]
summary: Replace periodic and completion-count reflection with deduplicated reviews of meaningful queue, initiative, owner, and scope changes.
created_at: 2026-08-06T20:22:08.881Z
updated_at: 2026-08-06T20:22:08.881Z
---

## Problem

`progress-reviewer` runs on an explicit request, a six-hour schedule, every
five monitored completions, every three builder commits, and runtime recovery.
Its evidence is rebuilt at execution from overlapping rolling windows, so the
batch normally supplies no unique knowledge. The latest task evidence is
truncated to 20 recently updated tasks and is then used to infer strategic
class balance, which can contradict the full open queue. Pending batch flushes
are always treated as distinct queue entries, so overlapping batches survive
normal latest-run coalescing.

`scope-improver` similarly runs every four hours, on recovery, and on an
evidence gate whose signature includes failed run ids, DLQ ids, recovery runs,
warnings, and oversized files. As the last-20-run window changes, the same root
problem receives a new signature and generic per-run repair candidates. This
duplicates the issue lifecycle and allows scope-improver to edit source
directly.

Observed yield confirms the mismatch. In the latest 200 runs,
`progress-reviewer` ran 16 times and produced no action; in the seven-day scope,
`scope-improver` ran 98 times (39 schedules, 56 evidence-ready, three recovery)
without a recommendation or action.

## Desired Outcome

Run strategic reflection only when a named semantic boundary gives an agent a
meaningfully new decision to make. Progress review owns strategic queue and
initiative steering. Scope review owns explicit onboarding/scope requests and
material scope-content or policy changes. Runtime health, failures, DLQs, and
recovery remain owned by the durable issue lifecycle. Normal successful builder
traffic should continue without invoking either reviewer.

## Constraints

- Progress boundaries are limited to explicit owner/system request, transition
  to a genuinely parked queue after task-state change, strategic anchor or
  milestone completion, a task becoming blocked/dropped, and owner-decision
  resolution. A builder commit or arbitrary completion count is not itself a
  strategy signal.
- Remove the six-hour progress schedule, five-completion batch, three-build
  batch, four-hour scope schedule, failed-run/DLQ/recovery scope candidates,
  and generic recovery AI triggers. Do not replace them with different fixed
  intervals, cooldowns, or thresholds.
- Give each scope one consumption watermark over semantic input revisions and
  at most one latest queued review. A repeated or superseded boundary must
  coalesce before execution instead of creating distinct batch-flush runs.
- Build the progress decision from current canonical refs: the full open task
  queue, strategic anchors and dependencies, durable issues, recovery state,
  and owner decisions. Keep the packet concise and let the capable agent inspect
  referenced repo evidence; do not persist another aggregate worldview or use
  the recent-20 task list as queue truth.
- Progress review may propose, update, resolve, or drop work through the shared
  proposal materializer. It must reconcile generated steering work when current
  projections disprove its premise, including
  `task-recover-two-stale-builder-worktrees-blocking-ready` when recovery has no
  stale worktrees.
- Preserve external-scope onboarding: one idempotent initial
  `autonomy.scope-improvement.requested` event and explicit requests still run.
  A later automatic scope review requires a stable content/policy fingerprint
  that materially changed, not a run id or rolling-window membership.
- Scope review may propose work or ask an owner question; builder implements
  accepted source changes. Remove its direct safe-edit/commit path.
- Update `task-activate-continuous-improvement-for-newly-onboarde` and related
  docs in the same change so onboarding describes the new event contract, not
  the removed schedule and broad evidence scan.

## Done When

- Progress and scope workflow definitions contain no periodic schedule,
  completion-count batch, build-count batch, generic recovery agent trigger,
  or failed-run/DLQ scope discovery path.
- Every automatic progress run records the unique semantic boundary and input
  revision it consumed; every automatic scope run records the changed scope
  fingerprint. Replaying either input is a no-op before queue insertion.
- Replaying the latest 200 historical runs produces no progress/scope AI calls
  during uninterrupted normal delivery unless the fixture names one of the
  accepted semantic boundaries.
- Progress evidence reports the complete current queue/anchor/dependency state
  without copying it into a second state store, and the agent can follow refs
  for deeper inspection.
- A parked-queue transition can produce one useful steering review, while five
  more successful builds do not produce another review.
- A newly onboarded external scope receives exactly one initial review;
  restart, unchanged content, failures, and DLQs do not retrigger it, while a
  material scope-policy/content change does.
- The stale worktree recovery task is updated, completed, or dropped through
  the normal generated-work lifecycle once the recovery projection reports no
  stale worktrees.

## Source / Intent

Owner request and deep autonomy productivity audit on 2026-08-06. The owner
wants reflection to happen when enough evidence exists to draw an insight, not
every N iterations or every few hours. Current history shows that Product and
Safety builders are productive, while periodic and rolling-window reviewers
mostly confirm that nothing changed. This task preserves AI discretion but
gives it fewer, higher-information decisions with canonical evidence.

## Initiative

Evidence-dense strategic and scope reflection.

## Product / Safety Link

This Meta repair returns agent capacity to Product and Safety delivery by
removing low-information reviews and stale steering work while preserving one
high-quality review when the queue, initiative, owner decision, or scope truly
changes.

## Acceptance Evidence

- A trigger-matrix artifact maps each retained semantic boundary to its owner,
  revision key, evidence refs, and expected reviewer; removed periodic and
  completion-count triggers are absent.
- A before/after latest-200-run replay reports progress/scope invocations,
  unique semantic inputs, AI minutes, actions, and duplicate/no-op queue entries.
- Fixtures cover parked-queue review, continued-build restraint, blocked-task
  transition, owner-decision resolution, initial scope onboarding, unchanged
  scope restart, and material scope change.
