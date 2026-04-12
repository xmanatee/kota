---
id: task-knowledge-recall-in-autonomous-agents
title: Wire knowledge recall into autonomous workflow agents before task start
status: done
priority: p1
area: modules
summary: The knowledge-capture workflow writes structured insights after builder/improver runs, but no autonomous workflow agent queries the knowledge store before starting work. The feedback loop is write-only.
created_at: 2026-04-12T01:10:00Z
updated_at: 2026-04-12T02:30:18.389Z
---

## Problem

The knowledge-capture workflow (triggered on `workflow.completed` for builder
and improver) extracts structured insights into the knowledge store. However,
the builder, improver, decomposer, and explorer workflow prompts contain zero
references to querying knowledge before starting their work. The interactive
agent's system prompt includes a "recall before starting work" instruction, but
this is not injected into autonomous workflow agent prompts.

The `knowledge` tool is in the `management` tool group, so workflows would need
to explicitly enable it. The result is a write-only knowledge loop: insights
accumulate but never inform future autonomous runs.

## Desired Outcome

Autonomous workflow agents (at minimum builder and improver) query the knowledge
store for relevant prior insights before beginning their task. When a builder
picks up a task in a module that previously caused build failures, it sees the
captured lesson. When the improver examines a workflow that had repeated
cost-overruns, it sees the prior analysis.

## Constraints

- Use the existing `knowledge` tool and provider contract. Do not add a new
  tool or store type.
- Add knowledge recall guidance to the relevant workflow prompts. Do not
  duplicate it across every prompt; if a shared pattern emerges, use the
  existing dynamic state provider mechanism.
- Keep the recall lightweight: a targeted search, not a full dump of the store.
- Do not make knowledge recall blocking. If the store is empty or returns
  nothing relevant, the agent proceeds normally.

## Done When

- Builder and improver workflow agents query the knowledge store at the start
  of their run with a query relevant to their current task.
- The `knowledge` tool (or equivalent read path) is available in those workflow
  step configurations.
- At least one integration-level test or manual verification confirms the
  recall path fires and returns results when matching entries exist.
- Explorer and decomposer prompts are updated if knowledge recall would
  meaningfully improve their output quality.
