---
id: task-resolve-approval-descriptor-builder-diagnostics
title: Resolve approval descriptor builder diagnostics
status: ready
priority: p2
area: approval-queue
task_class: Safety
summary: Add or document inspectable observability evidence for the approval descriptor-binding changes in approval-execution.ts, route-handlers.ts, route-helpers.ts, and route-registrations.ts. Also resolve or narrowly justify the source-size advisories reported for approval-queue.ts and approval-execution.ts.
created_at: 2026-07-28T22:21:57.744Z
updated_at: 2026-07-28T22:21:57.744Z
---

## Problem

    Add or document inspectable observability evidence for the approval descriptor-binding changes in approval-execution.ts, route-handlers.ts, route-helpers.ts, and route-registrations.ts. Also resolve or narrowly justify the source-size advisories reported for approval-queue.ts and approval-execution.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-28T22-09-30-091Z-progress-reviewer-vprp9w.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-28T22-09-30-091Z-progress-reviewer-vprp9w.

review verdict: needs-steering
review summary:

    Needs narrow steering. Within the 24-hour kota directory window, security remediation is advancing, the queue remains actionable, and there are no open dead letters or operator-journey risks. The task balance is Safety 10, Meta 4, Product 0, Platform 0. However, the successful approval-descriptor fix left four runtime-sensitive approval files without observability evidence and two source-size advisories, warranting one focused follow-up.

Evidence ids:

- artifact:2026-07-28T10-56-30-662Z-builder-mdzt36:run-summary.json
- task:task-security-review-approval-execution-is-not-bound-to
- git:commit:f4017df14b96

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up artifact maps each of the four missing files to a structured log, typed event, explicit error result, focused test assertion, or narrow waiver rationale; an observability-obligation recheck against git:commit:f4017df14b96 plus the follow-up diff reports no unresolved missing files. The source-size advisories are reduced below the guideline without weakening security coverage or recorded with narrow rationale, and focused approval-queue tests plus task validation pass.
