---
id: task-extension-dynamic-state-hooks
title: Allow extensions to register dynamic system-prompt state injectors
status: done
priority: p2
area: architecture
summary: loop-send.ts hard-codes getWorkingMemoryState() alongside core loop state. Extensions should be able to register state injectors so the core loop iterates them rather than importing specific store modules directly.
created_at: 2026-04-08T15:55:00Z
updated_at: 2026-04-08T15:55:00Z
---

## Problem

`loop-send.ts` assembles the per-turn dynamic system prompt by directly importing
`getWorkingMemoryState` from `src/memory/working-memory.ts`:

```ts
const dynamicState =
  state.context.getDynamicState() +
  state.verifyTracker.getState() +
  changesSummary +
  getWorkingMemoryState() +   // ← hard-coded store import
  telemetryBlock;
```

This creates a tight coupling between the core turn loop and a specific store module
that belongs to the working-memory extension. As the extension system grows, additional
extensions may want to inject state into the system prompt (active timers, quota
warnings, environment context, etc.), but there is no registration point — each new
injector would require modifying `loop-send.ts`.

The pattern mirrors the problem that was already solved for tools, skills, and workflows:
capability should be contributed via a registration point, not by editing core.

## Desired Outcome

Extensions can register a synchronous or async `getDynamicState(): string` hook via
`ExtensionContext` (or an equivalent registration point). During each turn, `loop-send.ts`
collects all registered state strings and appends them to the dynamic system prompt
block — without importing any specific extension module.

The working-memory extension registers its `getWorkingMemoryState()` output through
this hook, removing the direct import from `loop-send.ts`. The rendered output is
unchanged; only the wiring changes.

## Constraints

- The hook interface must be synchronous or return a resolved string efficiently — it
  runs on every agent turn.
- Extensions that do not register a state hook are unaffected.
- The change must not break the existing working-memory system-prompt injection; the
  `<working-memory>` block must appear as before.
- Do not add a generic plugin/middleware bus. This is a narrow, specific hook for
  per-turn system-prompt contributions.
- `loop-send.ts` should stop importing from `src/memory/working-memory.ts` after this
  change; that import should move to the working-memory extension.

## Done When

- `ExtensionContext` (or the extension registration surface) exposes a method to
  register a per-turn state string provider.
- The working-memory extension registers its state using this method instead of being
  called directly from loop-send.ts.
- `loop-send.ts` no longer imports from `src/memory/working-memory.ts`.
- Existing unit tests for working-memory tool operations and prompt injection continue
  to pass.
- The ARCHITECTURE.md "Current Gaps" section is updated to remove the working-memory
  thin-wrapper note.
