---
id: task-split-loop-ts-constructor
title: Split loop.ts — extract constructor body into loop-constructor.ts
status: done
priority: p2
area: structure
summary: loop.ts is 301 lines, just over the 300-line limit. The constructor is ~163 lines and mixes service initialization, system prompt building, context restoration, and tool configuration. Extracting this into a helper brings loop.ts well under the limit.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/loop.ts` is 301 lines — 1 line over the 300-line limit. The file was previously split (from 602 lines), but the constructor body (~163 lines, lines 94–257) has grown back. It mixes four concerns:
1. Options-to-field assignment and model/thinking config
2. Service initialization (`initTaskStore`, `initScheduler`, `initAuditStore`, etc.)
3. System prompt assembly and context restoration (session path / conversation resume)
4. Tool configuration (`setDelegateConfig`, `moduleLoader`, `setConfigProvider`, state machine setup)

The existing `loop-init.ts` and `loop-send.ts` pattern already shows how to extract phases behind a state interface. The constructor body follows the same pattern.

## Desired Outcome

`loop.ts` is ≤300 lines. The extracted logic lives in `src/loop-constructor.ts` (or a similarly named sibling) behind a clean function boundary. `AgentSession` and `runAgentLoop` remain exported from `loop.ts`.

## Constraints

- No behavior or public API changes.
- Use the existing `AgentLoopState` cast pattern from `loop-init.ts` and `loop-send.ts` if needed.
- Do not create a file that merely re-delegates everything with no real boundary.
- All tests must pass; `typecheck`, `lint`, and `build` must be clean.

## Done When

- `loop.ts` is ≤300 lines.
- `loop-constructor.ts` (or equivalent) exists and is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
