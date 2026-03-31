---
id: task-kota-init-command
title: Add kota init command to scaffold a new KOTA project
status: ready
priority: p2
area: cli
summary: There is no guided setup path for new KOTA projects. Operators must manually create kota.config.ts, directory structure, and extensions. A kota init command would lower the barrier to adoption and reduce misconfiguration errors.
created_at: 2026-03-31T13:43:00Z
updated_at: 2026-03-31T14:10:00Z
---

## Problem

Setting up a new KOTA project requires manually creating `kota.config.ts`, the `.kota/` runtime directory, `tasks/` subdirectories, and wiring any initial extensions. There is no guided setup path. New operators must read docs, copy config snippets, and discover the required structure on their own. `kota doctor` validates an existing setup but cannot create one.

## Desired Outcome

A `kota init` command that, when run in an empty or bare directory:
- Creates `kota.config.ts` with commented-out extension blocks and sensible defaults.
- Creates `tasks/inbox/`, `tasks/ready/`, `tasks/backlog/`, `tasks/doing/`, `tasks/blocked/`, `tasks/done/`, `tasks/dropped/` directories with placeholder `AGENTS.md` stubs.
- Creates a `docs/` directory with a placeholder `AGENTS.md`.
- Prints a short "what's next" message pointing to `kota doctor` and `docs/`.
- Is idempotent: skips existing files/directories without overwriting user content.
- Accepts a `--force` flag to overwrite only the generated `kota.config.ts` (not tasks).

## Constraints

- Do not overwrite any existing file unless `--force` is passed.
- Generated `kota.config.ts` should include commented-out extension blocks for Telegram, Slack, and webhook so operators can uncomment what they need.
- No external dependencies beyond Node's built-in `fs`.
- The command should work whether or not a daemon is running.

## Done When

- `kota init` creates the expected directory structure and config file.
- Running `kota init` a second time is a no-op (idempotent).
- `kota doctor` passes after `kota init` with no extension errors.
- At least one test covers the scaffold output and idempotency.
- `docs/CONFIG.md` or the CLI help text references `kota init` for first-time setup.
