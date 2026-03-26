---
id: task-simplify-memory-and-state-surfaces
title: Simplify memory, history, knowledge, and runtime state into one store model
status: backlog
priority: p2
area: state
summary: KOTA exposes history, memory, working memory, knowledge, and workflow state as separate public notions. Keep the useful storage behaviors, but collapse them under one clearer runtime state and store model so users and agents do not need to reason about many overlapping persistence surfaces.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA currently has several persistence concepts with overlapping scope:

- conversation history
- long-term memory
- working memory
- knowledge entries
- workflow and daemon state
- run artifacts

Some of these distinctions are useful internally, but as public concepts they
make the system feel heavier than it needs to be.

## Desired Outcome

- KOTA has one clear storage model with explicit namespaces or store types.
- Public docs explain one runtime state subsystem rather than many separate
  memory-like products.
- Explorer, builder, and improver can use durable state without guessing which
  persistence surface is the right one.

## Constraints

- Preserve durable run evidence and auditable task/run history.
- Do not lose useful separation between transient session state and durable repo state.
- Avoid inventing a grand unified memory product if a simpler store model is enough.

## Done When

- The public storage model is documented clearly.
- Overlapping memory/state surfaces are reduced or renamed into one coherent model.
- Built-in agents can use durable state through one understandable path.
