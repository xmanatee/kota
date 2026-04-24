---
id: task-drop-sdk-naming-from-core-delegate-harness-backend
title: Drop SDK naming from core delegate harness backend
status: ready
priority: p2
area: architecture
summary: Rename src/core/tools/delegate-agent-sdk.ts and its exports so the last SDK-labeled surface in core reads as harness-neutral, finishing the recent core agent-harness rename sweep.
created_at: 2026-04-24T03:08:33.497Z
updated_at: 2026-04-24T03:08:33.497Z
---

## Problem

The recent rename sweep moved every `SDK*` wire-type name inside
`src/core/agent-harness/` to neutral `Agent*` names, finishing the
visible claude-SDK extraction from core's harness boundary
(`task-rename-core-agent-harness-wire-types-from-sdk-to-n`). One SDK-
labeled surface inside core still survives: the delegate backend at
`src/core/tools/delegate-agent-sdk.ts`. The file's content is already
harness-neutral — it resolves a registered `AgentHarness` by name from
`config.defaultAgentHarness`, fails loudly when the harness is unset,
and refuses to silently re-pin subagents to claude — but its naming
still contradicts that behavior:

- filename `delegate-agent-sdk.ts`
- exported function `runDelegateAgentSDK`
- exported type `AgentSDKDelegateConfig`
- module-local constants `EXPLORE_SDK_TOOLS` / `EXECUTE_SDK_TOOLS`
- the caller in `src/core/tools/delegate.ts` imports `runDelegateAgentSDK`
- the co-located test file `delegate-agent-sdk.test.ts`

Reading core today, "agent-sdk" still looks like a concrete
claude-agent-sdk coupling even though the code is plumbed through the
neutral harness registry. This is the last `SDK` leak inside `src/core/`
(`src/core/agent-harness/types.ts` and `guards.ts` only mention `SDK` in
comments describing the upstream claude-agent-sdk package, which is
accurate for the adapter itself). Cleaning this up closes the sweep and
removes the last visible ambiguity about whether core speaks a specific
SDK natively.

## Desired Outcome

Core's delegate backend reads as harness-neutral end to end. The file,
its exported symbols, and the tool-allowlist constants are renamed to
names that describe what they are ("delegate via the resolved agent
harness") rather than where the code originated. Every caller inside
core and every test switches to the neutral names in the same change.
The claude-agent-sdk adapter keeps its own `SDK*` internals because
those are genuine `@anthropic-ai/claude-agent-sdk` shapes.

## Constraints

- This is a rename/restructure at a core boundary, not a behavior
  change. No runtime-visible contract shifts — the delegate tool still
  takes the same arguments, still resolves the harness from
  `config.defaultAgentHarness`, and still fails loudly when unset.
- Per the repo's no-legacy rule, do not keep `runDelegateAgentSDK` /
  `AgentSDKDelegateConfig` / `EXPLORE_SDK_TOOLS` / `EXECUTE_SDK_TOOLS`
  aliases as compatibility shims. Delete the old names; update every
  consumer in the same commit.
- The test file `delegate-agent-sdk.test.ts` should be renamed to match
  the new filename (`git mv`), not forked.
- Do not let the `SDK` prefix reappear on any new symbol introduced by
  this rename. The target naming should hold up next time someone reads
  `src/core/tools/` top-down.
- Leave `src/core/agent-harness/types.ts` and `guards.ts` comments that
  reference the upstream claude-agent-sdk package alone — those are
  correct context for the adapter, not leaks in core.

## Done When

- `src/core/tools/delegate-agent-sdk.ts` is renamed to a harness-neutral
  filename (e.g. `delegate-harness.ts`) with matching neutral export
  names for the function, config type, and tool-allowlist constants.
- `src/core/tools/delegate.ts`, any other core consumer, and the renamed
  test file import the new names. No `git grep` inside `src/core/` finds
  `runDelegateAgentSDK`, `AgentSDKDelegateConfig`, `EXPLORE_SDK_TOOLS`,
  or `EXECUTE_SDK_TOOLS`.
- `pnpm kota task validate` and the repo's typecheck/test commands pass.
- A follow-up `git grep -n "SDK" src/core/` shows only legitimate
  references to the upstream claude-agent-sdk package in adapter-facing
  comments, not symbols or filenames.
