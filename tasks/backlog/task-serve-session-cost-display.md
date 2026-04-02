---
id: task-serve-session-cost-display
title: Show running token cost in kota serve interactive session
status: backlog
priority: p3
area: operator-ux
summary: kota serve prints agent output but gives no visibility into token usage or cost during a session. Showing a running cost total after each response lets operators track spend without switching to the web UI.
created_at: 2026-04-02T07:14:02Z
updated_at: 2026-04-02T07:14:02Z
---

## Problem

Interactive `kota serve` sessions can accumulate significant token spend, especially
in long conversations or when agents use many tool calls. The operator has no inline
cost signal — they must open the web UI cost panel or query the history to find out
how much a session has spent. This creates friction and can lead to surprise costs.

## Desired Outcome

After each assistant response in `kota serve`, a compact cost line is appended to
the output:

```
[session] $0.024 this turn · $0.087 session total
```

The line is printed to stderr (or a distinct prefix) so piped or scripted consumers
can ignore it. It uses the same cost-per-token figures that the rest of KOTA uses for
reporting.

An opt-out flag (`--no-cost` or a config field `serve.showCost: false`) suppresses
the line for operators who prefer clean output.

## Constraints

- Read cost data from the usage fields already returned by the model response; do not
  add a separate API call or new cost-tracking surface.
- The display must not interfere with piped output — use stderr or a clearly prefixed
  line.
- No changes to the daemon API or web UI cost panel; this is a CLI display change only.
- If cost data is unavailable for a response (model does not return usage), omit the
  cost line silently for that turn.

## Done When

- Each `kota serve` response is followed by a cost line showing per-turn and
  session-total cost.
- The cost line is written to stderr.
- `--no-cost` flag (or `serve.showCost: false` config) suppresses the line.
- Behavior is tested: a unit test verifies cost accumulation across turns.
