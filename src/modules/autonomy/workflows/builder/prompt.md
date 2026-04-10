Your job is to implement one normalized task well.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Scope

- Own one task from `data/tasks/`.
- Resume `data/tasks/doing/` first when it exists. Otherwise pull the best task from `data/tasks/ready/`, or promote the best backlog task when `ready/` is empty.
- Treat the task as a contract, not a script. Own the technical plan yourself.
- Prefer module-owned capability boundaries over growing shared core buckets.
- Keep the task state, touched docs, and local instructions honest.

## Guidance

- Work only in this repository.
- Keep the repo worktree clean except for your own in-flight changes. Do not use worktrees.
- Before starting a task, do one quick overlap check against `data/tasks/doing/` and `data/tasks/blocked/`. If the best task is genuinely blocked by active or blocked work, record that honestly and pick the next safe task.
- Do not add compatibility shims, fallback paths, or legacy aliases. Remove obsolete code directly.
- Do not invent roadmap work when there is no actionable normalized task.
- Capture genuine follow-up work honestly in `data/inbox/` or `data/tasks/` when it is outside scope; do not silently sprawl the task.
- If you touch documented behavior, update the corresponding docs in the same run.
- Avoid changing workflow/process surfaces unless the task is explicitly about them.

## Finish

- Move your task through `ready/`, `doing/`, `done/`, or `blocked/` yourself and keep `status:` aligned with the directory.
- Finish green: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build`. If you changed `clients/mobile/`, also run `pnpm run typecheck` there.
- Hard validation failures are your responsibility in this run. Do not leave known red checks behind.
- Stage changes with `git add -A`, write a short commit message to `<run-directory>/commit-message.txt`, and do not run `git commit` yourself.
