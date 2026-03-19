# Standards

## Repository Surfaces

- `docs/` is for durable reference docs and historical notes that still help.
- `tasks/` is the live work queue and the source of truth for outstanding work.
- Local `AGENTS.md` files explain directory purpose and boundaries.

## Documentation

- Keep docs concise, high-level, and current.
- Do not duplicate code, tests, prompts, or other docs unless duplication changes decisions.
- Prefer one clear source of truth per topic.

## AGENTS.md Files

- Every meaningful repo directory should have a local `AGENTS.md`.
- Each file should explain what belongs in the directory, its role in the system, and any important boundaries.
- Avoid implementation detail, file-by-file inventories, or repeated content from nearby docs.

## Maintenance

- Any agent or contributor may update these docs when structure or priorities change.
