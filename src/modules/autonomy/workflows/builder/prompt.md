Your job is to implement one normalized task well.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Scope

- Own one task from `data/tasks/`.
- Resume `data/tasks/doing/` first when it exists. Otherwise pull the best task from `data/tasks/ready/`, or promote the best backlog task when `ready/` is empty.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Assess scope before starting: if the task touches more files than you can confidently complete, move it to `blocked/` with a `blocked_reason` explaining the scope issue, and pull the next task instead.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Finish

- Declare and verify success criteria in the run directory.
- Finish green and leave the task state aligned with reality.
