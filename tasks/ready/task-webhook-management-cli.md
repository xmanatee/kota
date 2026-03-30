---
id: task-webhook-management-cli
title: Add kota webhook CLI commands for managing inbound webhook secrets
status: ready
priority: p3
area: cli
summary: The inbound webhook trigger lets workflows accept external HTTP calls, but operators must manually edit .kota/config.json to configure and rotate secrets. A kota webhook subcommand closes this operational gap.
created_at: 2026-03-30T20:54:00Z
updated_at: 2026-03-30T20:54:00Z
---

## Problem

The builder recently added `POST /webhooks/:name` to the daemon control API and a
`webhooks` config block in `kota.config`. Operators must edit `.kota/config.json`
directly to add or change webhook secrets — there is no CLI to list configured
webhooks, generate a new secret, or remove a webhook entry. Secrets are plain strings
that operators must generate themselves and paste in. There is no way to tell at a
glance which workflows have webhook triggers configured.

## Desired Outcome

A `kota webhook` subcommand with:

- `kota webhook list` — prints all workflows that have webhook trigger declared
  (from the manifest/workflow definitions), with a ✓ or ✗ column showing whether
  a secret is configured in `kota.config`. Never prints secret values.
- `kota webhook secret generate <workflow>` — generates a cryptographically random
  secret (e.g. 32-byte hex), writes it to `kota.config` under
  `webhooks.<workflow>.secret`, and prints the secret once so the operator can save
  it. Prints a warning if a secret already exists.
- `kota webhook secret remove <workflow>` — removes the webhook config entry for
  the named workflow from `kota.config`.

## Constraints

- Use Node's built-in `crypto.randomBytes` for secret generation — no new deps.
- Read/write `kota.config` via the existing config load/save path in `src/config.ts`;
  do not manipulate the JSON file directly.
- Secret values are never echoed by `kota webhook list` — only presence/absence.
- Follow existing CLI registration patterns (`registerWebhookCommands` in
  `src/webhook-cli.ts`, registered in `src/cli.ts`).
- Check `src/AGENTS.md` before adding the new file and update it to list
  `webhook-cli.ts` in Key Modules.

## Done When

- `kota webhook list` shows all webhook-triggered workflows with secret status.
- `kota webhook secret generate <workflow>` writes a fresh secret and prints it once.
- `kota webhook secret remove <workflow>` clears the entry from config.
- Unit tests cover list output, generate (new and overwrite-warning), and remove.
- `src/AGENTS.md` Key Modules updated.
