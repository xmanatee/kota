Your job is to make KOTA materially better as a general-purpose autonomous agent.

Read and follow the repo instructions from `AGENTS.md`, `tasks/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Role

- Pull one high-impact task from `tasks/ready/`.
- If `ready/` is empty, promote one `backlog/` item to `ready/` and then execute it as this run's task. Promotion alone is not a run's improvement — always pair it with the actual work.
- If `inbox/` is non-empty, triage it first before promoting from backlog.
- If `inbox/`, `ready/`, and `backlog/` are all empty, identify one meaningful improvement directly from the codebase — look for missing tests, weak validation, unclear boundaries, or functionality gaps — create a task for it, and execute it in the same run.
- Prefer root-cause fixes, cleanup, stricter validation, and missing tests over surface tweaks.
- Make one cohesive improvement per run.

## Guidance

- Work only inside this repository.
- **Do not use git worktrees.** Make all changes directly on the main branch. The post-step verification pipeline runs from the project root on main — changes isolated in a worktree will not be visible to it and will cause the run to fail.
- Aim for materially useful improvements over low-value polish.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Keep tasks, docs, and local `AGENTS.md` files aligned with reality when your change affects them.
- When moving any task between directories, update the `status` frontmatter field to match the target directory name exactly (e.g. `status: done` when placing in `done/`). The test suite validates `status == directory-name` on every run.
- When moving a task file (write new location, delete old), always stage the deletion explicitly: `git rm tasks/<dir>/<file>` or `git add tasks/<dir>/<file>` on the deleted path. Do not only stage the new file — the old copy must also be committed or the deletion will be left dangling in the working tree.
- Task lifecycle within a single run: if you start and complete a task in the same run, move it directly from its source directory to `done/` — do **not** create an intermediate `doing/` copy. A file must appear in exactly one task directory at the end of the run. Never commit a task that exists in two directories at once (e.g. both `doing/` and `done/`).
- When moving a task out of `inbox/` (to backlog, ready, doing, done, or dropped), also ensure the file has all required sections: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- Before creating any new task file, scan all task directories (`inbox/`, `backlog/`, `ready/`, `doing/`, `blocked/`, `done/`, `dropped/`) for an existing task covering the same subject. If one exists, enrich it rather than creating a duplicate. Tasks in `done/` or `dropped/` should not be recreated.
- If you change behavior, verify the exact behavior you changed while you work.
- Before committing, run all three checks yourself: `npm run typecheck`, `npm run lint`, and `npm test`. All must pass. Do not rely on the post-step pipeline to catch failures — a lint or type error will fail the run and undo nothing. Biome flags unsorted imports as lint errors; if you add or move imports, sort them or run `npx biome check --write src/` to auto-fix. **Always run `npm test` — never `npx vitest run <file>` or any partial subset — the full suite catches cross-file invariants that file-scoped runs miss.**
- This workflow will run final `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` after your step, then request a runtime restart.
- If you changed the repo, create a short readable git commit before finishing.
