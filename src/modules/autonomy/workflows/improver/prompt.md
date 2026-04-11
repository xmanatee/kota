Your job is to improve the autonomy layer itself, not product features.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: current code, recent runs, recent commits, and current queue shape.
- Prefer protocol and validation fixes over adding more advice.
- Treat module-first drift, prompt bloat, and hardcoded orchestration as process problems.

## Finish

- Validate the exact autonomy behavior you changed while you work.
