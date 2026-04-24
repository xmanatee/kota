---
id: task-eliminate-remaining-core-to-history-module-imports
title: Eliminate remaining core-to-history-module imports via a neutral HistoryProvider protocol
status: done
priority: p2
area: architecture
summary: Stop core from importing #modules/history/*: hoist HistoryProvider's type dependencies into core, have the history module register its own provider on load (mirroring memory/knowledge), migrate call sites to getHistoryProvider(), and add an import-guard test — the natural follow-up to the recent voice and execution carve-outs.
created_at: 2026-04-24T09:14:37.367Z
updated_at: 2026-04-24T09:45:55.953Z
---

## Problem

`src/core/` still imports directly from `#modules/history/*` in multiple
places, which keeps the history module coupled to core the wrong way around.
After the recent voice carve-out (`aa59e6f8`), the neutral `CodeRunner` landing
(`b91e15d4`), and the store relocations of `memory`/`knowledge`/
`working-memory`, history is now the last store whose module is reached into
from core.

Concretely:

- `src/core/modules/provider-registry.ts` imports `getHistory` from
  `#modules/history/history.js` and registers it as the `"history"` provider
  inside core's `registerDefaultProviders()`. `memory` and `knowledge` have
  already inverted this — their modules self-register via
  `ctx.registerProvider` in `onLoad`.
- `src/core/modules/provider-types.ts` declares `HistoryProvider` but imports
  its payload types (`ConversationData`, `ConversationRecord`) from
  `#modules/history/history.js`, so the protocol contract lives half in core
  and half in the module.
- `src/core/daemon/daemon-handle.ts` and `src/core/daemon/daemon.ts` call
  `getHistory()` directly instead of going through `getHistoryProvider()`.
- `src/core/loop/loop-init.ts`, `loop-constructor.ts`, and `request-analyzer.ts`
  import `getHistory` (and `ConversationRecord`) from `#modules/history/*`.
- `src/core/server/daemon-client.ts` and `src/core/daemon/daemon-control-types.ts`
  import `ConversationData`/`ConversationRecord` from `#modules/history/*` for
  typing.

There is no import-guard test for history (the peers are
`src/core/modules/no-voice-imports-in-core.test.ts` and
`no-execution-module-imports-in-core.test.ts`), so new core→history imports
can regress silently.

## Desired Outcome

Core stops importing from `#modules/history/*`. The `HistoryProvider` protocol
and its payload types live entirely in core; the history module owns the
concrete store and registers it as the `"history"` provider during module
load, matching the `memory` and `knowledge` pattern. An import-guard test
makes future regressions fail loudly.

## Constraints

- Move `ConversationData` and `ConversationRecord` (plus any supporting
  types the protocol needs, e.g. `Message`) into core — either inside
  `src/core/modules/provider-types.ts` or a neutral file under
  `src/core/history/` — and have the history module alias/re-export those
  types from the core location. Do not leave two independent definitions.
- Remove the `registerDefaultProviders` entry that imports and registers
  `getHistory()`. The history module's `onLoad` should call
  `ctx.registerProvider("history", getHistory())`, mirroring
  `src/modules/memory/index.ts` and `src/modules/knowledge/index.ts`.
- Drop the `getHistory` fallback return in `getHistoryProvider()`; the
  provider must be resolved through the registry once the module is
  loaded, consistent with `getMemoryProvider`/`getKnowledgeProvider`
  which throw when unloaded.
- Migrate every core call site of `getHistory()` to `getHistoryProvider()`
  (`core/daemon/*`, `core/loop/*`). Callers inside the history module keep
  using the local `getHistory()` accessor.
- Update type-only imports in core (`core/server/daemon-client.ts`,
  `core/daemon/daemon-control-types.ts`, `core/loop/request-analyzer.ts`)
  to the new core-owned type path.
- Add a co-located import-guard test under `src/core/modules/` (named
  `no-history-imports-in-core.test.ts`) that fails if any file under
  `src/core/` imports from `#modules/history/`, matching the pattern of
  `no-voice-imports-in-core.test.ts` and
  `no-execution-module-imports-in-core.test.ts`.
- Ensure `ensureCliProvidersFor(["history"])` (or the equivalent) loads
  the history module in code paths that relied on
  `registerDefaultProviders` to populate the registry.
- Update `src/modules/history/AGENTS.md` and any nearby core AGENTS.md
  that describes the ownership split so the docs match the new seam.
- No compatibility shim, no re-export barrel, no dual import path. One
  way to resolve the history provider.

## Done When

- `rg "#modules/history/" src/core` returns no hits.
- `src/core/modules/provider-registry.ts` no longer imports or calls
  `getHistory`, and the module registers the provider itself.
- `src/modules/history/index.ts` gains an `onLoad` that registers the
  `history` provider via `ctx.registerProvider`.
- `ConversationData`, `ConversationRecord`, and any other protocol payload
  types used by `HistoryProvider` live in core; the history module imports
  or re-exports them from that core location.
- A new `src/core/modules/no-history-imports-in-core.test.ts` fails the
  build if any `src/core/**` file imports from `#modules/history/`.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass on the final tree.
- `src/modules/history/AGENTS.md` reflects the module-owned provider
  registration; any stale "core registers history" wording elsewhere is
  pruned in the same change.
