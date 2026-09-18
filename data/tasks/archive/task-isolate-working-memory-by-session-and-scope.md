---
status: done
---

# Make working memory genuinely private to its session and scope

## Problem

The September 17 role/skill audit found a concrete contradiction, not a request
for another memory system. `src/modules/working-memory/AGENTS.md`, the skill and
tool describe a session-local scratchpad, but `store.ts` holds one module-global
Map, compaction switch and pending note. `index.ts` ignores tool execution
identity and registers an unconditional dynamic-state provider. Production never
calls `resetWorkingMemory`; tests reset the global store and mask concurrent
session contamination. A session can therefore see, compact, clear or overwrite
another session's notes. This is code evidence, not an observed private-data leak.

Persistence also disagrees with its contract: updating an already-persistent
entry without repeating `persist` preserves the flag in memory but does not save
the new value. The tool advertises only a session write even when changing durable
module storage.

## Desired outcome

- Temporary entries and compaction state belong to exactly one live session in
  one directory scope. No other session or scope receives them through tools or
  prompt injection; session disposal releases them.
- Explicit persistent entries survive restart within their intended scope.
  Preserve existing valid stored entries, reject corrupt data without overwriting
  it, and do not let concurrent session snapshots overwrite unrelated persistent
  entries. Omitted `persist` on an update retains and saves the existing setting;
  setting it false removes the durable copy without losing the local entry.
- Dynamic prompt injection uses the same identity as tool execution and respects
  the effective active-tool policy. An unavailable identity must never fall back
  to a shared scratchpad. Effects distinguish session operations from persistent
  mutations so normal authorization remains truthful.

Use the existing session lifecycle/resource owner in
`src/core/tools/session-environment.ts`, module lifecycle and scope selection.
`src/core/loop/dynamic-state.ts` and `loop-send.ts` own propagation of prompt
context; do not add a second session registry, memory backend or persistence
protocol. Keep the scratchpad implementation instance-owned and retire the global
reset path. Inspect adjacent memory/knowledge tool resolution for scope fallbacks
while tracing callers; preserve configured provider behavior rather than silently
selecting a different backend.

## Verification

Adapt the existing store/module tests and
`src/session-working-memory.integration.test.ts`: two live sessions may use the
same key independently, another scope sees neither, one session's clear/compaction
and teardown leave the other intact, unavailable tools inject nothing, and
explicit persistent updates survive reload without dropping other entries.
Exercise normal tool and prompt boundaries, not private Map shape or call order.
Keep verification bounded; a quota-consuming live daemon run is not a completion
prerequisite. No new template report or duplicated test portfolio is needed.

## Completion

Scratchpads now belong to the existing live session/scope resource owner. Tool
access and dynamic prompt assembly use the same identity, and unavailable tools
inject no memory. Persistent mutations merge affected keys into current scoped
storage; omitted persistence retains the setting, teardown keeps durable entries,
and validated old arrays are converted once without discarding data. The global
store/reset path is removed and mutation effects declare durable writes.

Existing store, module, session-resource and session-loop integration checks cover
interleaving, teardown, prompt exclusion, persistence and corrupt-data preservation.
Production and test typechecks pass. Provider-dependent live behavior remains an
operational observation after deployment, not an unperformed check claimed here.
