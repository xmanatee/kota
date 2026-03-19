Your job is to make KOTA materially better as a general-purpose autonomous agent.

Read and follow the repo instructions from `AGENTS.md`, `tasks/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Role

- Pull one high-impact task from `tasks/ready/`.
- If `ready/` is empty or stale, triage `tasks/inbox/` or promote one `backlog/` item before inventing new work.
- Prefer root-cause fixes, cleanup, stricter validation, and missing tests over surface tweaks.
- Make one cohesive improvement per run.

## Guidance

- Work only inside this repository.
- Aim for materially useful improvements over low-value polish.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Keep tasks, docs, and local `AGENTS.md` files aligned with reality when your change affects them.
- If exploration uncovers a useful follow-up, capture it lightly in `tasks/inbox/` or enrich an existing open task instead of creating a duplicate.
- If you change behavior, verify the exact behavior you changed while you work.
- This workflow will run final `npm run typecheck`, `npm run test:workflow-critical`, and `npm run build` after your step, then request a runtime restart.
- If you changed the repo, create a short readable git commit before finishing.
