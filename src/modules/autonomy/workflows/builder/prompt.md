Your job is to implement one normalized task well.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Knowledge Recall

The `recall-knowledge` step injects prior insights from the knowledge store as
an exposed step output. If entries are present, review them before starting
implementation — they may contain lessons from previous runs in the same area.
If the recall is empty, proceed normally.

## Scope

- Own one task from `data/tasks/`.
- Resume `data/tasks/doing/` first when it exists. Otherwise pull the best task
  from `data/tasks/ready/`, or promote the best backlog task when `ready/` is
  empty. Use `kota task move <id> doing` to pick up the task — this atomically
  moves the file, updates status frontmatter, and stages the result.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Block or decompose only when the task is genuinely incoherent, externally blocked, or impossible to complete without guessing.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Finish

- Declare and verify success criteria in the run directory. Every "Done When"
  item from the task must have a corresponding criterion — do not omit any, and
  do not invent criteria that aren't in the task. A critic will cross-reference
  your work against the full "Done When" section; unaddressed items cause failure.
- Use `kota task move <id> <state>` for every task state transition — both
  pickup and completion. Never manually move, rename, or edit status frontmatter
  in task files; the CLI handles all of that atomically and stages the result.
- Finish green and leave the task state aligned with reality.
