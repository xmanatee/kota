---
id: task-trim-docs-convention-note
title: Trim a stale convention note from docs/conventions.md
status: ready
priority: p3
area: docs
summary: Small documentation-cleanup task used as a fixture seed. Present in ready/ so the queue is non-empty but carries only p3 work, reproducing the strategic-ready-coverage trip.
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-20T00:00:00.000Z
---

## Problem

`docs/conventions.md` is reported to contain a paragraph that restates a
rule already covered by a narrower `AGENTS.md` file. The duplication adds
maintenance weight without changing behaviour.

## Desired Outcome

The stale paragraph is removed and the remaining guidance stays accurate
and non-duplicative. This is a small `p3` cleanup, not load-bearing work.

## Constraints

- Leave other convention notes untouched.
- Keep the doc concise — do not rewrite it.

## Done When

- The stale paragraph is gone from `docs/conventions.md`.
- No new duplication is introduced elsewhere.
