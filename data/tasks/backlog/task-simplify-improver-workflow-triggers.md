---
id: task-simplify-improver-workflow-triggers
title: Simplify improver workflow triggers
status: backlog
priority: p2
area: autonomy
summary: Collapse improver's three triggers into one periodic signal and re-evaluate the 60m cooldown.
created_at: 2026-04-17T09:02:12.940Z
updated_at: 2026-04-17T09:02:12.940Z
---

## Problem

Improver currently listens to three separate triggers — `workflow.build.committed`, `workflow.completed` (filtered to monitored failures), and `runtime.recovered` — each with its own 60m cooldown. Its `gather-run-data` input step reads aggregate stats across recent runs and does not care which run fired it or whether that run succeeded. The trigger fan-out is duplicated config without corresponding per-trigger behavior, and the builder-vs-any-workflow distinction reads as historical baggage now that improver is meant to improve anything, not only the builder.

## Desired Outcome

Improver runs on a single semantic signal that reflects "there is likely something to improve across recent runs," not a fixed list of upstream workflow names. The agent stays entity-agnostic and inspects prompts, agents, setups, and recurring failure signals across all workflows rather than only the builder. Cooldown is chosen based on measured run cadence, not copy-pasted from the old per-trigger config.

## Constraints

- Do not reintroduce per-workflow inventories in improver's trigger definition; the `docs/ARCHITECTURE`-level direction is semantic events, not workflow name lists.
- Preserve the `runtime.recovered` re-entry path (improver is one of the few recovery-capable workflows today); if trigger collapsing would drop that, bridge it through an explicit event.
- Trigger changes must not violate the self-trigger loop guard documented in `src/modules/autonomy/workflows/AGENTS.md`.

## Done When

- Improver is triggered by a single, domain-shaped event (or clearly-justified minimal set) with a cooldown grounded in current run cadence.
- The builder-only `workflow.build.committed` special case is removed unless investigation surfaces a concrete reason to keep it, documented in the workflow file.
- The integration test for the autonomy loop still passes with the new trigger shape.

