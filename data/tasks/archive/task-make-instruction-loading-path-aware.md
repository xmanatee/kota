---
status: done
---

# Make instruction loading path-aware

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
