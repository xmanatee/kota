# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- This workflow should own one cohesive normalized task at a time, resuming
  `data/tasks/doing/` first, then pulling from `data/tasks/ready/`, and only
  promoting from `data/tasks/backlog/` when `ready/` is empty.
- Own implementation quality, architecture, completeness, honest task-state updates, and hard validation fixes before the run ends.
- Tasks define the contract and constraints; the implementing agent owns the detailed plan.
- Changes here shape the default autonomous development behavior.
- Work directly in this repository — no worktrees. Sub-agents must also work without isolation.
- Lightweight validation rails should do most of the consistency work here.
- Do not rely on hardcoded pre-agent task moves or scope policing
  when the same issue can be handled by honest task state and end-of-step
  validation.
