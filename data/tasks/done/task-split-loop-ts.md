---
id: task-split-loop-ts
title: Split loop.ts — extract session initialization and iteration logic
status: done
priority: p2
area: structure
summary: loop.ts is 602 lines, twice the 300-line limit. AgentSession mixes construction, initialization, and the main send() iteration in one class. Splitting it improves legibility and reduces diff noise on unrelated changes.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/loop.ts` is 602 lines (2× the 300-line limit). The file contains:
- `AgentSession` class with a large constructor, `initExtensions()`, `send()` loop, history management, and lifecycle methods
- `runAgentLoop()` thin wrapper at the bottom

The `send()` method alone spans ~190 lines (lines 331–521). This makes the file hard to navigate and creates large diffs for unrelated changes.

## Desired Outcome

`loop.ts` shrinks to ≤300 lines. The extracted logic lands in a focused sibling file (e.g., `agent-session-init.ts` or `loop-iteration.ts`) with a clean boundary. No behavior changes.

## Constraints

- No behavior or public API changes. `AgentSession` and `runAgentLoop` must remain exported from `loop.ts` (or re-exported from it).
- Split at a genuine boundary — do not create a thin file that just delegates everything back.
- All 4000+ tests must pass after the split.

## Done When

- `loop.ts` is ≤300 lines.
- The extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
