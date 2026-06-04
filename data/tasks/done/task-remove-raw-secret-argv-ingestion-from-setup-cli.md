---
id: task-remove-raw-secret-argv-ingestion-from-setup-cli
title: Remove raw secret argv ingestion from setup CLI
status: done
priority: p1
area: modules
summary: Change setup CLI secret collection so raw credentials are not accepted through process arguments or shell history.
created_at: 2026-06-04T13:06:33.550Z
updated_at: 2026-06-04T16:28:07.000Z
---

## Problem

The setup CLI currently accepts raw secrets through process arguments:

- `src/modules/setup/index.ts:215-229`
- `src/modules/setup/index.ts:243-255`

Even if KOTA never prints those values, command-line arguments can leak through
shell history, process listings, terminal transcripts, and operator logs. This
conflicts with the local setup module contract:

- `src/modules/setup/AGENTS.md:9-11`

It also weakens the owner's requested auth/config protocol: every client should
support authing without exposing credentials to agents, prompts, or incidental
logs.

## Desired Outcome

Remove raw secret ingestion from CLI argv. Sensitive setup values should be
collected through stdin, a masked interactive prompt, a route body supplied by a
client secret field, or an opaque secret reference. Non-sensitive form values
may remain normal CLI input.

The CLI help and tests should make the safe path obvious and leave no supported
raw `--secret-values <json>` argument.

## Constraints

- Do not keep both raw argv and safe stdin/prompt paths.
- Do not print or echo submitted secret values in success, error, JSON, or
  transcript output.
- Preserve machine-usable non-sensitive setup commands.
- Keep the daemon route body path available for trusted clients that collect
  secret fields safely.

## Done When

- `setup secret` and `setup complete` no longer accept raw credential JSON in
  argv.
- CLI tests or transcript fixtures prove secrets can be supplied safely without
  appearing in command arguments or output.
- The setup module `AGENTS.md` stays accurate after the implementation.
- `pnpm run typecheck`, focused setup CLI tests, and `pnpm run validate-tasks`
  pass.

## Source / Intent

Architecture/security re-review on 2026-06-04. The owner asked that modules
requiring auth/tokens have a protocolized flow and that credentials/settings
storage, refresh, access, and client support be thought through rigorously.

## Initiative

Protocolized setup and credential lifecycle.

## Acceptance Evidence

- CLI test output or transcript showing safe secret submission with redacted
  output.
- Help output or snapshot proving raw `--secret-values <json>` is gone.

## Result

Setup CLI secret submission now reads secret JSON from stdin, the removed raw
argv option is rejected, and CLI rendering redacts submitted secret values from
text and JSON output. Focused setup CLI tests cover stdin submission, removed
help entries, removed-option rejection, and redaction.
