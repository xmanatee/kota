---
status: open
priority: p0
---

# Close the autonomous failure investigation and remediation loop

## Problem

KOTA detects and deduplicates runtime failures, but detection does not currently
guarantee that an unresolved issue keeps a live investigation or remediation
owner. A concrete production case proves the gap:

- Telegram failures were consolidated into
  `autonomy-issue-a0a5540ecf3ae944cbab` and a decision request was emitted.
- Improver run `2026-09-01T20-18-58-775Z-improver-zxg0n9` failed on a Codex
  transport error before recording a disposition or creating work.
- The issue remained `needs-decision` with no linked task or owner question.
- Later identical observations increased the occurrence count to 44, but
  `autonomy-issue-projection-reducer.ts` correctly classified them as the same
  semantic revision and `health-review-actions.ts` therefore emitted no new
  decision request.

This is a general lifecycle defect, not a Telegram defect: the initial event is
treated as delivery rather than as an obligation that must remain owned until a
durable disposition exists. Any failed, cancelled, lost, or interrupted
investigator can leave an issue permanently detected but unactioned.

Detection is also unnecessarily delayed for failures already observed at a
typed runtime boundary. `runtime-health-auditor` scans module logs on a six-hour
schedule and classifies text heuristically. That scanner is useful for
reconciliation and legacy/unstructured evidence, but it should not be the
primary path for new workflow, module, channel, provider, DLQ, or daemon
failures whose owner already knows their structured context.

## Desired Outcome

Make the existing autonomy issue projection the single durable failure
investigation lifecycle. For every unresolved issue semantic revision, KOTA
must converge on exactly one current disposition owner: an active or queued
investigation, one linked repair task, one linked owner question/setup action,
an explicitly observed/accepted disposition, or a verified resolution.

Use existing mechanisms rather than adding a parallel incident system:

- Emit typed health observations near the common runtime boundary when a
  workflow, module/channel, provider call, DLQ admission, daemon operation, or
  recovery action already has structured failure context. Keep the scheduled
  runtime-health audit as bounded reconciliation/backfill for logs and missed
  observations.
- Reconcile `needs-decision` issue revisions against workflow state and durable
  links. If the corresponding improver attempt failed, was cancelled, became
  unrecoverable, disappeared during restart, or completed without a
  disposition, re-admit the same issue revision after existing backoff. Do not
  bump its semantic revision and do not create duplicate runs, tasks, or owner
  questions.
- Let the investigator inspect the cited evidence and owning code,
  configuration, runtime state, and recent history before deciding whether the
  cause is local code, provider/setup, a safely transient condition, or owner
  input. Text classifiers may prioritize evidence but must not become the final
  diagnosis.
- Execute only existing allowlisted, deterministic doctor/recovery actions
  automatically. Route arbitrary code changes through one generated task and
  the normal builder path. Ask the owner only when credentials, authority, or a
  genuine product decision is unavailable to KOTA.
- After remediation, verify the original health contract with a same-shape
  probe or a meaningful cleared observation. A successful builder or repair
  command alone must not resolve the issue. Recurrence after verified
  resolution reopens the issue as a new semantic revision.
- Reconcile already-orphaned projection entries, including the cited Telegram
  issue, through the ordinary lifecycle. Do not add one-off migration state or
  module-specific repair logic.

## Constraints

- Preserve one issue projection and one generated-work path. Do not add another
  failure database, per-module recovery workflow, polling loop, or competing
  task dedupe mechanism.
- Reuse workflow admission, durable run identity, retry/backoff, recovery,
  issue links, module logging/health boundaries, DLQ records, and doctor fixes.
- Trigger work from a missing lifecycle owner plus durable failure evidence,
  not from arbitrary run counts or a fixed review cadence. Bound retries and
  surface persistent infrastructure/provider inability without retry storms.
- Preserve secret redaction, evidence trust boundaries, task mutation
  authorization, and the rule that reviewer/improver workflows do not edit
  implementation code.
- Keep verification proportional: test the lifecycle contract at its owning
  boundary and one end-to-end recovery journey, not copied configuration,
  prompt text, call order, or every source-specific variation.

## How We Will Know

- A fixture reproducing the production sequence (new issue, decision request,
  improver transport failure, repeated identical observations, restart)
  re-admits exactly one investigation for the same issue/revision and produces
  exactly one durable disposition without duplicate generated work.
- Typed failures from at least one workflow/DLQ path and one module/channel
  path reach the same issue lifecycle without waiting for the scheduled log
  scan; reconciliation still recovers a deliberately missed observation.
- A transient failure can settle without creating code work, an allowlisted
  deterministic repair is verified before closure, and a local defect creates
  one builder task whose completion does not close the issue until the original
  signal clears.
- Status and attention surfaces make the current phase inspectable: detected,
  awaiting/retrying investigation, owned remediation, validating, resolved, or
  genuinely blocked, derived from existing issue/run/task state rather than a
  second state machine.
- The cited orphaned Telegram issue gains a valid disposition owner and no
  unresolved `needs-decision` issue can remain ownerless after reconciliation.

## Starting Points

- `src/modules/autonomy/autonomy-issue-projection-reducer.ts`
- `src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-actions.ts`
- `src/modules/autonomy/workflows/improver/issue-selection.ts`
- `src/modules/autonomy/workflows/runtime-health-auditor/`
- `src/core/modules/module-log.ts`
- `.kota/runs/2026-09-01T20-18-58-775Z-improver-zxg0n9/metadata.json`
- `.kota/runs/2026-09-03T10-33-21-186Z-autonomy-health-reviewer-53vwes/autonomy-health-review.json`

## Relationship To Existing Work

This task completes, rather than replaces, the delivered general runtime issue
recovery loop and persistent workflow-failure escalation. Those mechanisms
detect, group, and initially route failures; this task makes their resulting
investigation/remediation obligation durable through failure, restart, and
verified closure. `task-extract-autonomy-decision-owners` may simplify the
decision code, but it does not own this missing lifecycle guarantee.
