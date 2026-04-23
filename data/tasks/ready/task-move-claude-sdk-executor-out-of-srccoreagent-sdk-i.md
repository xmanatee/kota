---
id: task-move-claude-sdk-executor-out-of-srccoreagent-sdk-i
title: Move Claude-SDK executor out of src/core/agent-sdk/ into the claude-agent-harness module
status: ready
priority: p2
area: architecture
summary: executor.ts + kota-tools-mcp.ts are only called by the claude-agent-harness adapter yet live in src/core/agent-sdk/. Move them into the claude-agent-harness module so the core kernel no longer hosts Claude-SDK-specific runtime while keeping the harness-neutral SDKMessage/SDKPermissionMode types in core where workflow runtime still references them.
created_at: 2026-04-23T21:39:14.037Z
updated_at: 2026-04-23T21:39:14.037Z
---

## Problem

`src/core/agent-sdk/` hosts the Claude Agent SDK executor (`executeWithAgentSDK`
in `executor.ts`) and the KOTA owner-questions MCP bridge (`kota-tools-mcp.ts`).
Both are Claude-SDK-specific: the executor imports
`@anthropic-ai/claude-agent-sdk` and translates KOTA options into that SDK's
wire protocol, and the MCP bridge builds `mcpServers` entries the claude
harness adapter merges into the SDK call.

The only non-test caller in the whole repo is
`src/modules/claude-agent-harness/adapter.ts`. `src/core/agent-sdk/AGENTS.md`
already records the contract in prose: "This directory hosts the packaged
Claude Agent SDK executor and MCP bridge. It is the internal implementation
of the `claude-agent-harness` module — nothing else in core should import
`executeWithAgentSDK` directly." So the contract says this code belongs to
the module; the layout says it belongs to core. The kernel-stays-small
direction in `src/AGENTS.md` is explicit that swappable features live in
`src/modules/`, and having Claude-SDK runtime in `src/core/` is the visible
counterexample.

The `SDKMessage`, `SDKPermissionMode`, `SDKSettingSource`, and
`SDKSystemPrompt` type re-exports in `types.ts` are a separate case: they are
referenced by ~12 core workflow/loop/run-store files as the neutral message
shape. The types originated with the Claude Agent SDK but are already shared
across harnesses (the `thin` and `openai-tools` adapters normalize into the
same `SDKMessage` shape). Moving the types is a deeper refactor with its own
case and should not be bundled with the runtime move.

## Desired Outcome

- `src/modules/claude-agent-harness/` owns the Claude SDK executor and the
  owner-questions MCP bridge. The adapter imports them as local siblings, not
  through `#core/agent-sdk/...`.
- `src/core/agent-sdk/` either (a) no longer exists and its type surface
  reshapes into a neutrally-named home in core (`src/core/agent-harness/` is
  the natural fit alongside `types.ts` there), or (b) keeps only the
  harness-neutral types with a renamed directory that no longer implies it
  hosts Claude-SDK runtime. Pick one and record the decision in the run
  directory.
- Core workflow/loop files that import `SDKMessage` / `SDKPermissionMode` /
  `SDKSettingSource` continue to work without a parallel alias. Import paths
  update in one pass; no compatibility re-exports linger.
- Core tests that previously mocked `#core/agent-sdk/index.js` mock the new
  module-local path instead. No test keeps both mock locations; none stays
  on the stale path via a re-export shim.
- `src/core/AGENTS.md`, `src/core/agent-sdk/AGENTS.md` (removed or absorbed),
  `src/core/agent-harness/AGENTS.md`, and
  `src/modules/claude-agent-harness/AGENTS.md` reflect the new layout; no
  doc still points readers at `src/core/agent-sdk/` as the executor's home.

## Constraints

- Do not keep a re-export bridge at `#core/agent-sdk/index.js` for "backwards
  compatibility" — every import updates in the same change. Legacy shims are
  forbidden by repo policy.
- Do not move `SDKMessage` and friends into the claude module. They are the
  neutral wire-message shape for the workflow runtime; only the executor and
  MCP bridge move. If the rename of `src/core/agent-sdk/` is chosen over
  full deletion, the remaining directory contains only type declarations and
  re-exports with a neutral name that does not imply Claude-SDK runtime lives
  there.
- `createOwnerQuestionMcpServers` stays callable from
  `src/modules/claude-agent-harness/adapter.ts` only. Other adapters must not
  take on a Claude-SDK-shaped `mcpServers` dependency during this move.
- Tests that exercise neutral harness behavior (e.g.
  `src/core/agent-harness/hooks-cross-harness.test.ts`) must continue to
  mock via the module-local path rather than a core-shaped one, so the
  neutral seams stay visible in test code.
- The move is a refactor: external behavior (CLI, daemon, workflow runs)
  must not change, and `pnpm typecheck` + the existing test suites must stay
  green.

## Done When

- `src/core/agent-sdk/executor.ts` and `src/core/agent-sdk/kota-tools-mcp.ts`
  are gone; their code lives inside `src/modules/claude-agent-harness/` under
  sibling filenames that mirror their current names.
- No production or test source imports `#core/agent-sdk/index.js` or
  `#core/agent-sdk/executor.js` or `#core/agent-sdk/kota-tools-mcp.js`. A
  grep for those literals returns zero non-historical matches.
- `SDKMessage`, `SDKPermissionMode`, `SDKSettingSource`, and `SDKSystemPrompt`
  continue to be imported by core workflow/loop/run-store files at their new
  stable location, with one canonical path.
- The relevant `AGENTS.md` files describe the new layout, and the old
  contract sentence "nothing else in core should import `executeWithAgentSDK`
  directly" is either redundant (no such directory exists) or rephrased for
  the neutral-types-only home.
- `pnpm typecheck` and the full vitest suite pass on `main` after the change.
