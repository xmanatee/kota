---
id: task-cost-circuit-breaker
title: Add cost circuit-breaker to auto-pause on spend limit
status: done
priority: p2
area: workflow
summary: The attention digest warns when 24h spend exceeds a threshold, but the runtime keeps running. A circuit-breaker should write the dispatch-paused signal file when a hard limit is crossed, stopping autonomous execution until the operator manually resumes.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`attention-digest.ts` fires a Telegram alert when 24h spend exceeds `KOTA_DIGEST_COST_THRESHOLD`, but that is advisory only. The runtime continues scheduling builder/improver/explorer runs, potentially compounding the spend. There is no automatic stop.

The runtime already has a `dispatch-paused` signal file mechanism (`PAUSE_SIGNAL_FILE`) that halts dispatch when the file exists at `.kota/dispatch-paused`. Writing that file is all that's needed to stop autonomous execution.

## Desired Outcome

- A configurable hard-limit env var (e.g. `KOTA_COST_HARD_LIMIT_USD`, default e.g. $50) distinct from the soft-warn threshold.
- When total 24h spend crosses the hard limit, write `.kota/dispatch-paused` and send a Telegram alert explaining that the circuit breaker tripped.
- Operator clears the pause by deleting the file (existing `kota runtime resume` or equivalent).
- Soft warn threshold behaviour is unchanged.

## Constraints

- Reuse the existing pause signal file mechanism — no new stop/pause surface.
- Keep the check inside `attention-digest.ts` or a small companion module; do not spread cost logic into the runtime core.
- The hard limit check should run on the same cadence as the existing digest (every N completed runs).

## Done When

- Hard-limit env var is read and compared against 24h spend.
- If exceeded, `.kota/dispatch-paused` is written and an alert is sent.
- Existing soft-warn behaviour is unaffected.
- Tests cover: limit not crossed (no pause), soft warn only (no pause), hard limit crossed (pause + alert).
