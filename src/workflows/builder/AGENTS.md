# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- Builder should own one cohesive task at a time, resuming `tasks/doing/` first and pulling from `tasks/ready/` when needed.
- Builder owns implementation quality, architecture, completeness, honest task-state updates, and fixing any hard validation errors before the run ends.
- Builder owns the engineering plan. Tasks should define the contract and
  constraints, while builder decides the detailed implementation path.
- Changes here shape the default autonomous development behavior.
- Builder works directly in this repository — no worktrees. Sub-agents must also work without isolation.
