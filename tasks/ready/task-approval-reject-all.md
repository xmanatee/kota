---
id: task-approval-reject-all
title: Add kota approval reject-all command for batch rejecting pending tool calls
status: ready
priority: p3
area: cli
summary: The approval queue has approve-all for bulk approval but no symmetric reject-all. Operators who want to clear a backlog of unwanted pending tool calls must reject them one at a time.
created_at: 2026-04-02T09:32:00Z
updated_at: 2026-04-02T09:32:00Z
---

## Problem

`kota approval approve-all` (recently shipped) lets operators batch-approve all pending
items, with optional `--risk` filtering and `--note` attachment. The symmetric
`reject-all` does not exist. Operators who want to dismiss a batch of pending approvals
(e.g., after pausing the daemon to clear a bad run's approvals) must call
`kota approval reject <id>` for each one individually.

This asymmetry is especially noticeable when a misconfigured autonomous run generates
many approval requests in quick succession.

## Desired Outcome

`kota approval reject-all` batch-rejects all pending approval items, with the same
option surface as `approve-all`:

- `--risk <level>` — only reject items of that risk level (safe, moderate, dangerous).
- `--reason <text>` — optional rejection reason attached to every rejected item.
- `--yes` — skip the confirmation prompt.

The command prints a summary of how many items were rejected.

## Constraints

- Follows the same structure as `approve-all` in `approval-cli.ts`.
- Uses the existing `ApprovalQueue.reject(id, reason?)` method — no new queue API needed.
- Dry-runs the set to reject (shows items and count) before prompting for confirmation,
  unless `--yes` is passed.
- Does not emit bus events beyond the existing `approval.resolved` events already fired
  by `reject()`.

## Done When

- `kota approval reject-all` rejects all pending approvals and prints a count.
- `--risk` filter limits the scope to matching items.
- `--reason` attaches a rejection reason to each item.
- `--yes` bypasses the confirmation prompt.
- Unit test covers bulk rejection with and without `--risk` filter.
