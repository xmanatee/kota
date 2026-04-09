# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- Builder should own one cohesive normalized task at a time, resuming
  `data/tasks/doing/` first and pulling from `data/tasks/ready/` when needed.
- Builder owns implementation quality, architecture, completeness, honest task-state updates, and fixing any hard validation errors before the run ends.
- Builder owns the engineering plan. Tasks should define the contract and
  constraints, while builder decides the detailed implementation path.
- Changes here shape the default autonomous development behavior.
- Builder works directly in this repository — no worktrees. Sub-agents must also work without isolation.
- Lightweight validation rails should do most of the consistency work here.
- Builder should not rely on hardcoded pre-agent task moves or scope policing
  when the same issue can be handled by honest task state and end-of-step
  validation.
