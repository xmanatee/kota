---
id: task-add-codex-auth-expiry-adapter-observability-eviden
title: Add Codex auth-expiry adapter observability evidence
status: ready
priority: p2
area: modules
task_class: Platform
summary: Builder run 2026-07-08T06-23-36-951Z-builder-6ddjzf completed the native CLI auth-expiry task, but its observability-obligation review still marks src/modules/codex-agent-harness/adapter.ts as missing inspectable evidence for the runtime-sensitive adapter change.
created_at: 2026-07-08T07:12:22.125Z
updated_at: 2026-07-08T07:12:22.125Z
---

## Problem

    Builder run 2026-07-08T06-23-36-951Z-builder-6ddjzf completed the native CLI auth-expiry task, but its observability-obligation review still marks src/modules/codex-agent-harness/adapter.ts as missing inspectable evidence for the runtime-sensitive adapter change.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-08T06-59-45-384Z-progress-reviewer-aihj18.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-08T06-59-45-384Z-progress-reviewer-aihj18.

review verdict: needs-steering
review summary:

    The window shows useful progress: Safety 5, Product 4, Platform 4, Meta 7, with new actionable Safety and Platform tasks created. Steering is still needed because three builder dead letters and two owner/setup questions remain open, and the auth-expiry builder run left one unresolved observability warning.

Evidence ids:

- run:2026-07-08T06-23-36-951Z-builder-6ddjzf
- artifact:2026-07-08T06-23-36-951Z-builder-6ddjzf:run-summary.json
- git:commit:b02b6d72e8b3
- task:task-warn-before-native-cli-harness-auth-expires-during

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up run artifact or focused test maps src/modules/codex-agent-harness/adapter.ts to inspectable observability evidence or a narrow waiver rationale, the observability-obligation diagnostic no longer reports that file as unresolved for this change, and focused adapter/readiness tests plus validate-tasks pass.
