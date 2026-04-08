# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- Builder should own one cohesive task at a time, resuming `tasks/doing/` first and pulling from `tasks/ready/` when needed.
- Builder owns implementation quality, architecture, completeness, honest task-state updates, and fixing any hard validation errors before the run ends.
- Builder owns the engineering plan. Tasks should define the contract and
  constraints, while builder decides the detailed implementation path.
- Builder may capture one or more distinct follow-up tasks in `tasks/inbox/` or
  `tasks/backlog/` when implementation uncovers real out-of-scope work that
  should be revisited later.
- Changes here shape the default autonomous development behavior.
- Builder works directly in this repository — no worktrees. Sub-agents must also work without isolation.
- Lightweight validation rails should do most of the consistency work here.
- Builder should not rely on hardcoded pre-agent task moves or scope policing
  when the same issue can be handled by honest task state and end-of-step
  validation.
