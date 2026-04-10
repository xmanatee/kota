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

## Success Criteria

The builder agent must declare success criteria before implementing and verify
them after. Two files in the run directory enforce this:

- `success-criteria.txt` — written before implementation. Contains concrete,
  verifiable conditions (at least 2). Checked by the `success-criteria-declared`
  repair check.
- `success-criteria-verified.txt` — written after implementation. Confirms each
  criterion is satisfied with evidence. Checked by the `success-criteria-verified`
  repair check.

Both checks run as part of the repair loop alongside build, typecheck, lint,
and test checks. The agent cannot complete a run without satisfying them.
