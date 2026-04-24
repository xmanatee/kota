# decomposer-agent-call-replay fixture is currently broken

Discovered while landing the pnpm-test smoke gate (task-gate-shipped-replay-fixtures-from-pnpm-test-so-wor, run 2026-04-24T22-33-19-581Z-builder-ezj3rl).

The fixture's recorded `decompose.json` writes two new ready-queue subtasks
(`task-fixture-replay-subtask-external-project-e2e.md`,
`task-fixture-replay-subtask-workflow-precedence.md`) that were
validation-passing when the recording was made but predate the open-task
quality gates that now require `## Source / Intent`, `## Acceptance Evidence`,
and `## Initiative` sections. Result:

- `pnpm kota eval run --fixture decomposer-agent-call-replay` exits with
  status 1: `task-queue-valid` repair check fails after the agent step,
  the workflow tries to repair, and the replay adapter has no recording
  for the repair-attempt prompt shape.
- The weekly cadence (`eval-harness-cadence`) currently scores this
  fixture as fail/error, dragging `pass^k` down on every run.

Two ways to fix:

1. Re-record `decompose.json` against a fresh real decomposer run whose
   produced subtasks pass current task-validation rules.
2. Patch the recorded subtask bodies in `decompose.json` to add the
   missing required sections, keeping the rest of the recording intact.

This was deliberately left out of the smoke-gate task scope (the task
said "If one fixture is enough, ship one"; improver covers the load-
bearing surfaces and exercises judge-prompt routing). Filing here so
the cadence pass^k drag does not stay invisible.
