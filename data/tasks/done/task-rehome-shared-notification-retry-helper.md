---
id: task-rehome-shared-notification-retry-helper
title: Rehome the shared notification retry helper
status: done
priority: p2
area: modules
summary: src/modules/notify-retry.ts is a top-level shared helper under modules instead of belonging to a module or core protocol boundary.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-14T01:42:30.085Z
---

## Problem

`src/modules/notify-retry.ts` is a top-level file under `src/modules/`, while
the local module instructions say that directory should mostly contain actual
module directories and top-level files should be rare. Slack and webhook import
this helper directly, so shared notification behavior lives outside a clear
ownership boundary.

This is small, but it is exactly the kind of shared bucket that makes the module
tree harder to reason about over time.

## Desired Outcome

Notification retry behavior has a clear home. It is either part of a small
notification/shared-delivery module with declared dependents, or it is moved
into a core notification primitive if it is truly runtime substrate. The
top-level `src/modules/notify-retry.ts` file is removed.

## Constraints

- Do not add a wrapper file or compatibility re-export.
- Do not create a module that owns no real behavior.
- Keep Slack and webhook modules self-contained except for declared dependencies.
- Preserve existing retry semantics and tests.

## Done When

- No production helper file remains directly under `src/modules/`.
- Slack and webhook notification retry imports point to the new owning boundary.
- Tests cover retry behavior through the real importing modules.
- `src/modules/AGENTS.md` remains accurate.
