---
id: task-handle-handoff-and-inbound-signal-source-size-warn
title: Handle handoff and inbound-signal source-size warnings
status: ready
priority: p3
area: architecture
summary: The nested handoff-agent security fix landed successfully, but the builder run left advisory source-size warnings for src/core/tools/handoff-agent.ts and src/modules/inbound-signals/index.ts. Split cohesive helpers or record narrow scoped exceptions without changing handoff provider propagation or inbound-signal behavior.
created_at: 2026-06-23T18:18:38.148Z
updated_at: 2026-06-23T18:18:38.148Z
---

## Problem

The nested handoff-agent security fix landed successfully, but the builder run left advisory source-size warnings for src/core/tools/handoff-agent.ts and src/modules/inbound-signals/index.ts. Split cohesive helpers or record narrow scoped exceptions without changing handoff provider propagation or inbound-signal behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T17-35-29-214Z-progress-reviewer-uqn0ag.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T17-35-29-214Z-progress-reviewer-uqn0ag.

review verdict: needs-steering
review summary: KOTA is mostly on track: Product 0, Safety 2, Platform 2, Meta 1, Unclassified 13. Recent monitored and post-build workflows completed successfully and the main security fix landed with verification, but the latest builder left new advisory source-size warnings not covered by the active cleanup tasks.

Evidence ids:

- run:2026-06-23T17-25-55-577Z-builder-ixjqx3
- git:commit:8e9f8452a204
- task:task-security-review-nested-handoffagent-runs-drop-the-

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff reduces or justifies the source-size warnings for src/core/tools/handoff-agent.ts and src/modules/inbound-signals/index.ts; focused handoff-agent and inbound-signal tests pass; typecheck, lint, validate-tasks, and source-size review pass or record scoped exceptions.
