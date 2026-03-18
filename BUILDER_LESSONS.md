# Builder Lessons

Recurring patterns from recent sessions. Read during orientation.

## DESIGN.md

- Orient: `grep '^##' DESIGN.md` for headers. Do NOT read the full file.
- Read only sections you need during implementation, with offset/limit.
- When updating: condense sections you're modifying. Target: ≤1100 lines.

## Parse-Log Metrics

- **"Top neglected" (NEVER)** means "never modified by the builder loop," NOT
  "untested." Files like `computer-use.ts` (43 tests) and `custom-tool.ts`
  (35 tests) have comprehensive pre-builder test suites. Check actual test
  coverage before investigating.

## Common Gotchas

- **Module count tests**: Adding/removing modules → update TWO assertions in
  `module-cli.integration.test.ts` (search `toBe(` near "builtin modules").
- **System prompt tests**: `system-prompt.test.ts` asserts a ~12000 char budget
  with ≤200 chars headroom. Adding a tool = prompt change. Run system-prompt
  tests FIRST, then write aggressively concise text.
- **Flaky tests**: `process.test.ts` (truncation timing) and
  `sqlite-memory.test.ts` (load-dependent). Both pass in isolation. Don't
  investigate if they fail alone on retry.

## Lint

Batch at operation boundaries: `npx biome check --write <files>` after each
group of related edits, then `npx biome check <all-changed>` once at the end.

## New Core Tool Registration

Tools self-register via `registration` export (risk, group, tool, runner).

**Checklist** (8 files):
1. `src/tools/<tool>.ts` — implement + export `registration`
2. `src/tools/index.ts` — import registration, add to array
3. `src/tool-groups.ts` — add to appropriate group
4. `src/tools/index.test.ts` — update count AND name assertions
5. `src/tools/<tool>.test.ts` + `DESIGN.md`
6. `src/system-prompt.ts` + `src/system-prompt.test.ts` — verify char budget
7. `src/delegate-prompts.ts` — if sub-agents should have access
8. `src/tools/tool-groups.test.ts` — if adding to a group, update group test

Read ONE recent tool file as template. Read all checklist files before editing.

## Circular Imports

When refactoring shared modules, check for circular import chains BEFORE
starting: `grep -r "from.*/<module>" src/ --include="*.ts" -l`. Use lazy
initialization (getter functions) to break cycles. Also grep for
`vi.mock(.*<module>)` — test mocks must include any new exports.

## Cross-Cutting Changes

Before modifying shared types/interfaces:
1. `grep -r "TypeName" src/ --include="*.ts" -l` — find ALL consumers
2. Note test files with manual stubs (they WILL break)
3. Edit consumers FIRST, shared type LAST
4. `npm run typecheck` immediately after

## Vitest Mock Isolation

`vi.doMock` leaks across test files sharing a vitest worker pool. When mocking
dynamic imports (e.g., Agent SDK), prefer `vi.mock` with factory + per-test
setup via `vi.mocked()`. If two test files mock the same module, add
`vi.restoreAllMocks()` in `afterEach` and verify they pass when run together.

## Depth Work Logging

When doing depth/hardening work, append a row to `depth-log.md`:
```
| <iter> | <approach> | <module(s)> | <severity> | <one-line summary> |
```
