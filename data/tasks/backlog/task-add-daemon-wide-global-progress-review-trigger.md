---
id: task-add-daemon-wide-global-progress-review-trigger
title: Add daemon-wide global progress-review trigger
status: backlog
priority: p1
area: autonomy
summary: Make the progress-reviewer able to run a real daemon-wide scheduled global review across all configured scopes.
created_at: 2026-06-04T13:06:38.510Z
updated_at: 2026-06-04T13:06:38.510Z
---

## Problem

`progress-reviewer` can collect global-scope evidence only when a trigger
payload explicitly supplies `scopeId: "global"`:

- `src/modules/autonomy/workflows/progress-reviewer/progress-review.ts:337-359`

The scheduled trigger is defined on the normal workflow definition without a
daemon-wide global payload:

- `src/modules/autonomy/workflows/progress-reviewer/workflow.ts:276-280`

That means the implemented schedule path reviews each runtime scope, but there
is no clear daemon-owned scheduled meta-review that runs once across all
configured scopes. The owner's original scenario specifically asked for weekly
higher-level steering over all changes.

## Desired Outcome

Add an explicit daemon-wide/global progress-review trigger path. It should queue
one global review run with `scopeId: "global"` and bounded evidence from every
configured directory-backed child scope.

The result should be a single global review artifact that can identify
cross-scope meta-steering issues without duplicating one review per directory
scope.

## Constraints

- Do not add a second review engine. Use the existing progress-reviewer workflow
  and workflow runtime.
- Do not reintroduce `project` as a core concept. Use the scope registry and
  global/root scope identity.
- Keep evidence bounded and reproducible; each included directory scope must be
  named with its own evidence window and exclusions.
- Avoid duplicate task spam when both per-scope and global reviews observe the
  same issue.

## Done When

- A daemon or workflow trigger can schedule/manual-run one global
  progress-review with `scopeId: "global"`.
- Tests prove the scheduled/global path queues one global run across multiple
  configured directory scopes.
- The global artifact cites per-scope evidence and clearly separates
  cross-scope findings from local-scope findings.
- Existing per-directory progress-review tests continue to pass.

## Source / Intent

Owner request from the architecture review: "scheduled review of all the changes
that happened every week to figure out if there's any meta-steering necessary on
higher level." The current implementation added scoped review and manual global
collection support, but not a first-class scheduled daemon-wide global run.

## Initiative

Outcome-aware autonomy.

## Acceptance Evidence

- Focused daemon/workflow test output showing a scheduled global progress-review
  across at least two configured directory scopes.
- Run artifact fixture for a global review containing scoped evidence sections.
