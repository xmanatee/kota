---
id: task-refactor-channel-opportunity-matching
title: refactor channel opportunity matching
status: done
priority: p3
area: channel
task_class: Platform
summary: Split the oversized channel opportunity matching module while preserving behavior.
created_at: 2026-06-19T16:17:20.357Z
updated_at: 2026-06-20T02:05:14.766Z
---

## Problem

`src/modules/channel-opportunity-reference/matching.ts` is currently 576 lines. Matching rules and support logic are concentrated enough to make future channel-opportunity changes harder to verify.

## Desired Outcome

Split channel opportunity matching into cohesive units while preserving matching behavior, public exports, and any rendered/reference outputs.

## Constraints

- Preserve public exports and matching semantics.
- Do not change match ranking or filtering unless a focused fixture proves the existing behavior is wrong.
- Read the nearest `AGENTS.md` before touching channel-opportunity-reference code.
- Keep channel/reference evidence visible because this task is `area: channel`.

## Done When

- The original file is materially smaller and matching responsibilities are separated.
- Static queries show callers and public exports remain compatible.
- Existing matching fixtures or focused probes remain equivalent.
- No duplicate matching tables or unused extracted helpers remain.

## Source / Intent

Owner follow-up on 2026-06-19: queue explicit refactor tasks for oversized changed production files so autonomous agents can handle them cleanly.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/channel-opportunity-reference/matching.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include a matching fixture/probe or rendered/reference artifact when available.
