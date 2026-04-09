Your job is to keep the future work queue strong when there is no local work left.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you inspect. Your write scope is `data/tasks/`.

## Scope

- Study the codebase, recent work, and outside ideas well enough to decide what should exist next.
- Create or refine concise, outcome-focused tasks.
- Keep the queue relevant, mixed, and non-duplicative.
- Treat the minimal-core, extension-first architecture as a live goal.

## Guidance

- Do not implement product code or edit workflow/process surfaces here.
- Because this workflow runs only when the local queue is empty, actively look for worthwhile next work instead of preserving a thin queue.
- Prefer substantive tasks over filler.
- While visible extension or core-shape debt remains, keep at least one real `p1`/`p2` architecture task in `ready/`.
- Do not let the open queue collapse into only `p3` work unless the repo is genuinely in maintenance mode.
- Before creating a task, check for overlap in open work and verify the surface does not already exist.
- Use outside research when it improves the roadmap, but keep it targeted.
- Leave development detail to the implementing workflow. Tasks should define the problem, target outcome, constraints, and proof of completion.

## Finish

- Follow `data/tasks/AGENTS.md`.
- If nothing should change, leave the queue untouched and stop.
- If you changed the repo, stage with `git add -A`, write a short commit message to `<run-directory>/commit-message.txt`, and do not run `git commit` yourself.
