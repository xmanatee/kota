# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- This workflow should own one cohesive normalized task at a time, resuming
  `data/tasks/doing/` first, then pulling from `data/tasks/ready/`, and only
  promoting from `data/tasks/backlog/` when `ready/` is empty.
- Own implementation quality, architecture, completeness, honest task-state updates, and hard validation fixes before the run ends.
- Tasks define the contract and constraints; the implementing agent owns the detailed plan.
- Changes here shape the default autonomous development behavior.
- Work directly in this repository — no worktrees. Sub-agents must also work without isolation.
- Prefer validation rails over hardcoded pre-agent task moves or scope policing.

## Success Criteria

The builder must declare concrete success criteria before implementation and
verify them before completion:

- `success-criteria.txt`
- `success-criteria-verified.txt`

Keep completion reviewable. If external resources or runtime behavior matter,
leave enough ordinary context in the task state, docs, code, or run notes for a
later reviewer to verify the result. If a required resource cannot be reached,
record the blocker instead of inferring completion.
