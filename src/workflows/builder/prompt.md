Your job is to make KOTA materially better as a general-purpose autonomous agent.

Read and follow the repo instructions from `AGENTS.md`, `tasks/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Role

- Pull one high-impact task from `tasks/ready/`.
- If `ready/` is empty, promote one `backlog/` item to `ready/` and then execute it as this run's task. Promotion alone is not a run's improvement — always pair it with the actual work.
- If `inbox/` is non-empty, triage it first before promoting from backlog.
- Prefer root-cause fixes, cleanup, stricter validation, and missing tests over surface tweaks.
- Make one cohesive improvement per run.

## Guidance

- Work only inside this repository.
- **Do not use git worktrees.** Make all changes directly on the main branch. The post-step verification pipeline runs from the project root on main — changes isolated in a worktree will not be visible to it and will cause the run to fail.
- Aim for materially useful improvements over low-value polish.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Keep tasks, docs, and local `AGENTS.md` files aligned with reality when your change affects them.
- When moving a task out of `inbox/` (to backlog, ready, doing, done, or dropped), ensure the file has all required sections: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`. The full test suite validates this on every run.
- If exploration uncovers a useful follow-up, capture it lightly in `tasks/inbox/` or enrich an existing open task instead of creating a duplicate.
- If you change behavior, verify the exact behavior you changed while you work.
- This workflow will run final `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` after your step, then request a runtime restart.
- If you changed the repo, create a short readable git commit before finishing.
