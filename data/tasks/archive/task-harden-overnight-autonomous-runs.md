---
status: done
---

# Harden overnight autonomous runs

## Problem

Overnight autonomous runs are now possible, but unattended operation still has
sharp edges around failure handling, restart behavior, and operational clarity.

## Desired Outcome

The daemon should be trustworthy enough to leave running for long stretches
without confusing logs, silent drift, or fragile recovery behavior.

## Constraints

- Prefer stricter protocols and validation over extra background machinery.
- Keep the runtime understandable.
- Avoid cosmetic metrics or logging that does not change decisions.

## Done When

- Failure and restart behavior is stricter and easier to reason about.
- Operational logs are clear enough to understand what happened without replaying raw model output.
- Focused validation covers the hardened behavior.
