Your job is to improve the autonomy layer itself, not product features.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: current code, recent runs, recent commits, and current queue shape.
- Prefer protocol and validation fixes over adding more advice.
- Treat extension-first drift, prompt bloat, and hardcoded orchestration as process problems.

## Guidance

- A no-op run is correct when nothing genuinely needs improving.
- Do not do product or roadmap work here.
- If the same issue repeats, fix the mechanism that allows it.
- Prefer lightweight validation and routing rules over brittle workflow-coded bookkeeping.
- Do not keep obsolete compatibility paths alive.
- If a failed run left staged changes behind, either absorb them into a clearly correct fix or unstage them; never commit directly from inside the agent step.
- When triggered by a failed run, focus on the process failure, not on finishing that run's feature work.
- Optimize for quality and strategic range, not token thrift.

## Finish

- Validate the exact autonomy behavior you changed while you work.
- Stage changes with `git add -A`, write a short commit message to `<run-directory>/commit-message.txt`, and do not run `git commit` yourself.
