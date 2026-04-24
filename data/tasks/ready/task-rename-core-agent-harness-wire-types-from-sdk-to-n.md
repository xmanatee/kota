---
id: task-rename-core-agent-harness-wire-types-from-sdk-to-n
title: Rename core agent-harness wire types from SDK* to neutral Agent* names
status: ready
priority: p2
area: architecture
summary: Drop the lingering SDK* prefix from core agent-harness wire-frame types so core stops referring to Claude-SDK names for shapes it treats as neutral, finishing the recent claude-SDK extraction sweep.
created_at: 2026-04-24T02:36:11.988Z
updated_at: 2026-04-24T02:36:11.988Z
---

## Problem

`src/core/agent-harness/sdk-types.ts` still declares `SDKMessage`,
`SDKPermissionMode`, `SDKSettingSource`, `SDKContentBlock`,
`SDKMessageWithSession`, `SDKAssistantMessage`, `SDKResultMessage`, and
`SDKStatusMessage`. The directory's own `AGENTS.md` and `types.ts` already
explain that these shapes are *neutral wire frames every harness adapter
normalizes into* — `types.ts` re-exports them as `AgentMessage`,
`AgentPermissionMode`, `AgentSettingSource`, etc., with comments saying so.

In practice, core consumers ignore the neutral aliases and import the
Claude-SDK-prefixed names directly:

- `src/core/workflow/repair-loop.ts`
- `src/core/workflow/active-run-handle.ts`
- `src/core/workflow/steps/step-executor.ts`
- `src/core/workflow/steps/step-executor-agent.ts`
- `src/core/workflow/steps/step-executor-foreach.ts`
- `src/core/workflow/steps/step-executor-parallel.ts`
- `src/modules/workflow-ops/runs/workflow-logs.ts`

The `SDK*` naming inside core contradicts the recent extraction sweep
(claude-SDK executor moved out, claude-SDK query/option types moved out,
claude-SDK step-options moved behind a per-harness validator). It is the
last visible Claude-SDK leak inside core's agent-harness boundary and
keeps the codebase reading as if core still speaks Claude SDK natively.

## Desired Outcome

Core's agent-harness wire-frame types are named after what they are
(neutral agent wire frames), not after their historical origin. The
`SDK*` prefix disappears from `src/core/`, every core consumer imports
the neutral name, and the `sdk-types.ts` filename itself is replaced by
something that matches the new contract (e.g. `wire-types.ts` or merging
the declarations directly into `types.ts`). The claude-agent-harness
module's own `sdk-types.ts` keeps using `SDK*` names because those are
genuine `@anthropic-ai/claude-agent-sdk` shapes.

## Constraints

- This is a renaming sweep at the core boundary, not a behavior change.
  Wire-frame field names stay untouched — only the TypeScript type names
  and import paths move.
- Per the repo's no-legacy rule, do not keep `SDK*` aliases as
  compatibility shims. Delete the old names; update every consumer.
- The claude-agent-harness adapter must keep importing `SDKMessage` /
  `SDKPermissionMode` / `SDKSettingSource` shapes — they are the wire
  shapes the SDK actually produces. Update its imports to the new
  neutral names from core, and let the adapter alias them locally if a
  short Claude-flavored name reads better inside the adapter.
- Update `src/core/agent-harness/AGENTS.md` so the "SDK wire-type
  declarations" section no longer talks about names with an `SDK`
  prefix.
- Do not move the wire-frame declarations out of `src/core/`. Workflow
  runtime, run stores, and step executors consume them directly; they
  belong in core. The point of this task is to fix the names, not the
  ownership.

## Done When

- `rg "SDKMessage|SDKPermissionMode|SDKSettingSource|SDKContentBlock|SDKMessageWithSession|SDKAssistantMessage|SDKResultMessage|SDKStatusMessage" src/core` returns no hits.
- `src/core/agent-harness/sdk-types.ts` is gone (or renamed) and every
  core consumer imports the neutral name from its new location.
- `src/modules/claude-agent-harness/` still builds and tests pass; its
  own SDK-prefixed query/option/system-prompt types remain because they
  describe the actual Claude SDK API.
- `src/core/agent-harness/AGENTS.md` is updated to match the renamed
  surface and no longer lists `SDKMessage`/`SDKPermissionMode`/
  `SDKSettingSource` as core type names.
- `pnpm typecheck` and `pnpm test` both pass.
