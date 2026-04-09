---
id: task-improver-context-pre-step
title: Add structured context pre-step to improver workflow
status: done
priority: p2
area: workflow
summary: The improver workflow starts with an unguided agent step that must discover recent run data itself. Adding a code pre-step that captures a structured run summary — similar to the builder's `inspect-ready-queue` — gives the improver a reliable, consistent starting point without tool calls to discover it.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The builder workflow has an `inspect-ready-queue` code step that injects a structured task snapshot before the agent runs. The improver has no equivalent: the agent must discover recent run data on its own via file reads and git calls. This is slower, inconsistent, and means the triggering run ID, recent failure patterns, and run stats are not reliably surfaced to the agent.

## Desired Outcome

- A `gather-context` code step runs before the `improve` agent step in the improver workflow.
- The step captures: the triggering run's metadata and final status, the last N run summaries (workflow name, status, cost, duration), and the current run counts from `WorkflowRuntimeState`.
- The agent step receives this structured context as `previousOutput`, reducing the need for discovery tool calls.
- The context is concise — a summary snapshot, not full event logs.

## Constraints

- Keep the snapshot small; avoid reading full `.events.jsonl` files. Metadata JSON only.
- Reuse `WorkflowRunStore` and helpers already used in `workflow-history.ts`.
- Do not change the improver prompt in this task — only the workflow code step. Prompt update is a separate concern.
- The `improve` step should have a `when` predicate that always runs (unlike the builder, improver should run unconditionally regardless of context).

## Done When

- `gather-context` step exists before `improve` in `improver/workflow.ts`.
- The step output includes triggering run metadata and recent run summary.
- Tests verify the step output shape.
