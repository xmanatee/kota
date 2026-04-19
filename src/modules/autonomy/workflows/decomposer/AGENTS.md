# Decomposer Workflow

This directory contains the decomposer workflow definition and its prompt.

- Triggers on builder failure events and assesses whether the failure is timeout-shaped.
- When a timeout-shaped failure has a clear builder-owned task, an agent decomposes it into
  2-4 smaller subtasks and moves the original to `dropped/`.
- Keep decomposition logic inside this module, not in core or in the builder itself.
