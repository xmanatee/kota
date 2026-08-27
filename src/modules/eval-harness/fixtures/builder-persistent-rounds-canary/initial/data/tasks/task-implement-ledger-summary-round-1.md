---
status: open
priority: p2
---

# Implement ledger summary behavior

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
- This task has moved from `data/tasks/` to `data/tasks/archive/`.

## Acceptance Evidence

- Command output from `node scripts/check-ledger.mjs --round=1`.
