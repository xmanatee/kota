---
id: task-recover-the-two-stale-builder-claims-blocking-high
title: Recover the two stale builder claims blocking high-priority ready work
status: blocked
priority: p1
area: autonomy
task_class: Meta
summary: Use the canonical workflow state-recovery path to inspect and disposition the preserved worktrees for the daemon-control responsiveness and issue-driven escalator tasks. Preserve or merge unique changes, release or supersede the stale claims with rationale, and reconcile their linked resumeSessionId dead letters now that the underlying harness defect has passed live verification.
created_at: 2026-08-13T15:51:09.264Z
updated_at: 2026-08-13T18:00:37.000Z
---

## Problem

    Use the canonical workflow state-recovery path to inspect and disposition the preserved worktrees for the daemon-control responsiveness and issue-driven escalator tasks. Preserve or merge unique changes, release or supersede the stale claims with rationale, and reconcile their linked resumeSessionId dead letters now that the underlying harness defect has passed live verification.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-13T15-08-32-984Z-progress-reviewer-d76njw.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-13T15-08-32-984Z-progress-reviewer-d76njw.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m/kota, task-count trigger, covering 2026-08-12T15:47:21.324Z–2026-08-13T15:47:21.324Z. Included 20 runs, 12 tasks, 4 events, 40 artifacts, 55 git references, 6 open dead letters, and 137 evidence items. Excluded payload bodies for 1,227 policy-pruned run references, runs beyond the 20 most recent, artifacts beyond 40, part of commit ab8ff73230bf's changed-file list, and 64 lower-detail prompt references. The task balance is 0 Product, 1 Safety, 6 Platform, 4 Meta, and 1 Unclassified. The high-severity Keychain isolation fix and post-fix Codex repair delivery are proven, but two high-priority ready tasks remain blocked by stale claims over preserved worktrees, and evaluator pass-contradiction drift remains above threshold. Review action: propose one non-duplicate P1 recovery task; no owner decision is required.

Evidence ids:

- run:2026-08-13T15-35-53-136Z-dispatcher-d2k2le
- task:task-keep-daemon-control-api-responsive-during-workflow
- task:task-replace-autonomy-escalators-with-issue-driven-ai-r
- dead-letter:dlq-ae1303b0-16c0-472b-8f5a-9edd3e48e205
- dead-letter:dlq-b8c26da0-96dd-41ae-99e5-df191d245afe
- git:commit:132438782a06
- task:task-verify-post-fix-builder-repair-delivery-and-reconc

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A workflow-state-recovery artifact records each worktree's before state, unique changes, recover/merge/supersede disposition, and resulting claim state; no unique work is discarded; both underlying tasks are done or safely claimable; a subsequent dispatcher artifact no longer lists either task as stale or skipped-stale-worktree; both linked dead letters have terminal redrive or dismissal dispositions tied to the live post-fix verification; and task validation passes.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-08-13T15-36-07-328Z-workflow-state-recovery-host-replay/verification.json
description: trusted-host replay of both exact supersede commands recorded in builder run 2026-08-13T15-36-07-328Z-builder-9gvvrx, with verification.json citing both canonical workflow-state-recovery artifacts that dismiss dead letters dlq-ae1303b0-16c0-472b-8f5a-9edd3e48e205 and dlq-b8c26da0-96dd-41ae-99e5-df191d245afe plus a later dispatcher artifact proving neither underlying task remains claim-blocked or skipped as a stale worktree
```

## Status (2026-08-13 builder)

The leased builder worktree can inspect read-only Git common metadata but cannot
read or mutate the daemon's canonical parent-scope claim and dead-letter stores.
The projected
`.kota/runs/2026-08-13T15-36-07-328Z-builder-9gvvrx/evidence/artifacts/workflow-state-recovery-host-replay.json`
artifact proves both registered worktree paths are absent, both retained branches
have zero commits outside canonical HEAD, and no unique work needs preservation.
It records the two exact fail-closed trusted-host commands, terminal dismissal
rationale, and the dispatcher success predicate. The task remains blocked until
those commands run against the canonical runtime store and produce the artifacts
named above; no claim or dead-letter mutation is asserted by this builder run.
