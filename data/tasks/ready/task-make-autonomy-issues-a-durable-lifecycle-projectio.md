---
id: task-make-autonomy-issues-a-durable-lifecycle-projectio
title: Make autonomy issues a durable lifecycle projection
status: ready
priority: p0
area: architecture
task_class: Platform
summary: Project source-owned health and recovery observations into one durable issue lifecycle keyed by semantic root cause.
created_at: 2026-08-06T20:21:51.318Z
updated_at: 2026-08-06T20:21:51.318Z
---

## Problem

Autonomy health state is inferred independently from run artifacts, current
review batches, task files, owner questions, DLQs, and recovery records. The
latest health-review artifact is treated as the complete current world even
when it contains only one partial signal batch. Consequently:

- `applyAutonomyHealthReviewActions` dismisses pending owner questions merely
  because a different issue is absent from the newest batch;
- `collectRecentAutonomyHealthIssueCards` exposes only groups whose
  `generatedAt` equals the latest review timestamp, so unresolved older issues
  disappear from consumers;
- a terminal health task plus a new evidence fingerprint creates a suffixed
  task id instead of reopening or revising one stable issue;
- repeated runs with different run ids look like new problems even when the
  semantic root cause is unchanged.

There is no authoritative current lifecycle saying that an issue opened,
materially changed, was dispositioned, or was explicitly cleared.

## Desired Outcome

Add one durable autonomy-issue projection keyed by a stable semantic root
cause. Source modules emit typed observations; the projection owns each
issue's current lifecycle and links to its task, owner question, DLQ, and
recovery disposition. Repeated evidence enriches the same issue without
requesting another AI decision. Only a new issue, a material semantic revision,
an explicit reopening, or an explicit clear changes decision state.

## Constraints

- Keep sources of truth narrow: event/run/DLQ/recovery records own facts, task
  markdown owns work state, owner-question storage owns decisions, and the
  issue projection alone owns cross-source current issue lifecycle.
- Derive a stable issue key from normalized root-cause identity, not run ids,
  timestamps, rolling-window membership, or evidence ordering.
- Represent source observations explicitly as present/changed/cleared. Absence
  from a partial batch, scheduled audit, or bounded scan must never resolve an
  issue.
- Persist enough state to expose first seen, last seen, occurrence count,
  severity, actionability, semantic revision, evidence refs, disposition, and
  linked task/question ids. Repeated identical observations may update
  occurrence metadata without incrementing the semantic revision.
- Make projection updates atomic and replayable from typed observations. Do not
  introduce a second issue registry, mutable markdown issue store, or parallel
  health-card cache.
- Migrate/rebuild current issue state once, then delete latest-review inference,
  fingerprint-suffixed task identity, and compatibility readers. No legacy or
  fallback path remains.
- Do not decide how an ambiguous issue should be fixed in deterministic code;
  this task supplies durable evidence and lifecycle for the issue-driven AI
  reviewer task to consume.

## Done When

- One API/projection answers the current open, resolved, and needs-decision
  issues consistently for status, health review, recovery, and improver
  consumers.
- Processing an unrelated partial batch cannot close, hide, or dismiss another
  unresolved issue or owner question.
- Replaying the same root cause across many runs produces one issue key, one
  semantic revision, and accumulated provenance; materially changed evidence
  creates a new revision on that issue rather than a sibling issue/task.
- A typed clear observation resolves the issue and its linked disposition;
  later recurrence reopens the same issue with traceable history.
- Current issue state is reconstructed without losing unresolved DLQ,
  recovery, owner-question, or task links, and the superseded artifact-derived
  readers are removed.
- Projection transition fixtures cover open, repeat, material change, partial
  batch, explicit clear, reopen, and replay after restart.

## Source / Intent

Deep autonomy productivity audit on 2026-08-06. The current health machinery
has a useful typed `AutonomyHealthSignal`, but converts batches into ephemeral
reviews instead of durable issue transitions. That makes downstream improver,
status, task creation, and owner-question behavior depend on whichever review
happened last. The owner asked for a clean source-of-truth architecture that
trusts AI for judgment and removes duplicate/no-op processing.

## Initiative

Event-driven autonomy issue detection and disposition.

## Acceptance Evidence

- A replay artifact maps typed observations to issue transitions and proves
  stable identity across changing run ids.
- Projection JSON before and after a partial review proves unrelated issues and
  owner questions remain open.
- A restart/rebuild fixture produces the same issue lifecycle and linked work
  state without consulting a latest-review fallback.
