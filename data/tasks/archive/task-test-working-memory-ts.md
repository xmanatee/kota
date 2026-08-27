---
status: done
---

# Add direct unit tests for working-memory.ts

## Problem

`src/memory/working-memory.ts` had no direct unit tests despite being a
non-trivial module with capacity limits, persistent flags, and a rendering
function.

## Desired Outcome

Full test coverage of all exported functions with edge cases for each limit.

## Constraints

- No filesystem or async I/O (module is pure in-memory).
- Use `resetWorkingMemory()` for isolation between tests.

## Done When

- All surfaces covered: `setEntry`, `loadEntries`, `getPersistentEntries`,
  `getEntry`, `removeEntry`, `listEntries`, `clearAll`, `getWorkingMemoryState`.
- All 28 tests pass; full suite passes; typecheck and lint clean.
