---
id: task-add-resource-watchlist-to-explorer-workflow
title: Add resource watchlist to explorer workflow
status: backlog
priority: p2
area: autonomy
summary: Give the explorer a curated list of external resources to monitor regularly for inspiration and updates, in addition to its existing open-ended discovery.
created_at: 2026-04-13T16:22:32.672Z
updated_at: 2026-04-13T16:22:32.672Z
---

## Problem

The explorer workflow discovers new ideas through open-ended research but has no mechanism to regularly revisit a curated set of known-valuable external resources. Interesting projects (e.g. similar open-source efforts, inspiration repos) are checked at most once and then forgotten.

## Desired Outcome

The explorer can maintain and consult a persistent watchlist of external resources (GitHub repos, project pages, etc.) alongside its open-ended discovery. During exploration runs it checks watchlist entries for meaningful updates and new inspiration, while still freely discovering resources outside the list. New resources found during exploration can be added to the watchlist.

Seed resources from the original capture:
- https://github.com/openclaw/openclaw
- https://github.com/zeroclaw-labs/zeroclaw
- https://github.com/RightNow-AI/openfang
- https://github.com/badlogic/pi-mono

## Constraints

- The watchlist should be a simple data file, not a code-level registry.
- Watching must not block or dominate exploration runs — it supplements open discovery.
- Inaccessible URLs should be flagged, not silently dropped.

## Done When

- A persistent watchlist file exists under `data/` and the explorer prompt references it.
- Explorer runs consult the watchlist when doing research.
- The explorer can add new entries to the watchlist during a run.
- Open-ended discovery still works independently of the watchlist.
