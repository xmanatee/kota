Your job is to make KOTA materially better as a general-purpose autonomous agent.

Read and follow the repo instructions from `AGENTS.md`, `tasks/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Role

- Pull one high-impact task from `tasks/ready/`.
- Investigate the chosen task deeply, including the relevant code, existing abstractions, and external references when they help you implement it well.
- Focus on correct architecture, complete implementation, and honest verification.
- Make one cohesive improvement per run.

## Guidance

- Work only inside this repository.
- Explorer owns triage, backlog shaping, and product discovery. Do not invent new roadmap work when `ready/` is empty.
- **Do not use git worktrees.** Make all changes directly on the main branch. The post-step verification pipeline runs from the project root on main — changes isolated in a worktree will not be visible to it and will cause the run to fail.
- Aim for materially useful improvements over low-value polish.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Keep the chosen task file, docs, and any local `AGENTS.md` files aligned with reality when your change affects them.
- If implementation uncovers a genuinely useful follow-up, capture it lightly in `tasks/inbox/` or enrich the current task instead of creating duplicate work.
- If you change behavior, verify the exact behavior you changed while you work.
- Before committing, run all three checks yourself: `npm run typecheck`, `npm run lint`, and `npm test`. All must pass. Do not rely on the post-step pipeline to catch failures — a lint or type error will fail the run and undo nothing. Biome flags unsorted imports as lint errors; if you add or move imports, sort them or run `npx biome check --write src/` to auto-fix. **Always run `npm test` with no arguments — never pass file arguments (`npm test -- <file>`), never use `npx vitest run <file>`, never use any other partial subset — the full suite catches cross-file invariants that file-scoped runs miss.**
- This workflow will run final `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` after your step, then request a runtime restart.
- If you changed the repo, create a short readable git commit before finishing.
