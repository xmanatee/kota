---
id: task-verify-post-fix-builder-repair-delivery-and-reconc
title: Verify post-fix builder repair delivery and reconcile dead letters
status: ready
priority: p1
area: platform
task_class: Platform
summary: After the restart required by commit 132438782a06, exercise a builder repair path under Codex and record whether it proceeds without the unsupported resumeSessionId option. Reconcile the four matching builder/improver dead letters separately from the transient 503.
created_at: 2026-08-13T13:37:56.869Z
updated_at: 2026-08-13T13:37:56.869Z
---

## Problem

    After the restart required by commit 132438782a06, exercise a builder repair path under Codex and record whether it proceeds without the unsupported resumeSessionId option. Reconcile the four matching builder/improver dead letters separately from the transient 503.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-13T12-00-00-004Z-progress-reviewer-iw8uxr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-13T12-00-00-004Z-progress-reviewer-iw8uxr.

review verdict: needs-steering
review summary:

    Global scheduled review for 2026-08-12T13:36:01.500Z–2026-08-13T13:36:01.500Z. Included 20 run references, 8 tasks, 40 artifacts, 15 git references, 5 open dead letters, and 88 evidence items from one directory scope. Excluded 1,188 policy-pruned metadata-only run payloads, runs beyond the 20 most recent, and artifacts beyond 40. The task mix is 1 Safety, 5 Platform, 2 Meta, and 0 Product. A promoted repair-loop change addresses four repeated resumeSessionId failures, but the evidence window contains no post-restart builder run proving delivery recovered, and the affected dead letters remain open. Applied action: propose one verification and reconciliation task; no owner decision is required.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-b8c26da0-96dd-41ae-99e5-df191d245afe
- scope:8nrg1m:dead-letter:dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6
- scope:8nrg1m:git:commit:132438782a06
- scope:8nrg1m:run:2026-08-13T13-18-45-672Z-improver-36d1kf

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A post-restart builder run reaches and completes a repair iteration without an unsupported resumeSessionId failure, and each of the four matching open dead letters is redriven, dismissed, or retained with a recorded unresolved cause. The unrelated 503 remains separately classified.
