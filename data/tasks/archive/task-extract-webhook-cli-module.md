---
status: done
---

# Move webhook-cli.ts into the existing webhook module

## Problem

`src/webhook-cli.ts` registers `kota webhook` subcommands (list, generate-secret, clear-secret) and is imported directly by `src/cli.ts`. The webhook module already exists at `src/modules/webhook/index.ts` and owns the webhook receiver logic. The CLI commands are logically part of that module but have not been migrated.

## Desired Outcome

- `src/modules/webhook/index.ts` contributes the `kota webhook` CLI commands through the normal module `commands` surface
- `src/webhook-cli.ts` is removed
- `src/cli.ts` no longer imports `registerWebhookCommands`

## Constraints

- No change to command names, flags, or output.
- `src/modules/AGENTS.md` Built-in Modules entry for webhook is updated to note CLI ownership.
- `src/AGENTS.md` Key Modules entry removed for webhook-cli.

## Done When

- `kota webhook list/generate-secret/clear-secret` work identically after the move.
- `src/webhook-cli.ts` is removed.
- `src/cli.ts` no longer imports from webhook-cli.
- All tests pass.
