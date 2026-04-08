# Standards

## Repository Surfaces

- `docs/` is for durable reference docs.
- `tasks/` is the live work queue and the source of truth for outstanding work.
- Local `AGENTS.md` files explain directory purpose and boundaries.
- Git history and `.kota/runs/` are the historical record. Do not add parallel changelog, audit, archive, or lesson surfaces.

## Documentation

- Keep docs concise, high-level, and current.
- Do not duplicate code, tests, prompts, or other docs unless duplication changes decisions.
- Prefer one clear source of truth per topic.
- If you change a documented protocol, API surface, CLI behavior, or config behavior, update the corresponding docs in the same run.

## Engineering Rules

- Do not add test-only production flags, hooks, or override parameters just to make tests easier.
- Prefer designs that are naturally testable through clear boundaries and explicit inputs and outputs.
- Avoid optimizing healthy mechanisms for speed or cost at the expense of quality, clarity, or capability.
- Prefer clear discoverable surfaces over injected context summaries. If an
  agent can gather context itself, do not precompute and force-feed it.
- Do not throttle the built-in core autonomy loops with hard daily spend caps by
  default. If autonomy is wasteful, fix the queue, prompts, validation, repair
  flow, or operator controls before capping explorer, builder, or improver.
- Treat runtime, workflow, and core-loop changes as high-risk and verify them more thoroughly than routine edits.

## AGENTS.md Files

- Every meaningful repo directory should have a local `AGENTS.md`.
- Each file should explain what belongs in the directory, its role in the system, and any important boundaries.
- Avoid implementation detail, file-by-file inventories, or repeated content from nearby docs.

## Maintenance

- Any agent or contributor may update these docs when structure or priorities change.
