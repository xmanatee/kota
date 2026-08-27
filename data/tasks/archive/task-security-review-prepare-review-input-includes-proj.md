---
status: dropped
---

# Security review: prepare-review-input includes project-controlled task titles and external event summaries but is exposed without exposedOutputTrust: "untrusted". Hostile evidence text therefore reaches the autonomous reviewer without the shared injection screening and boundary escaping used for untrusted step output.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts
claim:

> prepare-review-input includes project-controlled task titles and external event summaries but is exposed without exposedOutputTrust: "untrusted". Hostile evidence text therefore reaches the autonomous reviewer without the shared injection screening and boundary escaping used for untrusted step output.

## Desired Outcome

> Declare exposedOutputTrust: "untrusted" on prepare-review-input and add prompt-boundary tests using hostile task titles and inbound message text, including closing envelope tags and Markdown fences.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T08-07-23-180Z-security-review-sh9v64.

finding id: finding-progress-reviewer-exposed-evidence-trust
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts:1
verdict: confirmed
rationale:

> prepare-review-input still sets exposeOutputToAgent: true without exposedOutputTrust: "untrusted". Its packet includes task titles copied from repository-controlled records and summaries derived directly from event payloads. With undefined trust, buildExposedStepOutputBlock renders this content as ordinary JSON inside a raw step element; it does not apply injection screening, escaping, or the untrusted-content envelope. Reviewer-generated tasks and owner questions can subsequently become durable actions, while evidence-ID validation checks citation membership rather than whether untrusted prose manipulated the review.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 108

excerpt:

> prepareReviewInput sets exposeOutputToAgent: true but does not set exposedOutputTrust: "untrusted".

Evidence 2:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/task-evidence.ts

line: 30

excerpt:

> Task evidence copies record.title directly into the evidence packet and summary.

Evidence 3:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/event-evidence.ts

line: 81

excerpt:

> batchEventEvidence derives payloadSummary from an inbound event payload and includes it in agent-visible evidence.

Evidence 4:

path: src/core/workflow/steps/step-executor-agent-prompt.ts

line: 136

excerpt:

> buildExposedStepOutputBlock emits ordinary JSON when trust is undefined; only trust === "untrusted" invokes injection screening, escaping, and the untrusted-content envelope.

Evidence 5:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/actions.ts

line: 19

excerpt:

> applyProgressReviewActions turns the reviewer's follow-up tasks and owner questions into durable actions after evidence-ID validation.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Superseded

Dropped on 2026-08-16 as the same stable finding and candidate identity as
`task-security-review-prepare-review-input-contains-proj`. The older task is
the canonical implementation record. This task retains the second review run's
provenance as evidence for
`task-deduplicate-repeated-security-review-findings-by-s`; it must not be built
or silently deleted.
