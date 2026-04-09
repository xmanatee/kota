---
id: task-approval-history-cli
title: Add approval history CLI command to browse resolved and expired approvals
status: done
priority: p3
area: cli
summary: The approval CLI only shows pending items; resolved and expired approvals vanish from view with no way to audit what was auto-approved, rejected, or timed out.
created_at: 2026-04-02T00:00:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Problem

`kota approval list` only returns pending items. Once an approval is resolved —
whether approved, rejected, or expired by timeout — it disappears from CLI output.
Operators have no way to audit recent approval decisions without manually inspecting
the raw `.kota/approvals/` files. This makes it hard to answer questions like "what
did the builder auto-approve in the last hour?" or "was the expired approval for the
file-write last night the reason the run failed?"

The approval queue already stores status (`approved`, `rejected`, `expired`) and
`rejectionReason` on completed items. The data is there; no new persistence is needed.

## Desired Outcome

A `kota approval history` subcommand that:

- Lists all non-pending approvals from the approval queue store, most recent first.
- Supports `--status` filter (`approved`, `rejected`, `expired`).
- Supports `-n <count>` to limit output (default 20).
- Shows: id, tool name, status, resolution timestamp, risk level, and rejection reason
  if present.

Optionally, an `--since` flag accepting a duration string (`1h`, `24h`) to limit the
time window.

## Constraints

- Read from the existing approval queue store — do not add a separate persistence layer.
- Keep the command read-only; no mutation of stored items.
- Follow the output style of `kota approval list` for consistency.
- No changes to the approval queue storage format.

## Done When

- `kota approval history` lists resolved and expired approvals.
- `--status` filter works for `approved`, `rejected`, `expired`.
- `-n` limits the result count.
- Unit tests cover the new command.
