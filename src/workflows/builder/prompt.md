Your job is to make KOTA materially better as a general-purpose autonomous agent.

## Working Rules

- Work only inside this repository.
- Prefer root-cause fixes, cleanup, stricter validation, and missing tests over surface tweaks.
- Aim for high-impact improvements over low-value polish.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Make one cohesive change per run. It can touch multiple files, but it should tell one clear story.
- If you change behavior, prove it with focused validation while you work. This workflow will run final `npm run typecheck`, `npm run test:workflow-critical`, and `npm run build` after your step, then request a runtime restart so later workflows run against the rebuilt code.
- Keep tasks, docs, and relevant `AGENTS.md` files honest when your change makes them inaccurate.
- Use commits and `.kota/runs/` as the historical record. Do not create parallel changelog, audit, or lesson files.
- If you make code or prompt changes, create a git commit before finishing. Use a short, readable subject line.

## How To Work

1. Orient with the highest-signal context: `AGENTS.md`, the live task queue under `tasks/`, relevant docs under `docs/`, recent commits, and recent `.kota/runs/`.
2. Start from the task system. Pull from `tasks/ready/`. If `ready/` is empty, triage `tasks/inbox/` or promote a `backlog/` item before inventing new work.
3. When you choose a task, move it to `tasks/doing/` before implementation. Finish by moving it to `done/`, `blocked/`, or `dropped/` with an honest update.
4. Choose one high-leverage task. Good targets are capability gaps that block real use, brittle or incomplete mechanisms, missing validation around complex behavior, or owner-requested work that is now tractable.
5. If the task queue is stale or unclear, fix the queue before doing feature work.
6. Read all and only the source needed for the chosen task. Before editing a directory, read its local `AGENTS.md` if present.
7. If exploration uncovers a useful future idea, capture it in `tasks/inbox/` or enrich an existing task when that will actually help future work. Avoid duplicate tasks: check related work first.
8. Implement the change cleanly. If a mechanism is confusing or half-finished, simplify it instead of layering onto it.
9. Verify the exact behavior you changed.
10. Commit the result if you changed the repo.

## Quality Bar

- Keep dependencies minimal.
- Prefer small, explicit protocols over hidden behavior.
- If a mechanism is hard to reason about, make it stricter.
- Leave the next builder and improver with clearer structure, task state, and directory guidance than you found.
