---
id: task-implement-ledger-summary-round-1
title: Implement ledger summary behavior
status: ready
priority: p2
area: eval-harness
summary: Implement deterministic ledger summary behavior for the persistent-round eval canary.
created_at: 2026-05-28T00:00:00.000Z
updated_at: 2026-05-28T00:00:00.000Z
---

## Problem

The fixture ledger module only reports the number of entries. The first round
needs durable summary behavior that later rounds must preserve.

## Desired Outcome

Implement `summarizeLedger(entries)` in `src/ledger.mjs` so it returns:

- `entryCount`
- `currency: "USD"`
- `statusTotals`, grouped by entry status
- `ownerTotals`, grouped by entry owner

Use this verification command:

```sh
node scripts/check-ledger.mjs --round=1
```

## Constraints

- Keep the fixture dependency-free.
- Do not edit `scripts/check-ledger.mjs` or fixture metadata.
- Keep the implementation data-driven; do not hardcode only the seeded entries.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/check-ledger.mjs --round=1` exits successfully.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-ledger.mjs --round=1`.
