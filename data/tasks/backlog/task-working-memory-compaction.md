---
id: task-working-memory-compaction
title: Working memory compaction — auto-prune stale entries on context pressure
status: backlog
priority: p2
area: reliability
summary: Working memory has hard limits (20 entries, 4000 chars total) with no automatic compaction. When limits are hit, new entries silently fail or oldest entries are dropped without summarization. Add a compaction step that condenses or removes stale entries when pressure rises.
created_at: 2026-04-10T06:50:00Z
updated_at: 2026-04-10T06:50:00Z
---

## Problem

Working memory (`src/memory/working-memory.ts`) caps at 20 entries and 4000 total characters. When these limits are reached:
- New `setEntry` calls that would overflow are silently capped (the tool returns success but nothing is stored, or the oldest entry is evicted without notice).
- The agent loses context it believed it had written — this can cause subtly wrong behavior in long autonomous sessions.

There is no mechanism to compact or summarize entries that have grown stale relative to the current task. The 4000-char limit was chosen conservatively; the fix is not to raise the limit blindly but to give the system a principled way to handle pressure.

## Desired Outcome

When working memory approaches its limits (e.g. > 80% of char budget used, or > 16 of 20 entry slots), a compaction step is triggered:
1. Entries not updated in the current session "turn window" are candidates for compaction.
2. A lightweight summarization pass (short prompt or rule-based truncation) condenses candidate entries.
3. Entries flagged `persistent` survive intact; ephemeral entries are compacted first.
4. The agent receives a `<working-memory-compacted>` note in the next turn's dynamic state so it is aware that compaction occurred.

Compaction should be synchronous and happen before the next turn's dynamic state is collected. It does not require a new model call — rule-based truncation (trim value to 200 chars + ellipsis) is acceptable for v1.

## Constraints

- Do not change the working-memory tool's public API (setEntry/getEntry/listEntries/removeEntry/clearAll).
- Persistent entries must survive compaction regardless of pressure.
- Compaction must be opt-out configurable (default: on).
- The compaction logic belongs in `src/memory/working-memory.ts` or a co-located helper, not in the turn loop.
- Tests must cover: normal operation, compaction trigger, persistent-entry survival, agent notification.

## Done When

- Working memory compacts automatically when approaching limits.
- Persistent entries are never lost to compaction.
- The agent sees a clear signal when compaction has occurred.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` all pass.
