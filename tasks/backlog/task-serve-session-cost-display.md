---
id: task-serve-session-cost-display
title: Improve per-turn cost display in kota serve and add opt-out flag
status: backlog
priority: p3
area: operator-ux
summary: kota serve already prints a cumulative cost line after each turn via transport.ts, but it only shows the running total — not the per-turn increment. Adding a per-turn vs cumulative breakdown and a --no-cost opt-out flag would complete the cost visibility story.
created_at: 2026-04-02T07:14:02Z
updated_at: 2026-04-02T07:51:00Z
---

## Problem

`loop-send.ts` emits a `cost` transport event after each agent turn, and
`transport.ts` renders it as `[kota] Turn N — $X.XXXX (Xk input, Xk output) — context: Y%`
to stderr. This is useful but shows only the session running total — the per-turn
increment is not visible. Over a long session, it becomes hard to see which turns were
expensive. Additionally, there is no opt-out for operators who want clean stderr output.

## Desired Outcome

The per-turn cost line gains a clearer breakdown:

```
[kota] Turn 3 — $0.024 this turn · $0.087 total — context: 8%
```

And an opt-out mechanism suppresses the line entirely for operators who prefer
minimal output.

## Constraints

- The change is in `transport.ts` (display) and `loop-send.ts` or `cost.ts` (tracking
  the per-turn delta); do not add a new cost-tracking surface.
- Opt-out via `--no-cost` CLI flag or `serve.showCost: false` config field.
- No changes to the daemon API or web UI cost panel.
- The existing `cost` transport event shape should remain backward-compatible if other
  consumers (e.g. `vercel-ai-stream.ts`) rely on it; extend, do not replace.

## Done When

- Per-turn cost line shows incremental cost for that turn and the session running total.
- `--no-cost` flag (or `serve.showCost: false` config) suppresses the cost line.
- Unit test verifies the per-turn vs session-total split across multiple turns.
