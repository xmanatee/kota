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

## Context Efficiency

Every source file you read adds to your context window and degrades downstream
reasoning quality. Research (Chroma "Context Rot" 2025) shows performance drops
well before context limits — at ~25% of nominal capacity.

**Rule**: Don't read source files during orientation. Decide what to build
based on lightweight signals (DESIGN.md, CHANGELOG, NOTES.md, git log). Then
read only the files relevant to your chosen work.

**Why this matters**: In iter 537, 18 source files were read during orientation
before the work topic was chosen. Most were irrelevant to the final
implementation (module_factory). This drove context to 97k tokens/turn (+18%
growth trend), increasing cost to $7.42 (vs $5.35 avg) and potentially
degrading implementation quality.

## Research Strategy

Web research is valuable but expensive — in iter 539, 24 web calls (19% of all
calls) were spent trying to read library documentation, with 7 HTTP errors
(429 rate limits, 404/403 forbidden). The builder got stuck in a Fetch→Fail
loop instead of switching strategies.

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

Lint reruns average 6.8× per iteration — the worst rerun ratio across all
check types. The anti-pattern is a "discovery-and-rework cycle":

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

## Composition Gap

The agent has 24+ individually tested capabilities (file I/O, shell, search,
memory, modules, task routing, conversation recall, etc.). All pass unit tests.
But the most important user-facing workflows are **untested end-to-end**:

- Multi-turn conversation with context management
- Error recovery mid-task (tool fails → agent adapts → completes task)
- Handling ambiguous or underspecified user requests
- Cross-session continuity via memory/recall

**Why this matters**: SWE-EVO (arXiv 2512.18470) shows that single-task
evaluation dramatically overstates capability for sustained, compositional work
— GPT-5 scores 65% on SWE-bench but only 21% on multi-release evolution tasks.
Similarly, FeatureBench shows Claude 4.5 Opus drops from 74% to 11% when
evaluated on full feature development vs individual patches.

The mock-client E2E infrastructure (iter 533, `src/mock-client.ts` and
`src/e2e.test.ts`) already exists for testing multi-step workflows without API
calls. Extending it with scenarios that exercise capability composition
(e.g., "user asks to refactor a module" → agent uses search + read + edit +
test in sequence) would close this gap.

**Bottom line**: Another new capability is less valuable than proving the
existing capabilities compose into working workflows.

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
