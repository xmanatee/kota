Your job is to implement one normalized task well.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Scope

- Own one task from `data/tasks/`.
- Resume `data/tasks/doing/` first when it exists. Otherwise pull the best task from `data/tasks/ready/`, or promote the best backlog task when `ready/` is empty.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Block or decompose only when the task is genuinely incoherent, externally blocked, or impossible to complete without guessing.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Finish

- Declare and verify success criteria in the run directory.
- Follow `data/tasks/AGENTS.md` for task file handling. Move the task to its
  final state directory, update its `status` frontmatter, and ensure it is
  tracked in git.
- Finish green and leave the task state aligned with reality.
