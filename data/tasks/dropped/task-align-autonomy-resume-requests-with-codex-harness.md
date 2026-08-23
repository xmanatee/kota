---
id: task-align-autonomy-resume-requests-with-codex-harness
title: Align autonomy resume requests with Codex harness capabilities
status: dropped
priority: p1
area: architecture
summary: Prevent builder, improver, and other recovery paths from passing resumeSessionId to adapters that do not support managed session resume. Preserve recoverable work through an explicitly supported fallback instead of dead-lettering the dispatch.
created_at: 2026-08-15T04:10:07.075Z
updated_at: 2026-08-15T04:26:49.678Z
task_class: Platform
---
## Problem

    Prevent builder, improver, and other recovery paths from passing resumeSessionId to adapters that do not support managed session resume. Preserve recoverable work through an explicitly supported fallback instead of dead-lettering the dispatch.

## Desired Outcome

Resolve the progress-review finding identified by topic harness-resume:codex-capability.

## Disposition

Dropped as duplicate and based on stale failure evidence. Commit `132438782a06`
already made repair-loop option resolution capability-aware, and subsequent
Codex builder and improver repairs completed without another unsupported
`resumeSessionId` failure. The two cited resume dead letters are historical;
`task-terminally-disposition-the-four-residual-workflow` owns their terminal
cleanup. The third cited dead letter is a separate progress-review evidence-ID
failure owned by `task-make-progress-reviewer-evidence-citation-failures`.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer from the cited evidence.

review verdict: needs-steering
review summary:

    Internal delivery progressed through two successful builder runs and three completed tasks, but six dead letters remain open, including repeated Codex resume-capability failures affecting builder and improver. Three Safety tasks are ready but unresolved. Task balance is Product 0, Safety 3, Platform 2, and Meta 3; no operator-journey risks were reported.

Evidence ids:

- dead-letter:dlq-263574f1-cd0d-4369-a818-8050cae6d16e
- dead-letter:dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6
- dead-letter:dlq-8c912d98-2b05-4160-a77f-5cec930102db

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Focused tests demonstrate capability-aware option resolution for builder and improver recovery, and runtime evidence shows both workflows continue safely with the Codex adapter without producing an unsupported-resume dead letter.

## Generated Work Provenance

Proposal key: `progress-reviewer:harness-resume:codex-capability`

- Source: progress-reviewer; run: 2026-08-15T03-33-42-656Z-progress-reviewer-z9i1rt
  - Evidence: dead-letter:dlq-263574f1-cd0d-4369-a818-8050cae6d16e
  - Evidence: dead-letter:dlq-8c912d98-2b05-4160-a77f-5cec930102db
  - Evidence: dead-letter:dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6

<!-- generated-work-proposal: {"key":"progress-reviewer:harness-resume:codex-capability","provenance":[{"source":"progress-reviewer","runId":"2026-08-15T03-33-42-656Z-progress-reviewer-z9i1rt","evidenceRefs":["dead-letter:dlq-263574f1-cd0d-4369-a818-8050cae6d16e","dead-letter:dlq-8c912d98-2b05-4160-a77f-5cec930102db","dead-letter:dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6"]}]} -->
