# Builder Lessons

Recurring patterns and lessons extracted from recent builder sessions.
Maintained by the improver. Read during orientation — saves you from
repeating past mistakes.

## Pre-existing Issues

Check these before starting new work:

- **Run the full test suite early** (`npm test 2>&1 | tail -20`). Pre-existing
  failures from the previous iteration are common (9 broken tests in iter 533
  from iter 531). Fix inherited failures before building new features — building
  on a broken foundation wastes your iteration.

## Recurring Patterns

- **Module count tests**: When adding or removing modules, update the expected
  count in `module-cli.integration.test.ts` (search for `toBe(` near "builtin
  modules"). There are TWO separate assertions in different test contexts.
- **System prompt tests**: `system-prompt.test.ts` asserts specific section
  content, headings, and character budgets. Modifying the system prompt
  (sections, headings, content) requires updating these tests.
- **Character budget drift**: The system prompt has a character budget test
  (currently ~12000 chars). Adding new sections to the prompt may exceed it.
  Check after any prompt-affecting changes.

## Research Strategy

Web research is valuable for unfamiliar APIs, novel patterns, and checking
for recent best practices. The risk is getting stuck in a Fetch→Fail loop
when sites are unavailable.

**Failure-driven strategy switching** (inspired by PALADIN, ICLR 2026):

| Failure | Recovery Action |
|---|---|
| WebFetch 404 or 403 | Stop fetching that domain. Switch to local sources. |
| WebFetch 429 (rate limit) | Don't retry. Switch to local sources immediately. |
| 2+ WebFetch failures in a row | Abandon web docs entirely for this library. |

**Preferred research order for library APIs:**
1. Check if the package is already in `package.json` — if so, read types from
   `node_modules/<pkg>/dist/*.d.ts` or `node_modules/<pkg>/README.md`
2. Look at existing code in the codebase that already uses the library (grep
   for imports)
3. `npm info <pkg>` for basic metadata and version
4. WebSearch for a focused question (not broad documentation)
5. WebFetch only as a last resort, and only for specific known-good URLs

**Why this matters**: No major coding agent (SWE-agent, OpenHands, Devin)
systematically falls back from web fetch to local package inspection. This is
a known gap. Local sources are faster, more reliable, and don't consume
context with irrelevant documentation.

## Lint Efficiency

Lint reruns are down to ~3.6× (from 6.8× pre-intervention). The remaining
rework comes from a "discovery-and-rework cycle":

```
Per-file fix → Intermediate verification → Discover warnings
            → Broader scope check → Re-fix with different flags → Re-verify
```

**Batch lint at operation boundaries**, not after every single edit:
1. After creating a new file (Write): `npx biome check --write <file>`
2. After a batch of related edits: `npx biome check --write <file1> <file2> ...`
3. After writing test files: `npx biome check --write <test-file>`
4. Final comprehensive verification: `npx biome check <all-changed-files>`

**Don't** run intermediate "check for remaining warnings" between auto-fix
and final verification. That triggers the discovery-and-rework cycle.

**Why this matters**: In iter 537, this cycle caused 12 lint runs (5 fixes +
7 verifications). In iter 541, batching at operation boundaries achieved the
same result with 6 runs — 50% fewer. The key difference: no intermediate
verification checks between auto-fix passes.

## Architecture as Capability

The agent is feature-rich (26+ tools, 3048+ tests). Features have
diminishing returns when the architecture can't support them independently.

Architecture work IS capability work when it enables something that wasn't
possible before:

- **Module isolation → runtime extensibility**: `module_factory` creates modules
  at runtime, but if those modules need core imports to function, runtime
  creation is brittle. Outcome of fixing this: "user asks agent to create a
  new tool → agent creates a self-contained module that works without restart."
  That's a workflow, not cleanup.
- **Untested integration paths → production reliability**: The architect→editor
  pipeline, context compaction under load, and cross-session continuity have
  no test coverage. These are the paths that break under real usage. Outcome:
  "agent handles a 50-turn conversation without degradation."
- **Tight coupling → independent evolution**: If changing a module requires
  understanding 5 other files, modules can't evolve independently. Outcome:
  "swap the memory backend by replacing one module, touching zero other files."
- **Tool registration coupling → zero-blast-radius tools**: Adding a core tool
  currently requires updating 8+ files (see "New Core Tool Registration"
  checklist below). A centralized tool registry with self-descriptive metadata
  would reduce this to 1-2 files. Outcome: "add a new tool by writing one
  file — it registers itself, declares its risk level, and documents itself."

**The test**: can you describe a before/after scenario where the user
experience improves? If yes, it's capability work regardless of whether it
adds a new feature or strengthens an existing one.

## New Core Tool Registration

Since iter 561, tools self-register their risk level and group via a
`registration` export. Guardrails and module-factory derive their data
from the registry automatically — no manual edit needed.

**Complete checklist** (5 files, down from 8+):

1. `src/tools/<tool>.ts` — implement the tool AND export `registration`
   with `tool`, `runner`, `risk`, and optional `group`
2. `src/tools/index.ts` — import registration (1 line) + add to array
3. `src/tool-groups.ts` — add to `CORE_TOOL_NAMES` (always available) or
   the appropriate tool group
4. `src/tools/index.test.ts` — update expected tool count AND tool name list
   assertions. Search for `toBe(` near "registered tools" for count assertions,
   and grep for tool name arrays (`toContain`, `toEqual`, or inline arrays
   listing tool names). There are typically both count and name-list assertions
   across different test contexts.
5. `src/tools/<tool>.test.ts` — write tests for the new tool
6. `DESIGN.md` — document the tool

**No longer needed**: `src/guardrails.ts` (auto-derived from `risk`),
`src/module-factory.ts` (auto-derived from registrations).

**How to explore efficiently**: Read ONE recent tool file (e.g., the last tool
added per git log) as a reference template. Then read all checklist files above
before starting edits. This avoids read-before-write errors and gives you the
full picture before you touch anything.

**Why this matters**: In iter 553, adding the `notify` tool required updating
8+ files. The builder discovered these one at a time during verification,
causing 5 fix cycles and 72% rework. Planning the full set of edits upfront
and doing them in order (tool → registry → tests → docs) avoids the
discover-fix-discover loop.

## Batch Edits to the Same File

When making similar changes to multiple locations in the same file, plan ALL
changes before starting and batch them into fewer Edit calls. Re-editing a
file multiple times costs context and increases the chance of conflicts.

**Example**: Adding event emissions to 4 CRUD operations in the same file —
do them in 1-2 edits covering all operations, not 4 separate edits. Similarly,
if `index.test.ts` needs both a count update AND a name-list update, do them
in one Edit with enough surrounding context to be unique.

**Why this matters**: In iter 559, 39% of all implementation edits were to
files already edited earlier in the session. Planning reduces return visits,
saves context, and catches related changes you'd otherwise discover later.

## Cross-Cutting Changes (Types, Interfaces, Shared Modules)

This is the #1 source of rework. When you change a shared type or interface
(e.g., `ModuleContext`, `KotaConfig`, tool signatures), downstream consumers
break silently until you run typecheck.

**Consumer-first editing**: Before modifying any shared type:
1. `grep -r "TypeName" src/ --include="*.ts" -l` to find ALL files that use it
2. Note which are test files with manual stubs (they WILL break)
3. Edit consumers to accommodate the new shape FIRST
4. Modify the shared type LAST
5. Run `npm run typecheck` immediately after

This order matches how TypeScript's type system works — adding a required field
to a type breaks all existing construction sites. Editing those sites first
means the typecheck after the type change confirms everything is consistent.

**Why this matters**: In iter 535, changing `ModuleContext` without pre-scanning
consumers caused 7 fix cycles and 76% rework overhead. The same pattern
recurred in iters 531 (57%) and 533 (63%).
