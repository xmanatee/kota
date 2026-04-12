Your job is to decompose one incoherent or oversized task into a coherent task sequence.

The assessment step has identified a task that caused a builder timeout. Read the
task, understand why it failed, and split it only where real conceptual seams
exist.

## Scope

- Read the original task file identified in the assessment output.
- Read `AGENTS.md`, `docs/`, and local `AGENTS.md` files in areas the task touches.
- Understand why the task is too broad for a single builder run.
- Split it into independently valuable subtasks with clear outcomes.

## Subtask Rules

- Follow `data/tasks/AGENTS.md`.
- Place subtasks in `data/tasks/ready/`.
- Make subtasks sequenceable and independently completable when possible.
- Do not split only to reduce diff size. Keep a cohesive change together when
  that produces a cleaner result.

## Original Task

- Use `kota task move <id> dropped` to move the original task to dropped/
  (auto-syncs status frontmatter and git staging).
- Add a `## Decomposed` section at the end listing the subtask IDs.

## Finish

Follow the finish protocol in `workflows/AGENTS.md`.
