---
id: task-restore-native-harness-execution-and-clear-the-cur
title: Restore native harness execution and clear the current failure cluster
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Fix or fail over from native CLI launches that cannot read legitimate project or worktree configuration, Git metadata, and task executables. Distinguish filesystem-policy defects from transient provider quota exhaustion, prevent unavailable providers from producing repeated dead letters, and resolve the current builder items through canonical redrive or dismissal.
created_at: 2026-08-05T07:42:26.080Z
updated_at: 2026-08-05T07:42:26.080Z
---

## Problem

    Fix or fail over from native CLI launches that cannot read legitimate project or worktree configuration, Git metadata, and task executables. Distinguish filesystem-policy defects from transient provider quota exhaustion, prevent unavailable providers from producing repeated dead letters, and resolve the current builder items through canonical redrive or dismissal.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-05T06-15-02-757Z-progress-reviewer-ya6eqn.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-05T06-15-02-757Z-progress-reviewer-ya6eqn.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m (kota), run-count review covering 2026-08-04T07:40:00.917Z through 2026-08-05T07:40:00.917Z. Included 20 runs, 6 tasks, 30 events, 40 artifacts, 60 git references, and 8 open dead letters across 164 evidence references. Excluded policy-pruned payloads and truncated run, event, artifact, changed-file, git, and lower-detail evidence. Task balance was Safety 3, Meta 3, Product 0, and Platform 0. Runtime and security hardening is landing, but recurring native-harness permission and quota failures continue to impair reviewer and builder throughput. Applied action: propose one local P1 recovery task; no owner decision is required.

Evidence ids:

- dead-letter:dlq-8e33b0d0-9eba-4967-b949-81900b0e8edf
- dead-letter:dlq-36d8d8b7-d08e-4b3d-9a39-46079751f4c2
- dead-letter:dlq-d0b211a0-e677-4c67-b54b-1c776eb485d2
- dead-letter:dlq-7b3dd861-026f-4116-a40a-4f0715a9c8be
- event:evtj-000000207913
- event:evtj-000000207925

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Runtime probes from both the project root and a builder worktree show that required harness configuration, Git metadata, and task executables are readable while protected credentials remain denied. Provider quota exhaustion produces bounded backoff or healthy fallback without repeated dead-lettering. All eight current open items are canonically redriven or dismissed with rationale, and subsequent progress-reviewer and builder runs complete without the cited failure signatures.
