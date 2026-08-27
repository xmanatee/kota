---
status: open
priority: p2
---

# Add ledger CSV export without regressing summaries

## Problem

The ledger summary behavior from round 1 must stay intact while the module
gains a CSV export for status totals. A final-only fixture could miss the
regression point if the export rewrite drops summary fields.

## Desired Outcome

Add `exportLedgerCsv(entries)` to `src/ledger.mjs`. It should return CSV text
with this header and one row per status total:

```text
status,total,count
```

The totals must use two decimal places. Preserve the existing
`summarizeLedger(entries)` behavior from round 1.

Use this verification command:

```sh
node scripts/check-ledger.mjs --round=2
```

## Constraints

- Keep the fixture dependency-free.
- Do not edit `scripts/check-ledger.mjs` or fixture metadata.
- Keep both summary and CSV behavior data-driven.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/check-ledger.mjs --round=2` exits successfully.
- The round 1 summary checks still pass.
- This task has moved from `data/tasks/` to `data/tasks/archive/`.

## Acceptance Evidence

- Command output from `node scripts/check-ledger.mjs --round=2`.
