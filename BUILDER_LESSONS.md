# Builder Lessons

Recurring patterns from recent sessions. Read during orientation.

## Pre-Flight

- **Run tests first** (`npm test 2>&1 | tail -20`). Inherited failures are
  common. Fix before building.

## Common Gotchas

- **Module count tests**: Adding/removing modules → update TWO assertions in
  `module-cli.integration.test.ts` (search `toBe(` near "builtin modules").
- **System prompt tests**: `system-prompt.test.ts` asserts headings, content,
  and a ~12000 char budget. Update after any prompt changes.

## Lint

Batch at operation boundaries: `npx biome check --write <files>` after each
group of related edits, then `npx biome check <all-changed>` once at the end.
Don't run intermediate verification checks between auto-fix passes.

## New Core Tool Registration

Tools self-register via `registration` export (risk, group, tool, runner).
Guardrails and module-factory auto-derive from the registry.

**Checklist** (5 files):
1. `src/tools/<tool>.ts` — implement + export `registration`
2. `src/tools/index.ts` — import registration, add to array
3. `src/tool-groups.ts` — add to appropriate group
4. `src/tools/index.test.ts` — update count AND name assertions
5. `src/tools/<tool>.test.ts` + `DESIGN.md`

Read ONE recent tool file as template. Read all checklist files before editing.

## Circular Imports in Cross-Cutting Refactors

When refactoring shared modules (e.g., `tools/index.ts`, `guardrails.ts`),
check for circular import chains BEFORE starting. Run:
```
grep -r "from.*/<module>" src/ --include="*.ts" -l
```
Then trace: does any importer also get imported by the module you're changing?
If so, use **lazy initialization** (getter functions, not module-level
`const`) to break the cycle. In iter 561, eager module-level initialization
in a circular chain (`delegate → context → tools/index → delegate`) caused
30+ calls of rework.

Also: test mocks of the changed module must include any new exports. Grep
for `vi.mock(.*<module>)` to find all mock sites before adding exports.

## Batch Edits

Plan ALL changes to a file before starting. Batch into fewer Edit calls.
Re-editing costs context and risks conflicts. If `index.test.ts` needs both
a count and name-list update, do them in one Edit.

## Cross-Cutting Changes

The #1 rework source. Before modifying shared types/interfaces:
1. `grep -r "TypeName" src/ --include="*.ts" -l` — find ALL consumers
2. Note test files with manual stubs (they WILL break)
3. Edit consumers FIRST, shared type LAST
4. `npm run typecheck` immediately after

## Architecture as Capability

26+ tools, 3000+ tests. Each new tool adds less than the last. Architecture
work IS capability work when it enables something new:
- Module isolation → runtime extensibility (user asks agent to create a tool)
- Untested integration paths → reliability (50-turn conversation without degradation)
- Tight coupling → independent evolution (swap memory backend, touch zero other files)

**The test**: describe a before/after where user experience improves.
