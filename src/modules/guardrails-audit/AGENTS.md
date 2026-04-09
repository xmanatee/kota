# Guardrails-Audit Module

Owns the guardrail audit trail: subscribes to `guardrail.assessed` events and writes entries to `.kota/audit.jsonl`.

- `store.ts` — append-only audit store for guardrail decisions.
- `cli.ts` — `kota audit` subcommands for querying and exporting the audit log.
