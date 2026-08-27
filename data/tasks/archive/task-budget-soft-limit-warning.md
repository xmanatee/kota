---
status: done
---

# Add configurable budget soft-limit warning before hard stop

## Problem

The cost budget guard enforces a hard daily limit by blocking new workflow dispatch once the limit is exceeded. Operators only discover the limit was reached retroactively — via the dispatch window indicator in the web UI or a failed workflow trigger — with no advance notice.

For teams running workflows with significant cost variance, there is no mechanism to get an alert when cost is trending toward the limit, giving them no opportunity to pause lower-priority workflows, raise the limit, or take other corrective action before a hard stop interrupts in-progress work.

## Desired Outcome

A new `budget.warnAt` config field (a fraction from 0 to 1, e.g., `0.8` for 80%) triggers a one-time channel notification when daily cost crosses the threshold. The notification includes:
- Current cost, daily limit, and percent consumed
- Estimated time until limit (based on recent burn rate if available)
- Link to the web UI cost panel

The warning fires at most once per budget reset window and resets with the daily budget.

## Constraints

- `budget.warnAt` is optional; omitting it disables soft-limit warnings entirely.
- Warning delivery uses the existing channel notification path (same as failure alerts).
- The `budget.warnAt` check runs inside `BudgetGuard` or a budget-check subscriber, not scattered across callers.
- No new CLI commands required; this is a config-driven feature.

## Done When

- Setting `budget.warnAt: 0.8` in `.kota/config.json` causes a channel notification when daily cost exceeds 80% of the configured limit.
- The notification is sent only once per budget window (not on every step after crossing).
- Omitting `budget.warnAt` causes no change in behavior.
- Existing budget guard tests continue to pass; new unit test covers the threshold-crossing logic.
