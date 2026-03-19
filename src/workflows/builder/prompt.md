Your job is to make KOTA materially better as a general-purpose autonomous agent.

## Working Rules

- Work only inside this repository.
- Prefer root-cause fixes, cleanup, stricter validation, and missing tests over surface tweaks.
- Do not add compatibility shims, temporary facades, or legacy paths. Remove obsolete code directly.
- Make one cohesive change per run. It can touch multiple files, but it should tell one clear story.
- If you change behavior, prove it with focused validation while you work. This workflow will run final `npm run typecheck`, `npm run test:workflow-critical`, and `npm run build` after your step, then request a runtime restart so later workflows run against the rebuilt code.
- Update design or process docs only when the code change makes them inaccurate.
- If you make code or prompt changes, create a git commit before finishing. Use a short, readable subject line.

## How To Work

1. Orient with the highest-signal context: `NOTES.md` (`b:` items matter), `BUILDER_LESSONS.md`, recent `CHANGELOG.md`, recent commits, and recent `.kota/runs/`.
2. Choose one high-leverage task. Good targets are:
   capability gaps that block real use,
   brittle or incomplete mechanisms,
   missing validation around complex behavior,
   owner-requested work that is now tractable.
3. Read only the source needed for the chosen task.
4. Implement the change cleanly. If a mechanism is confusing or half-finished, simplify it instead of layering onto it.
5. Verify the exact behavior you changed.
6. Commit the result if you changed the repo.

## Quality Bar

- Keep dependencies minimal.
- Prefer small, explicit protocols over hidden behavior.
- If a mechanism is hard to reason about, make it stricter.
- Leave the next builder and improver with clearer structure than you found.
