---
id: task-explorer-context-pre-step
title: Add gather-context pre-step to explorer workflow
status: done
priority: p2
area: workflow
summary: The explorer's inspect-queue step only provides task counts. Add a structured context pre-step (parallel to the improver's gather-context) that packages recent run history, recent git commits, and runtime state so the agent starts with full situational awareness instead of spending tool calls on discovery.
created_at: 2026-03-20
updated_at: 2026-03-20T05-24-25Z
---

## Problem

The explorer agent currently receives only task queue counts from `inspect-queue`. To understand what was recently built, what runs have occurred, and whether there are patterns worth responding to, the agent must make tool calls (bash, git log, file reads) at the start of every session. This burns context and time on discovery work that could be pre-computed.

The improver workflow just gained a `gather-context` step (commit 638442f) that delivers a structured snapshot of the triggering run, recent run history, and runtime state before the agent starts. The explorer has the same need.

## Desired Outcome

- A `gather-context` code step runs between `inspect-queue` and `explore` in the explorer workflow.
- The step provides: recent run summaries (last 10–20 runs), recent git commits (last 10), task queue counts by state, and runtime state.
- The agent step receives this as `previousOutput` in structured form alongside the existing queue assessment.
- The explorer agent prompt is updated to reference the pre-packaged context instead of prompting tool-based discovery.

## Constraints

- Context gathering must be a code step, not agent prompt guidance.
- Keep the context payload focused — do not duplicate full task file contents; summaries are sufficient.
- The `when` predicate for the `explore` step must still gate on `needsAttention`, not on whether context gathered.
- Tests should verify the context step produces the expected shape.

## Done When

- A `gather-context` step exists in the explorer workflow before the agent step.
- The step returns recent runs, recent commits, task counts, and runtime state.
- Tests verify the shape and content of the gathered context.
- Explorer agent sessions show reduced discovery tool calls in run logs.
