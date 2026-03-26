# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- Builder should ship one cohesive task from `tasks/ready/` per run.
- Builder owns implementation quality, architecture, completeness, and honest task-state updates for the work it executes.
- Changes here shape the default autonomous development behavior.
- Builder works directly on main — no worktrees. This overrides the mono-root AGENTS.md worktree rule. Sub-agents must also work without isolation.
