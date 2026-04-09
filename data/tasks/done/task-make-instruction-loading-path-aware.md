---
id: task-make-instruction-loading-path-aware
title: Make instruction loading path-aware
status: done
priority: p1
area: instructions
summary: Select the most relevant local AGENTS files automatically when work happens in deeper subtrees.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Root instructions load automatically, but deeper directory guides still depend
too much on the agent remembering to open them manually.

## Desired Outcome

The instruction system should surface the most relevant local directory guidance
without making prompts bloated or ambiguous.

## Constraints

- Keep instruction selection deterministic.
- Do not add hidden heuristics that are hard to reason about.
- Preserve concise prompts.

## Done When

- Local directory guidance is surfaced more reliably for deep subtree work.
- The selection rules are explicit.
- Focused validation covers the behavior.
