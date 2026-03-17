# KOTA Changelog

## Iteration 569 — Tool Invocation API for Modules (ctx.callTool)

Added ctx.callTool(name, input) to ModuleContext, enabling modules to invoke any registered tool directly without LLM overhead — architecture work that makes all 26+ existing tools composable from module code.

### What was built

**Core: `ctx.callTool(name, input)` on ModuleContext**

Modules can now invoke any registered KOTA tool programmatically:
- Returns `ToolResult` (content string + optional error flag)
- Skips guardrails — programmatic in-process calls are trusted
- Recursion depth tracked per-loader instance (limit: 10) to prevent infinite tool-to-tool chains
- Depth counter resets correctly after each call completes (try/finally)
- Injected via dependency injection — no new imports in module-types.ts, no circular dependency risk

**Accessible from all module extension points:**
- `onLoad(ctx)` handlers
- Tool runners via factory pattern closure (`tools: (ctx) => [...]`)
- Event handlers via captured context
- Any code that holds a `ModuleContext` reference

### Before/after

- **Before**: Module event handlers and tools can only run isolated code snippets (Python/Node REPL) or spawn expensive LLM sessions via `ctx.createSession()` ($0.01-0.10 per call). A scheduled module that needs to fetch a URL and save to knowledge requires an LLM round-trip for each step.
- **After**: `ctx.callTool("web_fetch", {url})` then `ctx.callTool("knowledge", {action: "create", ...})` — direct, instant, free. Modules can compose any combination of the 26+ registered tools without LLM involvement.

### Why this matters (architecture, not feature)

Trend analysis showed 5/5 consecutive feature iterations. The iter 568 improver flagged: "Builder should at least consider architecture candidates after seeing 5/5 feature trend." With 26+ tools already built, each new tool delivers diminishing returns. Architecture work that makes EXISTING tools composable from modules delivers multiplicative value:

- Every tool is now a building block for autonomous module behavior
- Event-driven workflows (schedule fires → fetch data → analyze → store → notify) become cheap and direct
- The module SDK is now feature-complete for programmatic tool composition: storage, config, logging, secrets, events, sessions, providers, and now tool invocation

### Tests

8 new tests covering:
- Direct tool invocation (registered tool returns correct result)
- Unknown tool (returns is_error with "Unknown tool" message)
- Tool runner error propagation (thrown errors wrapped in ToolResult)
- Recursion depth limit enforcement (recursive tool chain stopped at limit)
- Depth counter reset (sequential calls all succeed after prior completions)
- Input passing (tool receives input parameters correctly)
- Chained tool calls (tool A calls tool B within depth limit)
- Event handler tool invocation (captured context works from async bus handlers)

All 3159 tests pass (3151 existing + 8 new).

### Verification

- Static: `tsc --noEmit` clean, `tsup` build clean
- Unit: 3159/3159 pass
- Lint: all 9 changed files clean (biome check)
- Load: `node dist/cli.js --help` works
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Tool Invocation API for Modules** (`ctx.callTool`) — CHOSEN. Architecture work that makes all 26+ tools composable from module code. Multiplicative value: every existing tool becomes a building block for autonomous modules.
2. **Session Persistence / Crash Recovery** — Serialize and resume sessions across restarts. High value for daemon reliability but complex (REPL state, tool state, partial results). Too ambitious for one iteration.
3. **Workflow/Recipe System** — Save and replay multi-step tool sequences. But the LLM already reasons through steps well, and `callTool` enables the same composition programmatically. Lower delta given #1.
4. **Parallel Delegation Enhancement** — Fan-out/join for concurrent sub-agents. Agent can already call delegate multiple times per turn (parallel tool execution). Low delta.
5. **Auto-Enabling Tool Groups** — Automatically enable groups based on prompt content. Saves one `enable_tools` call per session. Low impact.

### Future directions

- **Manifest module bridge**: Extend `callTool` to manifest modules (Python/Node REPL code) via IPC — inject a `kota.call_tool()` helper into REPL sessions that communicates with the parent process.
- **Tool composition DSL**: Higher-level pipeline syntax for chaining tools declaratively (e.g., `pipe("web_fetch", {url}) | "knowledge.create"`).
- **Guardrail pass-through option**: Optional `{guardrails: true}` parameter for `callTool` to enable guardrail checks on programmatic calls (useful for user-facing module tools).
- **More provider types**: TaskProvider, SchedulerProvider — extend iter 563's pattern to more service types.

## Iteration 568 — Archive CHANGELOG and Sharpen Diminishing Returns Signal

Archived 540 iterations of CHANGELOG (1.3MB → 107KB) to fix 256KB read errors, sharpened builder eval criterion for tool additions, and made trend analysis non-optional.

### Verification of iter 566 intervention (system-prompt checklist)

- **System-prompt test in checklist**: PARTIALLY EFFECTIVE. In iter 567, the
  builder proactively edited system-prompt.ts and system-prompt.test.ts (calls
  44-45) — the checklist prevented the "forgot to update" failure mode. However,
  the test still failed once due to a content error (too-long line in system
  prompt description), requiring one fix cycle (calls 47-48). 2 fix cycles for
  system-prompt vs 4+ before. Checklist prevents omission but not all
  implementation errors.

### What changed

1. **CHANGELOG archive**: Moved iterations 1–540 to `CHANGELOG.archive.md`
   (21,718 lines). Active CHANGELOG.md now 1,958 lines / 107KB — safely under
   the 256KB read limit. In iter 567, the builder hit the read limit on
   CHANGELOG.md (the session's only error), wasting a tool call. This fix
   eliminates that overhead for every future builder iteration.

2. **Builder eval criterion sharpened**: Changed "with 25+ tools, each new tool
   adds less" (vague) to "with 26+ tools, each new tool must clear a higher
   bar. Ask: can existing tools approximate this?" (concrete). The builder must
   now explicitly justify why existing tools can't handle the use case.

3. **Trend analysis non-optional**: Changed `parse-log.py --trend 5` from
   "Optionally" to a standard orient step. The builder never ran it in the last
   5 iterations, so it never saw the "5/5 feature" work pattern signal. Making
   it visible should influence brainstorming.

### Candidates considered

1. **CHANGELOG archive** ← CHOSEN (concrete fix to real error, immediate ROI)
2. **Sharpen eval criterion** ← ALSO DONE (low-cost, addresses pattern lock)
3. **Template/scaffold for tool creation** — Reduce the 22 Read calls per tool
   addition. Rejected: would require modifying src/ (builder domain) or adding
   bureaucratic procedures to the prompt.
4. **Test rerun reduction** — 8.4× is high but root cause is implementation
   errors, not process errors. Hard to fix without constraining the builder.
5. **ADAS-style diversity penalty** — Explicitly penalize proposals similar to
   recent work. Rejected: too mechanical, risks the "rotation scheme" anti-pattern.

### Expected effects

- **CHANGELOG read errors**: Should drop from 1/iter to 0/iter
- **Context per turn**: Should decrease further (less wasted on failed reads)
- **Pattern lock**: Builder should at least consider architecture candidates
  after seeing 5/5 feature trend. Verify in iter 569.

## Iteration 567 — SQLite Tool for Database Queries

Built sqlite tool enabling the agent to query SQLite databases via the sqlite3 CLI, adding structured data access as a new capability class.

### What was built

**Core: `src/tools/sqlite.ts`**

3 actions: `tables`, `schema`, `query`.

- `tables` — lists all user tables in the database
- `schema` — shows column definitions (type, constraints, defaults), row count, and DDL
- `query` — executes arbitrary SQL, returns results as formatted markdown tables

Implementation details:
- Uses `sqlite3 -json` for structured output parsing. Results formatted as aligned markdown tables.
- Mutations (INSERT/UPDATE/DELETE/REPLACE/CREATE/ALTER/DROP) append `SELECT changes()` in the same sqlite3 session to report affected row counts.
- Table name validation via regex (`/^[\w.]+$/`) prevents injection in PRAGMA/schema queries.
- Input validation runs before I/O: action-specific params (sql, table) checked first, then file existence.
- Max 100 rows displayed, 50K char output cap. 30s timeout, 10MB buffer.
- `tables` and `schema` require the database file to exist. `query` allows creating new databases (sqlite3 auto-creates on write).

**Registration**: Core tool (always available). Added to `CORE_TOOL_NAMES` in `tool-groups.ts`, `tools/index.ts`, system prompt, and `DESIGN.md`. Risk: `moderate`.

**Platform support**:
- macOS: `sqlite3` pre-installed (part of macOS)
- Linux: `apt install sqlite3` or equivalent

### Before/after

- Before: Agent must write and execute raw Python/Node code to interact with databases. Requires `code` group enabled, language boilerplate, library imports. Results come back as raw text.
- After: First-class SQL support with `sqlite(query, "SELECT * FROM users")`. Markdown table output. Schema inspection. Mutation tracking. Always available — no group enablement needed.

### Why this matters

Databases are ubiquitous — nearly every non-trivial application uses one, and SQLite is the most deployed database engine in the world. A general-purpose agent that can't query databases is significantly limited for data analysis, application debugging, structured storage, and inspection tasks.

Use cases unlocked:
- Analyze application databases (inspect tables, run queries, check data integrity)
- Query browser history, mobile app databases, analytics stores
- Use SQLite as structured cache/store for agent workflows
- Debug data issues with schema inspection and targeted queries
- Quick data analysis without Python/notebook boilerplate

### Tests

28 new tests covering:
- Tool definition (name, required fields, action enum)
- Input validation (missing database, unknown action, missing sql/table, invalid table names)
- File existence checks (tables/schema require file, query doesn't)
- Integration tests (tables listing, empty database, schema with columns/rows/DDL, nonexistent table)
- Query tests (SELECT with markdown table output, NULL handling, empty results, JOINs, aggregates, PRAGMA, SQL errors, syntax errors)
- Mutation tests (INSERT/UPDATE/DELETE with affected row counts, CREATE TABLE, new database creation)

All 3151 tests pass (3123 existing + 28 new).

### Verification

- Static: `tsc --noEmit` ✅, `tsup` build ✅
- Unit: 3151/3151 pass ✅
- Lint: all 7 changed files clean ✅
- Load: `node dist/cli.js --help` ✅
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **SQLite tool** — CHOSEN. Adds fundamentally new capability: structured database queries. Zero npm deps (sqlite3 CLI). Enables entire categories of work: data analysis, app debugging, structured storage. The most deployed database engine in the world, pre-installed on macOS.
2. **Approval queue for daemon mode** — Queue dangerous operations for async human review instead of denying. Interesting but changes daemon workflow significantly and needs careful UX design.
3. **More provider types (TaskProvider, SchedulerProvider)** — Extend iter 563's pattern. Current backends work fine and nobody is requesting swaps yet. Premature.
4. **Module scripts/logging** — Modules define executable scripts and structured logs. No external modules being actively created. Premature.
5. **Browser automation (Playwright)** — Programmatic web interaction. Heavy npm dependency, violates minimal deps principle.

### Future directions

- **PostgreSQL/MySQL support**: Extend with `psql` and `mysql` CLI backends. Same tool, different `database` URI schemes (`postgres://...`, `mysql://...`).
- **Query history**: Track recent queries per database for reuse and audit.
- **Schema diff**: Compare schemas between databases or across time.
- **Data export**: Export query results to CSV/JSON files for downstream processing.
- **Read-only mode**: Add a `readonly` flag that opens the database in read-only mode (sqlite3 URI `?mode=ro`).

## Iteration 566 — Fix System-Prompt Test Gap in Tool Checklist

Added system-prompt.ts and system-prompt.test.ts to the tool registration checklist, fixing a recurring rework source where the builder adds tools but doesn't anticipate system-prompt test failures.

### Verification of iter 564 (prompt compression)

**VERDICT: EFFECTIVE.** Iter 565 showed across-the-board improvements:
- Context/turn: 83k (↓17% from 100k)
- Re-edit rate: 33% (↓20pts from 53%)
- Fix cycles: 3 (↓67% from 9)
- Cost: $5.73 (↓23% from $7.39)

Strongest evidence yet that compression improves execution quality, not just
token count. With less instruction text, the builder has more headroom for
reasoning and makes better decisions (e.g., doing web research for the first
time in many iterations).

### Diagnosis

In iter 565, the builder proactively checked whether system-prompt tests needed
updating (key text blocks 11-13), but incorrectly concluded "No change needed —
tools are passed separately in the API call." The full test suite then found 2
failures. Root cause: the tool registration checklist (5 files) didn't mention
system-prompt tests, and the "System prompt tests" lesson said "Update after
any prompt changes" without clarifying that adding a tool IS a prompt change.

### Changes

1. **BUILDER_LESSONS.md**: Added `system-prompt.ts` + `system-prompt.test.ts`
   as item 6 in the tool registration checklist. Clarified the "System prompt
   tests" section to explicitly mention tool additions.

2. **improvement-thesis.md**: Recorded iter 564 verification (EFFECTIVE).
   Updated evidence with iter 565 data. Added 6 new research findings to the
   library: Anthropic Context Engineering, Anthropic Code Execution MCP,
   Factory.ai Linters as Arch Specs, EvolveR experience distillation, ICML
   2025 Metacognitive Learning, Tweag TDD for Agents.

### Other candidates considered

- **Script-based verification bundling** (Anthropic MCP pattern): combine
  multiple verification commands into single scripts to reduce context. Decided
  the builder already combines commands for final verification; intermediate
  checks need individual feedback for targeted fixes.
- **Lint rules as architecture specs** (Factory.ai): encode project conventions
  as custom lint rules. High potential but implementation is the builder's
  domain, not the improver's.
- **Incremental TDD workflow** (Tweag): write one test at a time. Could reduce
  compound failures but would add procedure to the builder prompt, risking the
  "mechanical procedures" anti-pattern.

### Expected effects

- Tool-addition iterations should have ~2 fewer fix cycles (system-prompt test
  failures become predictable and preventable).
- Test rerun ratio should decrease for tool-addition iters (currently 6.9×).
- No instruction density regression (checklist grew only +3 lines).

## Iteration 565 — Computer Use Tool for GUI Interaction

Built computer_use tool enabling mouse and keyboard control — the agent can now click, type, drag, scroll, and press key combos to interact with any GUI application on the screen.

### What was built

**Core: `src/tools/computer-use.ts`**

9 actions: `click`, `double_click`, `right_click`, `move`, `drag`, `type`, `key`, `scroll`, `cursor_position`.

Platform support:
- **macOS**: `cliclick` for mouse ops (with `osascript` fallback for basic clicks), `osascript` for keyboard, Page Up/Down for scroll.
- **Linux**: `xdotool` for all operations.

Key implementation details:
- AppleScript string escaping handles embedded quotes via `character id 34` concatenation.
- Key combo parsing: `"cmd+shift+z"` → modifiers + key, with full key code mapping for macOS and xdotool key name mapping for Linux.
- Coordinates rounded to integers. Scroll amount capped at 20.
- Tool detection (`cliclick`, `xdotool`) cached per-session with test reset.
- Accessibility permission errors detected and surfaced with setup instructions.

**Registration**: Added to `tools/index.ts`, `CORE_TOOL_NAMES` in `tool-groups.ts`, system prompt, and `DESIGN.md`.

**System prompt**: Compressed existing tool descriptions (~60 chars) to stay within the 11900-char headroom budget.

### Before/after

- Before: Agent can see the screen (screenshot) but cannot interact with it. GUI automation impossible.
- After: Agent captures screen → identifies UI elements → clicks/types/scrolls → verifies result. Full computer use paradigm. Can automate GUI apps, fill web forms, navigate menus, test UIs visually.

### Why this matters

This is the capability that distinguishes a general-purpose AI agent from a coding assistant. Combined with the existing screenshot tool, it creates a closed observation→action loop for GUI interaction — the same paradigm used by Manus, OpenClaw, and Anthropic's own computer use demos. The agent can now operate any application with a visual interface, not just CLI tools.

### Tests

43 new tests covering:
- Platform support (macOS, Linux, unsupported)
- All 9 actions on both platforms
- Coordinate validation and rounding
- Input validation (missing text, key_combo, start coords)
- Tool fallback chains (cliclick → osascript on macOS)
- Error handling (missing tools, accessibility permissions, unknown keys/modifiers)
- AppleScript string escaping with embedded quotes
- Scroll amount defaults and caps
- Cursor position output parsing

All 3123 tests pass (3080 existing + 43 new).

### Verification

- Static: `tsc --noEmit` ✅, `tsup` build ✅
- Unit: 3123/3123 pass ✅
- Lint: all 6 changed files clean ✅
- Load: `node dist/cli.js --help` ✅
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Computer use tool** — CHOSEN. Adds fundamentally new capability: GUI interaction via mouse/keyboard. Combined with screenshot, enables the full computer use paradigm. This is what distinguishes general-purpose AI agents from coding assistants.
2. **Git operations tool** — Structured git commands with token-efficient output. Shell + git works well enough. Diminishing returns at 26+ tools.
3. **More provider types (TaskProvider, SchedulerProvider)** — Architecture work extending iter 563's pattern. Current backends work fine and no one is requesting swaps yet.
4. **Module scripts/logging** — Modules defining their own scripts and structured logging. Premature — no external modules being actively created.
5. **Workflow/pipeline engine** — Multi-step automated workflows with checkpointing. Overlaps with what the LLM loop + todo already does naturally.

### Future directions

- **Wayland support**: Linux Wayland sessions need `ydotool` instead of `xdotool`. Add detection and fallback.
- **True scroll on macOS**: Current approach uses Page Up/Down key presses. JXA + CoreGraphics `CGEventCreateScrollWheelEvent` could enable real mouse wheel events.
- **Screen region targeting**: Integration with screenshot to identify UI element coordinates from visual descriptions (e.g., "click the Submit button").
- **Window management**: Focus/activate specific windows by name before interacting (AppleScript `tell application "X" to activate`, xdotool `search --name`).
- **Input validation**: Validate coordinate bounds against screen dimensions before executing.

## Iteration 564 — Compress Builder Prompt 184→94 Lines

Compressed builder prompt by 49% by merging duplicate sections (Orient/Gather/Brainstorm/Choose/How-to-Work → single workflow), removing redundant Goals/Non-Goals, while preserving the calibrated evaluation criterion from iter 548.

### Intervention verdicts (from iter 562)

- **BUILDER_LESSONS compression (179→75)**: INCONCLUSIVE. Iter 563 had 112
  calls (-16% from 561's 133) but context hit 100k (highest ever) and rework
  was 69%/9 fix cycles. Task complexity (14-file cross-cutting provider system)
  confounds comparison. No regression detected.
- **Circular import lesson**: NOT TESTED. Iter 563 didn't encounter circular
  imports.
- **Research lesson removal**: CONFIRMED. 0 research calls in iter 563.
  Removing the dead lesson had no negative effect.

### Diagnosis

The builder prompt (184 lines) was 71% of the total instruction load (~260
lines). In iter 562 I compressed BUILDER_LESSONS from 179→75 (-58%) but left
the prompt untouched. Research consistently shows:
- Models degrade above ~150 instruction density (Prompt Instruction Limits paper)
- 25k tokens is the practical sweet spot for instruction adherence (Aider findings)
- The builder's context/turn hit 100k in iter 563 — highest recorded

The prompt had significant redundancy:
- "Do NOT read source files" stated 3 times → 1
- "Gather signals" in §What-to-Work-On duplicated §How-to-Work steps 1-3
- "Brainstorm" section duplicated §How-to-Work step 2
- §Goals repeated the identity paragraph
- §Non-Goals repeated guardrails

### What changed

**`prompts/build-agent.md` (184 → 94 lines, -49%)**

Merged five sections (Orient, What to Work On with Gather/Brainstorm/Choose,
Goals, Non-Goals, How to Work) into a single 6-step workflow. The evaluation
criterion from iter 548 (architecture-as-capability, diminishing returns,
skeptical assessment) is preserved verbatim in step 2.

Total instruction load: 94 + 75 = 169 lines (was 259). Now within striking
distance of the ~150 instruction threshold.

### Candidates considered

1. **Builder prompt compression** — CHOSEN. Largest remaining instruction
   source (71% of total). Directly extends the iter 562 strategy that addressed
   the Prompt Instruction Limits finding.
2. **Sub-agent delegation lesson for mock updates** — The builder already used
   Agent delegation in iter 563 (call 68). Lessons don't change strategic
   behavior (proven pattern). Skipped.
3. **Context growth mitigation via harness changes** — Would violate the
   step.sh simplicity guardrail. The builder's context is Claude Code's domain.
4. **Parse-log.py rework metric fix** — "9 fix cycles" vs "1 fix-verify cycle"
   discrepancy is confusing but fixing metrics doesn't improve the builder.
5. **BUILDER_LESSONS update for mock-site planning** — The Cross-Cutting
   Changes lesson already says "Note test files with manual stubs (they WILL
   break)." Adding more words won't improve adherence.

### Expected effects

- **Instruction density**: 259→169 (-35%). Closer to the ~150 threshold.
- **Context/turn**: Should decrease slightly — lighter prompt prefix means more
  room for actual work before degradation.
- **Builder behavior**: Unchanged in substance — all guidance is preserved, just
  deduplicated. Watch for regressions in research behavior, evaluation quality,
  or verification thoroughness.

### Research informing this iteration

- Factory.ai context compression study: structured compression retained more
  technical details (3.70 vs Anthropic 3.44, OpenAI 3.35) — compress structure,
  preserve specifics.
- Manus context engineering: append-only context + filesystem offloading.
  Todo.md trap: 1/3 of actions spent on tracking overhead.
- JetBrains "Complexity Trap" (NeurIPS 2025): simple observation masking
  matches LLM summarization at lower cost.
- Incremental vs batch verification: research favors checking after each
  meaningful edit — the cost of cascading bad edits exceeds extra verification.
- Aider architect/editor separation: improved edit correctness 92%→100%.

## Iteration 563 — Provider System for Swappable Core Services

Built typed provider interfaces (MemoryProvider, KnowledgeProvider) and a ProviderRegistry so modules can swap core service backends via config — enabling plug-and-play memory, knowledge, and future service implementations.

### What was built

**Core: Provider interfaces and registry (`src/providers.ts`)**

Two typed interfaces extracted from existing class signatures:
- `MemoryProvider` — `save`, `search`, `list`, `update`, `delete` (matches `MemoryStore`)
- `KnowledgeProvider` — `create`, `read`, `update`, `delete`, `search`, `list`, `count` (matches `KnowledgeStore`)

`ProviderRegistry` class with `register`, `get`, `setActive`, `list`, `getByName`, and `listTypes`. Singleton pattern (`initProviderRegistry`/`getProviderRegistry`/`resetProviderRegistry`).

Convenience getters (`getMemoryProvider()`, `getKnowledgeProvider()`) that resolve from the registry with fallback to built-in singletons — zero-config backward compatibility.

**Module integration (`src/module-types.ts`, `src/module-loader.ts`)**

Two new `ModuleContext` methods:
- `ctx.registerProvider(type, provider)` — module registers itself as a service provider
- `ctx.getProvider<T>(type)` — module retrieves the active provider for a type

`ModuleLoader.activateConfiguredProviders()` runs after `loadAll()` — reads `config.providers` and switches active providers to match. Warns if a configured provider isn't registered.

`ModuleLoader.unloadAll()` clears the provider registry — no stale providers across sessions.

**Config (`src/config.ts`)**

New `providers` field in `KotaConfig`:
```json
{ "providers": { "memory": "my-vector-module", "knowledge": "default" } }
```
Sanitized and merged like other config sections.

**Tool integration (`src/tools/memory.ts`, `src/tools/knowledge.ts`)**

Memory and knowledge tools now resolve via `getMemoryProvider()` / `getKnowledgeProvider()` from the registry instead of direct singleton access. Transparent — same behavior with zero config.

**Session lifecycle (`src/loop.ts`)**

`initProviderRegistry()` and `registerDefaultProviders()` called during session init. `resetProviderRegistry()` on close.

### Before/after

- Before: Changing how memory works (e.g., vector DB search) requires modifying `src/memory.ts` directly — fork the project.
- After: Create a module that implements `MemoryProvider`, set `config.providers.memory = "my-module"`, and the agent uses it transparently. No core code changes.

### Why this matters

Directly addresses the owner's top request: "swap one memory module for another and it would work." The provider system generalizes the `SecretProvider` pattern from `secrets.ts` to any core service. This is the foundation for:
- Vector DB memory (semantic search instead of keyword matching)
- SQLite knowledge storage (performance at scale)
- Cloud-synced memory (multi-device agents)
- Any community-built alternative implementation

### Tests

24 new tests covering:
- ProviderRegistry CRUD (register, get, setActive, replace, clear)
- Singleton lifecycle (init, get, reset)
- Interface conformance (MemoryStore → MemoryProvider, KnowledgeStore → KnowledgeProvider)
- Convenience getters (fallback to singletons, custom provider override)
- Default provider registration and activation

All 3080 tests pass (3056 existing + 24 new).

### Verification

- Static: `tsc --noEmit` ✅, `tsup` build ✅
- Unit: 3080/3080 pass ✅
- Lint: all 14 changed files clean ✅
- Load: `node dist/cli.js --help` ✅
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Provider system for swappable services** — CHOSEN. Directly addresses owner's plug-and-play vision. Architecture work that enables new properties.
2. **Streaming process manager improvements** — Background process management already exists (`src/tools/process.ts`). Incremental value.
3. **Workflow engine** — Multi-step plan execution with checkpointing. Overlaps with what the LLM loop + todo already does naturally.
4. **Tool composition framework** — Declarative tool pipelines. The LLM is already good at orchestrating multi-step workflows.
5. **Data analysis pipeline** — Dedicated tabular data tools. `code_exec` with Python/pandas handles this adequately.

### Future directions

- **More provider types**: `TaskProvider`, `SchedulerProvider`, `HistoryProvider` — extend the pattern to other singletons.
- **Provider discovery CLI**: `kota providers list` to show registered providers per type.
- **Built-in alternative providers**: Ship a `sqlite-knowledge` module that uses SQLite for better query performance.
- **Module interface contracts for tools**: Extend `ToolDef` with `risk` field so module tools self-declare risk level (from iter 561 future directions).
- **Auto-derive tool groups from registry**: Break the `tool-groups.ts` circular dep to derive groups from `registration.group`.

## Iteration 562 — Compress Builder Instructions

Compressed BUILDER_LESSONS.md from 179 to 75 lines (-58%), removing ineffective content and adding a targeted circular-import lesson from iter 561's rework analysis.

### What changed

**BUILDER_LESSONS.md (179 → 75 lines, -58%)**

Removed:
- **Research strategy lesson** (35 lines): Zero measurable effect over 20+
  iterations. 1/10 builder iters did web research regardless. Lesson-based
  approach definitively failed for this behavior — it appears model-inherent.
- **Lint efficiency explanation** (30 → 4 lines): Pattern internalized since
  iter 544. The detailed "why" and "discovery-and-rework cycle" diagram are
  no longer needed — the compact "batch at operation boundaries" rule suffices.
- **Architecture as Capability examples** (28 → 10 lines): Compressed from
  4 worked examples to the core principle. The 4th example (tool registration)
  was completed in iter 561, making it stale.
- **Narrow gotchas** (module count, system prompt, char budget): Merged into
  a compact 4-line section.

Added:
- **Circular imports in cross-cutting refactors** (12 lines): In iter 561,
  the builder lost ~30 calls (23% of session) to cascading circular ESM
  import issues. The existing "Cross-Cutting Changes" lesson covers type
  changes but not import-time initialization. New lesson: check import
  chains before refactoring shared modules, use lazy init, and grep for
  mock sites.

### Iter 560 intervention verdicts

- **Pattern lock counter** (diminishing returns in eval criterion): PARTIAL.
  Builder chose architecture-adjacent work, but still tool-related.
- **Batch-edit lesson**: FAILED for iter 561. Root cause was circular deps,
  not insufficient batching. Lesson retained but wasn't relevant.
- **Research softening**: FAILED. 0 web research. Removed the lesson entirely.

### Why this matters

The ETH Zurich AGENTS.md study (2602.11988) found verbose context files
reduce agent success by 3% and increase cost by 20%. The Prompt Instruction
Limits paper (2507.11538) identifies ~150 instructions as a degradation
threshold for reasoning models. The builder's total instruction load was
~360 lines. After compression: ~260 lines. This improves signal-to-noise
for all remaining instructions.

### Also considered

1. **BUILDER_HISTORY.md** — Rolling 5-iteration work-type summary for pattern
   awareness. Rejected: adds another file to orientation load; builder already
   has access to parse-log.py --trend.
2. **Structured task selection** (LILO variance sampling) — Pick the most
   uncertain task, not the safest. Deferred: promising but needs more design
   to avoid becoming a mechanical procedure.
3. **Self-generated trajectory examples** — Inject winning builder sessions
   as few-shot examples. Deferred: hard to measure, adds significant context.
4. **MCTS over action choices** (SWE-Search) — Parallel plan evaluation.
   Deferred: requires structural harness changes.

### Expected effects

1. Builder sessions should be slightly more efficient (fewer tokens consumed
   reading lessons → more capacity for implementation).
2. Circular import rework should decrease in refactoring iterations (new
   lesson directly targets the diagnosed pattern).
3. No regression expected from removing research strategy lesson (zero effect
   historically).
4. Total instruction load decrease (~360→~260) may improve the builder's
   ability to follow remaining instructions more precisely.

### Verification method

Compare iter 563's metrics against iter 561:
- Re-edit ratio (target: < 67%)
- Context/turn (target: < 92k)
- Any rework related to circular imports (target: 0)
- No new failures from removed lessons

## Iteration 561 — Self-Registering Tool Registry

Built a self-registering tool registry where each tool co-locates its risk level and group metadata, eliminating 3 files from the new-tool registration dance.

### What was built

**Core: `ToolRegistration` type and registry (`src/tools/index.ts`)**

Each of the 26 core tool files now exports a `registration` object:
```typescript
export const registration = {
  tool: clipboardTool,
  runner: runClipboard,
  risk: "safe" as const,
  group: "web",  // optional
};
```

`tools/index.ts` collects all registrations and exports `getCoreRegistrations()`.
Consumers derive their data from the registry instead of hardcoding:

- **`guardrails.ts`**: `SAFE_TOOLS`/`MODERATE_TOOLS` built from `registration.risk`.
  Adding a new tool with `risk: "safe"` automatically appears in the safe set.
- **`module-factory.ts`**: `BUILTIN_TOOL_NAMES` built from registrations. New tools
  are automatically protected from name conflicts with agent-created modules.

**Lazy initialization** for circular ESM import safety: The registration array
and derived structures (runners, tool list, risk sets) are built on first access.
This handles circular import chains like `delegate.ts → context.ts → tools/index.ts
→ delegate.ts` that would crash with eager module-level initialization.

### Before/after: adding a new core tool

| Step | Before (8 files) | After (5 files) |
|------|-------------------|------------------|
| Implement | `src/tools/<tool>.ts` | `src/tools/<tool>.ts` + `registration` export |
| Import | `src/tools/index.ts` | `src/tools/index.ts` (1 line) |
| Guardrails | `src/guardrails.ts` — add to SAFE/MODERATE set | **Auto-derived** |
| Module factory | `src/module-factory.ts` — add to BUILTIN_TOOL_NAMES | **Auto-derived** |
| Tool groups | `src/tool-groups.ts` | `src/tool-groups.ts` |
| Tests | `src/tools/index.test.ts` + `<tool>.test.ts` | `src/tools/index.test.ts` + `<tool>.test.ts` |
| Docs | `DESIGN.md` | `DESIGN.md` |

### Why this matters

Architecture work that enables capability:
- **Reduces builder rework**: The 8-file registration dance was the #1 documented
  source of rework (72% in iter 553). Removing 3 files from the checklist directly
  reduces the surface area for mistakes.
- **Toward plug-and-play**: Each tool is more self-contained. Risk and group metadata
  live with the implementation, not scattered across the codebase. This is a step
  toward the owner's vision of truly modular, swappable capabilities.
- **Enables future composition**: The `getCoreRegistrations()` API gives any consumer
  typed access to all tool metadata. Future work: runtime tool creation, tool
  capability discovery, dynamic tool grouping.

### Tests

- 8 new tests: 6 for `getCoreRegistrations()` (registration count, metadata shape,
  safe/moderate classification, group validation, core tool membership), 2 for
  registry-derived guardrails (safe registrations → safe classification, moderate
  registrations → moderate classification)
- All 3056 tests pass (3048 existing + 8 new)

### Verification

- Static: `tsc --noEmit` ✅, `tsup` build ✅
- Unit: 3056/3056 pass ✅
- Lint: all 30 changed files clean ✅
- Load: `node dist/cli.js --help` ✅
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Self-registering tool registry** — CHOSEN. Directly addresses the 8-file
   registration pain point and owner's modularization vision. Architecture work
   that makes tool creation easier.
2. **Module interface contracts** — Typed interfaces (`MemoryProvider`,
   `StorageBackend`) for swappable modules. High value but requires deeper
   design work. Best built on top of the registry foundation.
3. **Workflow engine** — Multi-step task planning with checkpointing. High feature
   value but less foundational than fixing the tool registration architecture.
4. **Agent self-reflection** — Evaluate own performance and store lessons.
   Interesting but less impactful than structural improvements.
5. **Tool composition primitives** — Pipe tool outputs declaratively. Overlaps
   with what the LLM loop already does.

### Future directions

- **Break tool-groups circular dep**: Extract `ToolResult` to a shared types file
  so `tool-groups.ts` can import from the registry. Would reduce to 4 files.
- **Extend `ToolDef` with risk**: Module-registered tools (memory, schedule, etc.)
  still have hardcoded risk in guardrails. Adding `risk` to `ToolDef` would let
  modules self-declare their risk level too.
- **Module interface contracts**: Now that tools self-describe, build typed
  interfaces that modules implement for swappability (e.g., `MemoryProvider`).
- **Auto-generate tool groups**: Derive `TOOL_GROUPS` and `CORE_TOOL_NAMES` from
  `registration.group` once the circular dep is resolved.

## Iteration 560 — Fix Misleading Rework Metric and Break Builder Pattern Lock

Diagnosed rework metric inflation (multi-feature scope counted as rework), added return-edit ratio to parse-log.py, and calibrated builder evaluation to counter tool-addition pattern lock.

### Diagnosis

**Iter 558 verification**: PARTIALLY VERIFIED. Checklist refinement helped —
builder read index.test.ts before editing in iter 559. But still made 3
separate edits to it. Batch-edit lesson added.

**Rework metric inflation discovered**: The `rework_pct` metric (% of calls
after first verify) was conflating multi-feature iteration scope with actual
rework. Iter 559: 62% "rework" but only 39% return-edit ratio (edits to
already-edited files). The 4.9× test rerun ratio was similarly inflated —
running targeted tests per feature is good practice, not rework. This metric
drove 2 iterations of checklist work (554, 558) partially targeting a phantom
problem.

**Builder pattern lock**: 6 of last 7 builder iterations were tool additions
(conversation recall, task router, smart web page, screenshot, document
reader, clipboard). The evaluation criterion change in iter 548 produced 3
architecture iterations, then the builder reverted. Root cause: tool additions
have clear before/after stories and low risk; the evaluation criterion didn't
account for diminishing returns as tool count grows.

**Research under-utilization**: Only 1/10 builder iterations did any web
research. The research strategy lesson was too discouraging ("expensive"
framing).

### Changes

1. **Added return-edit ratio to parse-log.py** — Fraction of Write/Edit calls
   that target files already written/edited earlier in the session. This
   directly measures "getting it right the first time" without multi-feature
   inflation. Shows in both per-iter and summary trend output. 10-iter avg: 49%.

2. **Diminishing-returns calibration** (build-agent.md evaluation section) —
   Added guidance that when the agent has 25+ tools, each additional tool adds
   less value than the previous ones, and strengthening composition/integration
   often delivers more value per iteration.

3. **Optional trend awareness** (build-agent.md orientation) — Builder can now
   run `python3 parse-log.py --trend 5` to see patterns in recent iterations
   (work types, efficiency, coverage gaps). Information, not a mandate.

4. **Batch-edit lesson** (BUILDER_LESSONS.md) — When making similar changes to
   multiple locations in the same file, plan ALL changes and batch them into
   fewer edits. Targets the 49% re-edit rate.

5. **Softened research lesson** (BUILDER_LESSONS.md) — Removed "expensive"
   framing that was discouraging useful research. 1/10 iters researching is
   too low.

6. **Vitest `--changed` tip** (build-agent.md verification) — Builder can
   now use `npx vitest run --changed` for intermediate verification, which
   uses Vite's module graph to run only tests that import changed files.

7. **Updated improvement thesis** — Recalibrated all priorities. Rework
   metric inflation is now a documented anti-pattern. Test rerun downgraded
   from P1. Pattern lock is new P1. Added 4 new research papers (Mind the
   Gap, GVU Variance Inequality, Codified Context, Self-Generated Examples).

### Candidates considered

1. **Fix rework metric + break pattern lock** — CHOSEN. Compound improvement:
   better analytics → better decisions → better builder behavior.
2. **Predictive test selection** — Use dependency analysis to run only
   affected tests. High effort, unclear payoff given test reruns are inflated.
3. **AgentDiet-style trajectory compression** — Reduce file reads during
   exploration. Would save context but builder needs reads for brainstorming.
4. **Self-critique step in brainstorm** — Builder critiques its own candidates.
   MAR research suggests single-agent reflection degenerates.
5. **Architecture recipes** — Provide formulaic patterns for architecture work
   (like tool checklist for tools). Architecture work is inherently less
   formulaic; would become a mechanical procedure.

### Expected effects

- **Iter 561**: Builder considers at least one non-tool candidate in brainstorm
  (diminishing returns signal + trend data access). Prediction: 50% chance
  builder chooses architecture or testing work.
- **Re-edit rate**: Drops from 49% avg to <40% if batch-edit lesson is followed.
- **Research rate**: Increases from 1/10 to 2-3/10 iters with softened framing.
- **Metric quality**: Future improvers won't waste iterations optimizing
  inflated rework numbers.

## Iteration 559 — Clipboard Tool and Knowledge Store Events

Built a clipboard tool for reading/writing system clipboard and wired knowledge store CRUD operations to the event bus, completing the data-events-actions pipeline.

### What was built

**1. Clipboard tool (`src/tools/clipboard.ts`)**

Read from and write to the system clipboard. New interaction modality that enables seamless data transfer between the agent and other applications.

- **Actions**: `read` (get clipboard text), `write` (set clipboard text)
- **Platform support**: macOS (`pbpaste`/`pbcopy`), Linux (`xclip`), error with guidance on unsupported platforms
- **Limits**: Read truncates at 50K chars, write rejects over 100K chars
- **Zero npm dependencies** — uses only platform clipboard utilities

Registration (full checklist per BUILDER_LESSONS.md):
- `src/tools/index.ts` — import, runner, tools array
- `src/module-factory.ts` — BUILTIN_TOOL_NAMES
- `src/guardrails.ts` — SAFE_TOOLS (low-risk, reversible)
- `src/tool-groups.ts` — CORE_TOOL_NAMES (always available)
- `src/system-prompt.ts` — Coordination tools section
- `src/tools/index.test.ts` — tool count (25→26) and name set

Use cases enabled:
- "Analyze what I just copied" — user copies a stack trace, code, or data
- "Put this on my clipboard" — agent formats results for pasting into another app
- "Format my clipboard" — copy rough text, agent transforms it
- "Extract data from what I copied" — agent parses clipboard content

**2. Knowledge store events (`src/tools/knowledge.ts`, `src/event-bus.ts`)**

Wired knowledge CRUD operations to the event bus, completing the data→events→actions pipeline the owner has been building toward since iter 531.

- `knowledge.create` — emitted with `{id, title, type, tags, scope}`
- `knowledge.update` — emitted with `{id, fields}` (lists changed keys)
- `knowledge.delete` — emitted with `{id}`

Events fire via `tryEmit()` — no-op when bus isn't initialized. Only on success; failed operations emit nothing. Combined with module manifest event handlers (iter 553), this enables:
- Modules that react automatically to data changes
- "When new research is added, notify me" via manifest eventHandlers
- Foundation for reactive data workflows

### Verified

- **Typecheck**: clean (`tsc --noEmit`)
- **Build**: clean (`tsup`)
- **Tests**: 3048 passed (135 files) — up from 3031 (+17 new tests: 10 clipboard, 7 knowledge events)
- **Lint**: clean on all changed files (`npx biome check`)
- **Load**: `node dist/cli.js --help` works
- **Runtime**: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Clipboard tool + knowledge events** — CHOSEN. Clipboard adds a new interaction modality (agent ↔ other apps). Knowledge events complete the data→events→actions pipeline. Together they advance both UX and architecture.
2. **Browser automation** — Playwright-based web control. Massive capability but heavyweight dependency and too complex for one iteration.
3. **Semantic search for knowledge** — Embedding-based search. Needs external API or local model.
4. **File watcher** — Monitor directories for changes. Complex (polling vs. OS events) and narrow use case.
5. **Module scripts/logs** — Let modules define executable scripts. Owner asked for it but lower impact than events.

### Future directions

- **Knowledge event filtering**: Module manifests could declare filters on event payloads (e.g., only fire for entries with tag "urgent")
- **Clipboard monitoring**: Watch clipboard for changes and process automatically (combined with scheduler)
- **Data pipeline composition**: Chain knowledge events → processing → notification workflows declaratively
- **Knowledge store search improvements**: Fuzzy matching, weighted field search, related entries
- **Migrate core modules to use ctx.events**: Continue the module isolation arc using the new events

## Iteration 558 — Compress Improvement Thesis and Refine Checklist

Compressed improvement thesis from 478 to ~190 lines (-60%) and refined tool registration checklist to include test name assertions, targeting the 4.9x test rerun ratio.

### Diagnosis

**Iter 556 verification**: VERIFIED — checklist path fixes worked. Iter 557
builder used correct file paths (guardrails.ts, tool-groups.ts,
module-factory.ts), zero file-not-found errors during registration.

**Iter 557 analysis**: Cost $3.77, +21 tests — solid output. But 53% rework/4
cycles, driven by discovering test NAME list assertions in index.test.ts that
the checklist didn't mention. The checklist said "update expected tool count"
but index.test.ts also has tool name array assertions. Builder edited the file
4 times and read it 2 times discovering these one by one.

**Self-diagnosis**: The improvement thesis grew to 478 lines with ~40 research
paper summaries (216 lines), most absorbed into past interventions. Per the
ETH Zurich study (cited in iter 556) and Chroma Context Rot research, verbose
context degrades my own reasoning quality. The thesis was the largest context
file I load every iteration.

### Changes

1. **Compressed improvement thesis** (478 → 192 lines, -60%):
   - Research section: 216 lines of individual paper summaries → ~40 lines
     in a compact reference table grouped by relevance (active/future/background)
   - Removed duplicated intervention summaries from Improver Pattern Watch
     (were already in Intervention History)
   - Updated metrics and hypothesis for iter 558
   - Added MetaSPO (bilevel prompt optimization) and Meta JiTTesting
     (on-the-fly test generation) as new research

2. **Refined tool registration checklist** in BUILDER_LESSONS.md:
   - Changed step 7 from "update expected tool count" to "update expected
     tool count AND tool name list assertions"
   - Added specific grep patterns (toContain, toEqual, inline arrays)
   - Targets the specific rework pattern from iter 557

### New research integrated

- **MetaSPO** (arXiv 2505.09666): Bilevel system prompt optimization using
  meta-learning. Inner loop optimizes per-task, outer loop optimizes system
  prompt across tasks. Our improver loop IS a manual MetaSPO — inner = builder
  lessons, outer = prompt restructuring. Validates our approach.
- **Meta JiTTesting** (arXiv 2601.22832): Just-in-time test generation per
  code change. 4× catch rate vs hardening tests. Potential future direction
  for KOTA's own test strategy.

### Candidates considered

1. **Compress thesis** ← CHOSEN. Highest meta-impact: improves improver
   reasoning quality every future iteration.
2. Expand checklist with test name assertions — done as secondary fix.
3. Address DESIGN.md triple-read in iter 557 — builder's domain (1037 lines).
4. Predictive test assertion scanning lesson — too prescriptive for the
   builder prompt; checklist detail is the right level.
5. Add process quality scoring to parse-log.py — parse-log.py rut anti-pattern.

### Expected effects

- Improver context load reduced ~60% → better reasoning quality in future iters
- Builder test rework for tool additions should decrease (checklist now covers
  both count and name assertions)
- No degradation expected — all compressed research is preserved in git history
  and summarized in the reference table

## Iteration 557 — Document Reader Tool

Built a read_document tool that extracts text from PDFs, DOCX, RTF, ODT, EPUB and other document formats using system tools, adding document processing as a new input modality for the agent.

### What was built

**`read_document` tool (`src/tools/read-document.ts`)**

Extracts text from document files and returns it as plain text. Zero npm dependencies — uses platform utilities with graceful fallback chains:

- **PDF**: `pdftotext` (poppler) → `pdfminer` (python3) → `PyPDF2` (python3)
- **DOCX**: `textutil` (macOS built-in) → `pandoc` → `python-docx` (python3)
- **RTF**: `textutil` (macOS built-in) → `pandoc`
- **ODT/EPUB/DOC**: `pandoc`
- **HTML**: Built-in tag stripping

Features:
- Page range selection for PDFs (`pages: "3-7"`)
- Configurable max output (`max_chars`, default 50000) with truncation notice
- Empty-content detection with OCR guidance
- Actionable install hints when no extractor is available

**Registration** (full checklist per BUILDER_LESSONS.md):
- `src/tools/index.ts` — import, runner, tools array
- `src/module-factory.ts` — BUILTIN_TOOL_NAMES
- `src/guardrails.ts` — SAFE_TOOLS (read-only, no mutation)
- `src/tool-groups.ts` — CORE_TOOL_NAMES (always available)
- `src/system-prompt.ts` — Files tools section
- `src/tools/index.test.ts` — tool count (24→25) and name set

**Use cases enabled**:
- "Summarize this PDF" — research paper analysis, report digestion
- "Extract data from this contract" — legal/financial document processing
- "Compare these two documents" — combined with delegate for parallel extraction
- "Read this manual and answer my questions" — technical documentation Q&A
- "Process these invoices" — structured data extraction from business documents

### Verified

- **Typecheck**: clean (`tsc --noEmit`)
- **Build**: clean (`tsup`)
- **Tests**: 3031 passed (133 files) — up from 3010 (+21 new tests)
- **Lint**: clean on all changed files (`npx biome check`)
- **Load**: `node dist/cli.js --help` works
- **Runtime**: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Document reader tool** — CHOSEN. Adds a fundamentally new input modality (document text). The agent currently cannot process PDFs, DOCX, or other binary document formats — a major gap for a general-purpose assistant. Zero-dependency approach via system tools.
2. **Knowledge store events** — Wire data changes to the event bus. Important for the data→events→actions pipeline but relatively small change. Deferred.
3. **Clipboard integration** — Read/write system clipboard. Useful but narrow — most use cases can be handled via file_read/file_write.
4. **Background task runner** — Long-running async tasks. Important but architecturally complex. The process tool already handles some of this.
5. **Migrate core modules to ModuleContext** — Continue isolation arc. Important architecture work but not user-visible.

### Future directions

- **OCR integration**: Extract text from image-based PDFs using tesseract
- **Structured extraction**: Return extracted data as JSON (tables, forms, metadata)
- **Multi-document processing**: Batch extraction with comparison/summarization
- **Knowledge store events**: Wire create/update/delete to event bus for reactive workflows
- **Streaming extraction**: Stream large documents page-by-page to avoid memory spikes

## Iteration 556 — Checklist Accuracy and Instruction Deduplication

Fixed 3 wrong file paths in tool registration checklist and removed redundant Context Efficiency lesson, informed by ETH Zurich AGENTS.md study showing verbose context files reduce success by 3%.

### Verification of iter 554

Both interventions **VERIFIED** against iter 555 data:

- **Tool registration checklist**: Builder added a core tool (screenshot) with
  28% rework and 1 fix cycle — vs 72% rework and 5 fix cycles in iter 553
  (notify tool, comparable work). Builder explicitly referenced "full checklist
  per BUILDER_LESSONS.md." Clear success.
- **Brainstorm tightening**: Builder brainstormed "Based on DESIGN.md,
  CHANGELOG, NOTES.md, and git log" — exact orientation inputs. Source files
  read AFTER topic chosen, not during orientation. Deferred-reads compliance
  restored.
- **Overall metrics**: 80 calls, $3.80, 61k ctx — best in 10-iteration window
  (avg: 101 calls, $5.14, 73k ctx).

### Diagnosis

Despite the strong results, iter 555 had 5 errors — 2 caused by wrong file
paths in the checklist:
- `src/tools/guardrails.ts` → actual: `src/guardrails.ts`
- `src/tools/tool-groups.ts` → actual: `src/tool-groups.ts`
- `BUILTIN_TOOL_NAMES` described as in `src/tools/index.ts` → actual:
  `src/module-factory.ts`

Builder followed the checklist, hit file-not-found errors, then used `find` to
locate correct paths. Wasted ~3 calls on path discovery.

Separately: web research (ETH Zurich arXiv 2602.11988) found that verbose
context files reduce task success by 3% and increase cost by 20%+. The Context
Efficiency section in BUILDER_LESSONS.md repeated what the builder prompt
already says 3 times — pure duplication per the study's criteria.

### Changes

**BUILDER_LESSONS.md — fixed checklist paths**
- `src/tools/guardrails.ts` → `src/guardrails.ts`
- `src/tools/tool-groups.ts` → `src/tool-groups.ts`
- Separated `BUILTIN_TOOL_NAMES` into its own item (#3) pointing to
  `src/module-factory.ts`
- Added "read ALL target files before editing" instruction to prevent
  write-before-read errors
- Added "read ONE recent tool as reference template" efficiency guidance

**BUILDER_LESSONS.md — removed redundant Context Efficiency section**
Removed 15 lines that duplicated the builder prompt's deferred-reads
instruction (which appears 3 times). The rule is well-covered in the prompt;
the lesson added no non-inferable information. Informed by ETH Zurich study:
redundant instructions increase cost without improving outcomes.

**Improvement thesis — updated with iter 556 analysis**
- Verified both iter 554 interventions
- Rework regression reclassified as RESOLVED (28% in iter 555)
- New strategic priority: instruction hygiene (subtractive > additive)
- New research: ETH Zurich AGENTS.md study, IBM Trajectory Memory (3 tip
  types), AgentDiet (waste taxonomy), MAR (multi-agent reflexion)

### Candidates considered

1. **Checklist accuracy + instruction dedup** — CHOSEN. Directly fixes errors
   observed in iter 555 (2 file-not-found from wrong paths). ETH Zurich study
   provides research backing for removing redundant lessons. Combined: fixes
   the concrete and applies a structural principle.
2. **Builder prompt workflow consolidation** — Merge the three overlapping
   workflow sections. Deferred: high risk of unintended side effects from major
   prompt restructuring. The targeted checklist fix is safer.
3. **IBM-style lesson taxonomy** — Classify BUILDER_LESSONS.md entries as
   strategy/recovery/optimization tips with effectiveness tracking. Deferred:
   interesting framework but premature — current lessons are working. Worth
   revisiting when lesson count grows or effectiveness plateaus.
4. **AgentDiet-style trajectory pruning** — Classify wasted reads in builder
   sessions. Deferred: would require parse-log.py changes and the builder's
   read focus is already improving (50% in iter 555 vs 50% in iter 553 —
   stable, not getting worse).
5. **Multi-perspective improver critique** — MAR-inspired diverse lenses for
   improvement analysis. Deferred: interesting architectural change but the
   current single-agent improver is producing measurable results.

### Expected effects

- **Fewer path-discovery errors**: Builder follows checklist → hits correct
  files on first try. Target: 0 file-not-found errors from checklist paths.
- **Fewer write-before-read errors**: "Read ALL target files before editing"
  instruction prevents the tool error seen in iter 555.
- **Marginally less context**: Removing 15 lines from BUILDER_LESSONS.md
  reduces context by ~500 tokens per iteration. Small but in the right
  direction (subtractive > additive).
- **Principle established**: Future improver iterations should audit for
  redundancy before adding instructions. The ETH Zurich finding is a
  structural constraint on the improver's natural tendency to add.

## Iteration 555 — Screenshot Capture Tool

Built a screenshot tool that captures the screen and returns it as an image for Claude to analyze, adding visual understanding as a new input modality for the agent.

### What was built

**`screenshot` tool (`src/tools/screenshot.ts`)**

Captures a screenshot of the user's screen and returns it as a base64-encoded image content block. Claude's vision capabilities then analyze the image, enabling the agent to "see" what's on screen.

- **macOS**: `screencapture -x` (silent, built-in)
- **Linux**: Tries `gnome-screenshot`, `scrot`, then `import` (ImageMagick) — first available wins
- **Unsupported platforms**: Clear error with platform-specific guidance
- **Smart resizing**: Downscales to 1568px max (Claude's optimal image dimension) using `sips` (macOS) or `convert` (Linux). Only shrinks, never upscales. Resize failure is non-fatal.
- **Clean lifecycle**: Temp file cleaned up after capture regardless of success/failure

**Infrastructure leveraged (already existed)**

The codebase already had image content block support built into the pipeline:
- `ToolResultBlock` type with `image` variant (src/tools/index.ts)
- `ToolResult.blocks` field for rich content (src/tools/index.ts)
- Tool runner passes blocks through to API messages (src/tool-runner.ts)
- `addToolResults` in context.ts constructs proper content block arrays
- Observation masking strips image content from old results (src/observation-masking.ts)

The screenshot tool is the first tool to actually use this infrastructure.

**Registration** (full checklist per BUILDER_LESSONS.md):
- `src/tools/index.ts` — import, runner, tools array
- `src/module-factory.ts` — BUILTIN_TOOL_NAMES
- `src/guardrails.ts` — SAFE_TOOLS (read-only, no mutation)
- `src/tool-groups.ts` — CORE_TOOL_NAMES (always available)
- `src/system-prompt.ts` — Coordination tools section
- `src/observation-masking.ts` — screenshot-specific placeholder

**Use cases enabled**:
- "What's on my screen?" — visual context without manual description
- "Read the error in this dialog" — agent can read popup text
- "Monitor this dashboard" — combined with scheduler, periodic visual checks
- "Help me debug this UI" — agent sees the actual interface
- "Extract data from this chart" — visual data extraction
- Visual accessibility — agent can describe screen content

### Verified

- **Typecheck**: clean (`tsc --noEmit`)
- **Build**: clean (`tsup` — 12.52KB CLI entry)
- **Tests**: 3010 passed (132 files) — up from 2992 (+18 new tests)
- **Lint**: clean on all 9 changed files (`npx biome check`)
- **Load**: `node dist/cli.js --help` works
- **Runtime**: SKIP (no ANTHROPIC_API_KEY)
- **System prompt budget**: 11820 chars (under 11900 limit)

### Candidates considered

1. **Screenshot capture tool** — CHOSEN. Adds a fundamentally new modality (vision) that can't be replicated with existing tools. Leverages Claude's underutilized multimodal capabilities. Differentiating for a CLI agent.
2. **Knowledge store CRUD upgrade** — Add update/delete/list to knowledge tool, emit events on changes. Important but incremental — refines existing capability rather than adding a new one.
3. **Structured data processing tools** — Native CSV/JSON parsing and transformation. The existing code_exec + shell already handle this well.
4. **Migrate Telegram/Daemon to ModuleContext** — Continue module isolation arc. Important for architecture but not user-visible.
5. **Project/workspace system** — Persistent project state across sessions. Overlaps with existing knowledge/memory; needs clearer design first.

### Future directions

- **Window-specific capture**: Capture a specific window by title or PID instead of full screen
- **Region capture**: Capture a specific screen region (x, y, width, height)
- **Periodic visual monitoring**: Combine with scheduler for dashboard/status monitoring workflows
- **Visual diff**: Compare two screenshots to detect changes (useful for monitoring)
- **OCR integration**: Extract text from screenshots for structured processing
- **Knowledge store CRUD**: Add update/delete/list operations and emit events on data changes

## Iteration 554 — Rework Regression Fix

Added tool registration checklist and tightened brainstorm source-read deferral, targeting the 72% rework spike in iter 553.

### Verification of iter 552

Process quality analysis (fingerprints, read focus, fix cycles) **VERIFIED**.
Used these metrics to diagnose iter 553's rework spike — they are now an
integral part of improver analysis workflow. The analysis revealed:
- 95k context/turn (highest in window, 75k avg)
- 72% rework with 5 fix cycles (49% avg)
- 50% read focus (8/16 files read were edited)
- 7 source files read during orientation despite deferred-reads instruction

### Diagnosis

Iter 553 added a `notify` tool + event handlers in module manifests. The 72%
rework came from two root causes:

1. **Shotgun surgery**: Adding a new core tool required updating 8+ files
   (tool registry, BUILTIN_TOOL_NAMES, guardrails, tool-groups, system
   prompt, test count assertions, DESIGN.md). The builder discovered these
   one at a time during verification, causing 5 fix cycles.

2. **Deferred-reads non-compliance**: Despite the instruction appearing 3×
   in the builder prompt, the builder read 7 source files (file-read.ts,
   index.ts, system-prompt.ts, module-factory.ts, module-loader.ts,
   module-types.ts, process.ts) during orientation before deciding what to
   build. This drove context to 95k — almost back to pre-intervention (97k
   in iter 537). The instruction-repetition approach has hit its ceiling.

### Changes

**BUILDER_LESSONS.md — "New Core Tool Registration" checklist**
Lists all 8 files that need updating when adding a core tool. Planned scope
upfront prevents the discover-fix-discover rework loop. Also added a tool
registration coupling example to "Architecture as Capability" — frames
centralized tool registry as a concrete capability gain, so the builder
might naturally discover and pursue the structural fix.

**Builder prompt — brainstorm section tightened**
- Removed "what's missing, what's broken" from "Gather signals → Internal
  exploration" — this language implicitly invited source code exploration.
- Replaced with explicit statement that DESIGN.md + CHANGELOG are sufficient.
- Added "based on your orientation inputs" to the brainstorm heading, making
  the constraint part of the task description rather than a separate rule.
- Net effect: instead of repeating "don't read source files" (already said
  3×), restructured the brainstorm to make source reads feel unnecessary.

**Improvement thesis — updated with iter 554 analysis**
- Verified iter 552 process quality analysis
- New priority: rework regression (49% avg vs 40% prev window)
- New research: OpenHands V1 SDK (arXiv 2511.03690) on package boundaries,
  DARWIN (arXiv 2602.05848) on structured failure annotation
- Updated evidence section with iter 553 detailed analysis

### Candidates considered

1. **Tool registration checklist + brainstorm tightening** — CHOSEN. Directly
   addresses both root causes of the rework spike. Checklist is concrete and
   actionable; brainstorm change makes deferred-reads natural rather than
   forced.
2. **Lesson compliance tracking in parse-log.py** — Automated detection of
   which lessons are followed/violated. Deferred: would require parse-log.py
   to know about lessons and detect them in logs (complex, fragile).
3. **Builder prompt workflow consolidation** — Merge the three overlapping
   workflow sections (Orient Yourself, What to Work On, How to Work). Deferred:
   high risk of unintended side effects from major prompt restructuring. The
   targeted brainstorm change addresses the specific problem.
4. **Automated failure annotation** — DARWIN-inspired structured failure
   records between builder iterations. Deferred: would require harness changes
   and the failure mode isn't iteration-level (builder iterations pass, the
   rework is within-iteration).
5. **Evaluation depth via LLM-as-judge** — Rate code quality of builder
   output. Deferred: still blocked by ANTHROPIC_API_KEY.

### Expected effects

- **Rework reduction in tool-related work**: Builder knows full scope upfront
  → fewer fix cycles. Target: <50% rework when adding tools (was 72%).
- **Context reduction via deferred reads**: Builder brainstorms from
  orientation inputs only → fewer source files read before deciding. Target:
  <80k context/turn avg (was 95k in iter 553).
- **Architectural awareness**: "Tool registration coupling" example in
  Architecture as Capability may inspire builder to pursue centralized
  registry. This would structurally fix the rework problem.

## Iteration 553 — Desktop Notifications and Reactive Module Events

Built a notify tool for desktop alerts and added event handler support to module manifests, enabling agent-created modules to react to events autonomously.

### What was built

**1. `notify` tool (`src/tools/notify.ts`)**

Desktop notification tool that sends OS-native alerts. Enables the agent to proactively alert the user about completed tasks, monitoring events, or anything needing attention when the user isn't watching the terminal.

- **macOS**: `osascript` with `display notification` (supports configurable sound)
- **Linux**: `notify-send` from libnotify (helpful error if not installed)
- **Fallback**: Console output via stderr (unsupported platforms or desktop failure)
- Always-available core tool (not gated behind any tool group)
- Classified as `safe` in guardrails (no mutation, no side effects beyond notification)
- 14 tests covering all platforms, error paths, and parameter handling

**2. Event handlers in module manifests (`src/module-factory.ts`)**

Module manifests can now include `eventHandlers` — an array of event subscriptions that run code when bus events fire. Each handler specifies:
- `event` — the event name to subscribe to (e.g., `schedule.fire`, `session.end`)
- `code` — Python or Node.js code to run when the event fires
- `language` — optional, defaults to Python

Handler code receives `event_name` (string) and `payload` (dict/object) variables. Errors are logged but never crash the event bus.

This transforms agent-created modules from **passive** (only define tools that wait to be called) to **active** (react to events autonomously). Combined with `notify`, this enables end-to-end automation:

```
User: "Monitor my API and alert me if it goes down"
Agent creates module:
  - schedule trigger: every 5 minutes
  - event handler on schedule.fire: check URL, send notify if down
  - Module runs autonomously
```

**3. Supporting changes**

- Added `notify` to `BUILTIN_TOOL_NAMES` in module-factory.ts (prevents conflicts)
- Added `notify` to `CORE_TOOL_NAMES` in tool-groups.ts (always available)
- Added `notify` to `SAFE_TOOLS` in guardrails.ts
- Updated system prompt: notify in Coordination tools, event handlers in Extensibility
- Updated DESIGN.md with notify tool docs and event handler documentation
- Validation: 6 new tests for eventHandlers in validateManifest
- Conversion: 4 new tests for event handler → bus subscription wiring

### Verified

- **Typecheck**: clean (`tsc --noEmit`)
- **Build**: clean (`tsup` — 12.52KB CLI entry)
- **Tests**: 2992 passed (131 files) — up from 2968 (+24 new tests)
- **Lint**: clean on all 9 changed files
- **Load**: `node dist/cli.js --help` works
- **Runtime**: SKIP (no ANTHROPIC_API_KEY)

### Candidates considered

1. **Migrate Telegram/Daemon to ModuleContext APIs** — Completes module isolation. Deferred: important but not user-visible. Next natural step for architecture work.
2. **Workspace/project system** — Multi-session project continuity. Deferred: overlaps with existing knowledge/memory; needs clearer design.
3. **Enhanced delegation with context injection** — Delegates auto-receive memory/knowledge. Deferred: requires changes across delegation pipeline.
4. **Structured output pipelines** — Chain tools declaratively. Deferred: LLM already orchestrates well; marginal gain vs. complexity.
5. **Tool composition engine** — Declarative workflow definition. Deferred: too complex for one iteration.

### Future directions

- Migrate Telegram and Daemon modules to use `ctx.events` and `ctx.createSession()` instead of direct core imports (completes module isolation arc)
- Add event filter support to manifest handlers (`filter: { label: "backup" }`) for selective triggering
- Build a `watch` tool that monitors URLs/files/commands at intervals and sends notifications on changes
- Enable module_factory to create modules with both event handlers AND tools that can send notifications (compose the two features)

## Iteration 552 — Process Quality Analysis for All Builder Sessions

Added universal process quality analysis to parse-log.py and fixed architecture classification, giving the improver structural process quality signals for every builder iteration instead of only depth iterations.

### Verification of iter 550

The classification fix from iter 550 was **PARTIALLY EFFECTIVE**. It caught
iter 549 ("Extended ModuleContext" → "modulecontext" keyword match) but missed
iter 551 ("Module Event Proxy and Session Factory" — no keyword match). The
trend showed "9 feature, 1 architecture" when reality was "8 feature, 2
architecture."

**Verdict**: Keywords too narrow. Expanded with 9 additional terms (event proxy,
session factory, dependency injection, singleton removal, module API, etc.).

### What changed

**1. Process quality analysis for all sessions (parse-log.py)**

Previously, `_print_builder_analysis` only ran for "depth" sessions (flagged by
depth-specific keywords in assistant text). Since 9/10 recent iterations are
non-depth, the improver got NO process quality analysis for the vast majority of
sessions — only raw metrics in the trend output.

Restructured the function into two tiers:
- **Universal analysis** (all builder sessions): phase fingerprint, pre-edit
  reads, read focus %, fix-verify cycles, verification levels, test delta,
  files edited
- **Depth-specific analysis** (depth sessions only): refresh check, target
  extraction, sweep, mutation check

**2. Phase fingerprint**

New metric that maps each tool call to a phase letter (O=orient, R=research,
E=explore, I=implement, V=verify, D=document) and collapses consecutive
duplicates. Gives a structural view of the session at a glance:
- `O→E→I→V→D` = clean orient→explore→implement→verify→document
- `O→E→I→V→I→V→I→V→D` = multiple fix-verify cycles (rework)
- `O→R→E→I→V→D` = research phase present

Inspired by SWE-EVAL trajectory analysis and HAL multi-dimensional evaluation.

**3. Read focus metric**

Measures what fraction of source files read during the session were eventually
edited. Higher = more focused exploration (builder reads what it needs). Lower =
over-exploration. Iter 551: 56% (good). Iter 549: 41% (expected — architecture
work requires auditing many files that aren't edited).

**4. Architecture classification expansion**

Added 9 keywords to catch module isolation work patterns: event proxy, session
factory, dependency injection, singleton, module API, module event, module
isolation, core import, context extension. Iter 551 now correctly classified.

### New research integrated

- **EvoAgentX** (EMNLP 2025): TextGrad prompt refinement, AFlow workflow
  optimization, MIPRO preference learning. 7-20% improvements.
- **HAL** (Princeton, ICLR 2026): Multi-dimensional agent evaluation. Key
  finding: higher reasoning effort can reduce accuracy.
- **SWE-EVAL**: Trajectory failure analysis — extract last 20 turns, assign
  failure labels. Stronger models fail on instruction following, not tool use.
- **Anthropic eval guide** (Jan 2026): Multiple graders per task, transcript
  analysis, layered evaluation approach.
- **ICLR 2026 Hitchhiker's Guide**: Tool invocation evaluation via Node F1,
  Edge F1, Edit Distance.

### Other candidates considered

1. **CodeScene MCP integration** — Deterministic code health scoring. Deferred:
   requires builder-domain changes (adding tools to src/).
2. **ACE-style lesson restructuring** — Structured deltas with effectiveness
   counters for BUILDER_LESSONS.md. Deferred: current format is working well
   (all lessons followed in iter 551).
3. **Effort level optimization** — HAL research suggests `--effort high` may
   not always be optimal. Deferred: can't A/B test with current harness.
4. **EvoAgentX-style automated prompt optimization** — Treating prompt elements
   as parameters optimized via feedback. Deferred: requires evaluation
   infrastructure we don't have yet (ANTHROPIC_API_KEY blocker).

### Expected effects

- Future improvers get process quality data for EVERY builder session, enabling
  evidence-based prompt changes instead of inference from raw metrics alone
- Architecture classification accurate for module isolation work — prevents
  false "feature dominant" signals
- Phase fingerprint enables quick structural comparison across sessions

## Iteration 551 — Module Event Proxy and Session Factory

Extended ModuleContext with ctx.events proxy and ctx.createSession() factory so modules can emit/subscribe to events and spawn agent sessions without importing core singletons.

### What was built

**`ctx.events` — Event proxy** (`ModuleEventProxy` type):
- `emit(event, payload)` — fire events on the bus. No-op if bus not connected.
- `on(event, handler)` — subscribe to events. Returns unsubscribe function.
- `once(event, handler)` — subscribe once, auto-unsubscribe after first call.
- Lazy resolution: captures `this.bus` at call time, not creation time — safe before `connectEvents()`.
- Auto-cleanup: subscriptions made via the proxy are tracked per-module and cleaned up on `unload()`.

**`ctx.createSession()` — Session factory** (`ModuleSession` type):
- Creates agent sessions without importing `AgentSession` — avoids circular dependency.
- Returns `{ send(prompt): Promise<string>, close(): void }` — minimal interface.
- Uses dependency injection: `AgentSession` sets a factory on `ModuleLoader` via `setSessionFactory()`.
- Defaults: `noHistory: true`, `historySource: "action"`, `reflectionEnabled: false`, `BufferTransport`.
- Throws with clear error if called before factory injection (CLI-only mode).

### Why it matters

These are the last two ModuleContext APIs needed for truly self-contained modules. Before: modules that needed events or sessions had to import core singletons (`EventBus`, `AgentSession`), breaking isolation. After: everything flows through `ModuleContext` — modules need zero core imports to emit events, react to other modules, or spawn sub-sessions.

This enables:
- Tool runners that emit events via closure (e.g., notify other modules when work completes)
- Modules that spawn autonomous sessions (e.g., Telegram bot handling per-chat sessions)
- Cross-module coordination without direct coupling

### Verified
- Static: `npm run typecheck && npm run build` — clean
- Unit: 2968 tests pass (14 new, 0 broken)
- Lint: `npx biome check` on all changed files — clean
- Load: `node dist/cli.js --help` — works
- Runtime: SKIP — no `ANTHROPIC_API_KEY` in environment

### Future directions
- Migrate `TelegramBot` to use `ctx.createSession()` instead of importing `AgentSession` directly
- Migrate `Daemon` to use `ctx.events` instead of importing `initEventBus`
- Add `ctx.config` mutation support (modules can update their own config section)
- Module-to-module messaging via typed event channels

## Iteration 550 — Architecture Work Detection and Evaluation Criterion Verification

Added architecture work type classification to parse-log.py and verified the iter 548 evaluation criterion change worked, after diagnosing that binary feature/depth classification created false signals for future improvers.

### Verification of iter 548

The evaluation criterion restructuring from iter 548 **WORKED**. In iter 549,
the builder:
- Brainstormed module isolation as candidate #1
- **Chose and implemented it** — extending ModuleContext with `log`,
  `getSecret()`, `listTools()`, and tools-as-function pattern
- This is the first architecture-classified iteration in the trend window

In contrast, iter 547 (before the criterion change) brainstormed the same
module isolation candidate as #1 but dismissed it as "doesn't add capability."
The reframe from "what concrete outcome?" to "what does this make possible
that wasn't possible before?" was the root cause fix.

### Classification fix (parse-log.py)

The trend analysis previously had binary classification: "depth" (structured
module/approach targeting) or "feature" (everything else). Architecture work
like ModuleContext extension was invisible — classified as "feature" despite
being structural improvement. This caused:
- "6/6 feature dominant" signal when it was actually 5/6 feature + 1 architecture
- Risk of future improvers wasting cycles trying to fix already-resolved bias

Fix: CHANGELOG title-based reclassification in `trend()`. Architecture keywords
(refactor, isolat, self-contained, decouple, etc.) in the CHANGELOG title
trigger reclassification. Uses title (what was built) rather than assistant
text (includes unselected brainstorm candidates) to avoid false positives.

### New research integrated

- **ACE (ICLR 2026)**: Structured delta updates with success/failure counters
  prevent context collapse in self-improving loops
- **Codified Context (Feb 2026)**: Three-tier knowledge architecture scales
  sub-linearly with codebase size
- **CodeScene MCP**: OSS deterministic code health scoring as agent tool
- **ACON**: Gradient-free context compression, 26-54% token reduction

### Updated strategic priorities

Feature-factory bias → RESOLVED. New #1: evaluation depth (GVU "Second Law").
Two concrete paths: CodeScene MCP for automated quality scoring, ACE-style
structured evaluation for lesson management.

### Other candidates considered

1. **ACE-style lesson restructuring** — Convert BUILDER_LESSONS.md to structured
   deltas with effectiveness counters. Deferred: current format works well;
   this is an optimization, not a fix.
2. **CodeScene MCP integration** — Add code health scoring as builder tool.
   Deferred: requires builder-domain changes (adding tools to src/).
3. **Builder context optimization** — Architecture work cost $7.02 vs $4.55
   avg. Deferred: architecture work naturally requires more exploration;
   optimizing would risk reducing quality.
4. **ANTHROPIC_API_KEY resolution** — Still blocked. Requires user action.

## Iteration 549 — Extended ModuleContext API for Self-Contained Modules

Extended ModuleContext with log, getSecret, listTools, and tools-as-function pattern so modules can be truly self-contained without importing core singletons.

### What was built

**Three new ModuleContext properties** — every module now receives:
- `ctx.log` — scoped logger (`info`, `warn`, `error`, `debug`) with `[module:<name>]` prefix. Debug only logs in verbose mode.
- `ctx.getSecret(key)` — get a secret value by name. Returns null if not found or store not initialized. Decouples modules from the SecretStore singleton.
- `ctx.listTools()` — list names of all registered tools. Read-only introspection for modules that need to discover available capabilities.

**Tools-as-function pattern** — `KotaModule.tools` now accepts both:
- `ToolDef[]` (static array, existing pattern — backward compatible)
- `(ctx: ModuleContext) => ToolDef[]` (factory function, new pattern)

The factory form lets tool runners capture the context via closure. This is the key enabler for self-contained modules — tool runners can use `ctx.log`, `ctx.getSecret()`, `ctx.listTools()`, and `ctx.storage` without importing anything from core.

**`resolveModuleTools(mod, ctx?)` utility** — canonical helper for normalizing the `ToolDef[] | Function` union type. Used in the module loader and available for external consumers.

**Secrets module refactored** — demonstrates the tools-as-function pattern. The `get_secret` tool runner now uses `ctx.getSecret()` via closure instead of directly importing `getSecretStore()`. Uses `ctx.log.debug()` for inject logging.

### Why it matters

The owner's longest-standing concern: "modules are just files which import stuff from core... modularization should enable plug-n-play tools, skills, channels, memory systems."

Before this change, a module's tool runner couldn't access any KOTA service without importing a core singleton. This forced every module to be tightly coupled to core internals.

After this change, a module developer can build a fully functional tool using only `ModuleContext`:
```typescript
const myModule: KotaModule = {
  name: "weather",
  tools: (ctx) => [{
    tool: { name: "get_weather", ... },
    runner: async (input) => {
      const apiKey = ctx.getSecret("WEATHER_API_KEY");
      ctx.log.info(`Fetching weather for ${input.city}`);
      // ... implementation using only ctx ...
      return { content: result };
    },
  }],
};
```

No core imports needed. The module is a self-contained unit.

### Verified
- Typecheck: clean
- Build: clean
- Tests: 2954 passed (130 files) — 16 new tests, 2938 existing unchanged
- Lint: clean on all 13 changed files
- CLI: `kota --help` loads correctly
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Files changed
- `src/module-types.ts` — added `ModuleLogger` type, `log`/`getSecret`/`listTools` to ModuleContext, `tools` union type, `resolveModuleTools()` helper
- `src/module-loader.ts` — updated `createContext()` to provide new APIs, `load()` to resolve tools factory, tracked tool counts per module
- `src/modules/secrets.ts` — refactored to use tools-as-function with `ctx.getSecret()` via closure
- `src/tools/module-factory.ts` — updated to use `resolveModuleTools()` for type safety
- `src/tool-adapters.ts` — updated `isKotaModule()` to accept function tools
- `src/module-context.test.ts` (new) — 16 tests for log, getSecret, listTools, tools-as-function, resolveModuleTools
- 7 test files — updated stubs to include new ModuleContext properties

### Candidates considered
1. **Module isolation — extend ModuleContext** ← CHOSEN. Owner's #1 concern, makes possible: "developer creates a working plugin using only ModuleContext — no core knowledge needed."
2. **Multi-step plan execution** — Systematic decomposition with verification gates. Important for complex tasks but not foundational.
3. **Structured data pipeline** — Purpose-built tools for CSV/JSON analysis. Useful for data work but code_exec already covers this.
4. **Cross-session project continuity** — Auto-persist project state. Partially covered by knowledge store + conversation history.
5. **Background task orchestration** — Parallel agent sessions. Interesting but high complexity.

### Future directions
- **Event bus on context** — Add `ctx.events` as a lifecycle-aware proxy (emit/subscribe from any hook). Requires buffering subscriptions before bus connects.
- **Migrate more modules** — Apply the tools-as-function pattern to memory, knowledge, history, scheduler modules.
- **Module API documentation** — Auto-generate API docs from the `ModuleContext` type for external developers.
- **Module testing utilities** — `createTestContext()` helper so module developers don't need to manually build stubs.
- **`ctx.createSession()`** — Factory for autonomous agent sessions, enabling modules like daemon and telegram to use the context rather than importing the loop directly.

## Iteration 548 — Restructure Evaluation Criterion to Break Feature-Factory Bias

Restructured the builder's evaluation criterion and lessons to make architecture outcomes compete on equal footing with features, after verifying the iter 546 lesson-based approach failed.

### Verification of iter 546 intervention

**FAILED.** The iter 546 broadened evaluation criterion ("what weakness does
this eliminate?") plus the "Quality Beyond Features" lesson did not change
builder behavior. In iter 547, the builder:
- Listed module isolation as brainstorm candidate #1
- Acknowledged it as the "owner's longest-standing concern"
- Dismissed it: "Module isolation (#1) is important but doesn't add capability"
- Chose a feature (web page extraction) instead

Root cause: the evaluation criterion asked "what concrete outcome does this
produce?" — features always have more vivid, tangible outcomes than
architecture work. The builder's mental model of "capability" = "new thing the
agent can do" was the bottleneck, not missing awareness of quality work.

### What changed

**1. Evaluation criterion (build-agent.md)** — Changed the evaluation question
from "what concrete outcome does this produce?" (feature-biased framing) to
"what does this make possible that wasn't possible before?" (neutral framing).
Added equally vivid examples for both features and architecture work. Added
explicit warning against dismissing structural work as "not adding capability."

**2. BUILDER_LESSONS.md** — Replaced "Quality Beyond Features" (abstract,
informational, failed) with "Architecture as Capability" (outcome-oriented,
links quality work to specific before/after scenarios that feel like capability
gains). Each quality gap now maps to a concrete workflow it enables.

### Research informing this change

- **DGM (Sakana AI, 2025)**: Self-improving agent's self-discovered
  improvements were hardening (validation, tool reliability), not features —
  because evaluation measured end-to-end task success. "Evaluation criteria
  determine behavior."
- **CodeScene quality gates**: Quantitative code health scores as blocking
  constraints make quality "ambitious" (has a number to beat). Identified as
  escalation path if criterion change fails.
- **Addy Osmani "80% Problem"**: Architecture work is self-reinforcing — better
  architecture → better agent output. Quality work as investment, not maintenance.
- **GVU Second Law**: When improvements plateau, strengthen the verifier.
  Confirmed by empirical DGM evidence.

### Expected effects (verify in iter 550)

- Builder should evaluate quality candidates using before/after workflow
  scenarios rather than dismissing them as "not adding capability"
- Work type distribution should shift — at least 1 of next 3 builder iterations
  should choose quality/architecture work over a standalone feature
- If the builder STILL chooses features after this change, the next intervention
  is quantitative quality scoring (CodeScene-style measurable metrics)

### Other candidates considered

1. **Prune BUILDER_LESSONS.md** — Instructions at 72 total, safely below 150
   threshold. Not urgent.
2. **Reduce duplicate file reads** — Builder read DESIGN.md 3x in iter 547.
   Minor efficiency issue (~$0.20 wasted). Not highest impact.
3. **Enhance parse-log.py work type classification** — Currently binary
   (feature/depth). Finer-grained classification would give better signal. Low
   priority vs the core evaluation problem.
4. **CodeScene-style quality gates** — Quantitative blocking constraints. Held
   in reserve as escalation if criterion change fails.

## Iteration 547 — Smart Web Page Extraction with Content Detection and Metadata

Built page-level HTML extraction that identifies main content regions, extracts page metadata, and removes class/ID-based boilerplate — making web_fetch dramatically more useful for research, analysis, and information gathering tasks.

### What was built

**Page-level extraction** (`src/html-page-extract.ts`) — three layers of intelligence
on top of the existing HTML→Markdown pipeline:

1. **Content region detection**: Finds `<article>`, `<main>`, `[role="main"]`, or
   common content div patterns (`id="content"`, `.entry-content`, `.post-content`,
   `.article-content`). When found, extracts only that region — eliminating sidebars,
   related articles, comment sections, and other noise that the tag-based boilerplate
   removal misses. Falls back to full page when no region is detected.

2. **Metadata extraction**: Pulls title, description, author, date, and site name
   from `<head>` meta tags. Supports OpenGraph tags (og:title, og:description,
   og:site_name, article:published_time) with fallback to standard meta tags.
   Metadata is formatted as a compact header prepended to the content.

3. **Class/ID boilerplate removal**: Removes `<div>`/`<section>` elements whose
   class or id matches 17 common noise patterns: sidebar, comments, related, social,
   share, widget, advertisement, cookie, consent, popup, modal, banner, toolbar,
   search-form, newsletter, promo, sponsor. Also removes `<form>` and `<template>` blocks.

**Integration**: `web_fetch` now calls `extractPage()` for HTML responses. The output
includes a metadata header (title, author, date, site name, description) followed by
a separator and clean Markdown — giving the agent immediate context about what it's
reading without consuming extra tool calls.

### Why it matters

The agent has `web_search` and `web_fetch`, but prior to this iteration, `web_fetch`
returned noisy content that wasted tokens and confused the LLM. Real web pages contain
sidebars, comment sections, cookie banners, newsletter signups, social sharing widgets,
and related article links — none of which contribute to the information the agent needs.

This directly impacts every non-coding domain: research, analysis, writing, planning.
When the agent reads a web page to gather information, it now gets:
- Clean article content without sidebar/comment/widget noise
- Page metadata (title, author, date) for citation and context
- Dramatically fewer tokens wasted on boilerplate HTML

Before: search → fetch (noisy HTML) → LLM struggles to find relevant content.
After: search → fetch (clean markdown + metadata) → LLM has clear, structured content.

### Verified
- Typecheck: clean
- Build: clean
- Tests: 2938 passed (129 files) — 35 new tests, 2903 existing unchanged
- Lint: clean on all changed files
- CLI: `kota --help` loads correctly
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Files changed
- `src/html-page-extract.ts` (new) — content region detection, metadata extraction,
  boilerplate-by-attr removal, extractPage() function
- `src/html-page-extract.test.ts` (new) — 35 tests covering metadata, regions,
  boilerplate, formatting, and realistic page scenarios
- `src/tools/web-fetch.ts` — switched from extractContent() to extractPage(), added
  metadata header formatting
- `src/html-extract.ts` — no changes (kept as-is for backward compatibility)
- `DESIGN.md` — added Page-Level Web Extraction section

### Future directions
- **Text density heuristics**: When no semantic container is found, score blocks by
  text-to-tag ratio to find the content-richest region (similar to Readability)
- **Link density filtering**: Detect and remove navigation-heavy blocks even without
  class/id signals
- **Structured data extraction**: Pull JSON-LD, microdata, and schema.org annotations
  for richer metadata (recipes, products, events)
- **Multi-page synthesis**: For paginated content, auto-detect and fetch subsequent
  pages to return the complete article
- **Configurable extraction profiles**: Per-domain extraction rules for sites with
  known layouts (documentation sites, news sites, etc.)

### Candidates considered
1. **Smart web page extraction** ← CHOSEN. Directly enables research/analysis workflows
   that were previously hindered by noisy HTML output.
2. **Module isolation refactor**: Address owner's concern about modules importing from
   core. Important for architecture quality, but doesn't add capability.
3. **Intelligent context recovery**: Re-derive state from filesystem after compaction.
   Interesting but narrow use case.
4. **Multi-step plan execution**: Systematic plan decomposition with verification gates.
   Would improve complex task handling but the task router already provides some of this.
5. **Cross-session project continuity**: Auto-persist project-level context. Partially
   covered by knowledge store and conversation history.

## Iteration 546 — Broaden Builder Evaluation from Features to Quality

Broadened builder evaluation criterion and lessons to value architecture quality and code hardening alongside new features, guided by GVU "Second Law" research on strengthening evaluation over generation.

### Verification of iter 544 intervention

**Composition-aware brainstorming → SUCCESS.** The builder chose composition
E2E tests in iter 545, directly responding to the "Composition Gap" lesson.
7 tests built covering code fix, error recovery, lint-gated edits, multi-turn
state, task+shell, and parallel+sequential workflows. Execution was the most
efficient in the window: 40 calls, $1.79, 43k context, 0 errors.

### Diagnosis

The evaluation criterion ("what specific multi-step user workflow does this
enable or improve?") inherently favors adding capabilities over strengthening
what exists. The composition lesson worked as a one-shot redirect, but the
structural bias toward features remains — 8/8 recent iters classified as
"feature" in trend analysis.

New research (GVU "Second Law", arXiv 2512.02731) provides theoretical
grounding: **when improvements plateau, strengthen the verifier (evaluation
criteria), not the generator (builder)**. Our evaluation signal rewards
passing tests, not architecture quality or code maintainability.

### Changes

1. **Builder prompt (`prompts/build-agent.md`)**: Broadened the evaluation
   criterion in section 3 from "what workflow does this enable?" to also value
   "what existing weakness does it address?" — making refactoring, architecture
   fixes, and hardening legitimate brainstorm choices. Updated brainstorm
   categories to replace the now-addressed composition gap with "strengthening
   what exists."

2. **BUILDER_LESSONS.md**: Replaced "Composition Gap" (now partially closed by
   iter 545's 7 tests) with "Quality Beyond Features" — surfaces the remaining
   quality dimensions: module isolation (owner's concern from NOTES.md),
   higher-level untested behaviors, code maintainability. Framed as information
   for brainstorming, not a mandate.

3. **Improvement thesis**: Updated hypothesis to reflect composition gap as
   addressed, added 6 new research papers (GVU Variance Inequality, prompt
   instruction limits, EvolveR, AlphaEvolve, SWE-CI), refreshed evidence and
   strategic priorities. Key new insight: prompt instruction density is a
   theoretical risk to monitor.

### Expected effects

- Builder iter 547 should consider quality/architecture work as a legitimate
  option during brainstorming, not just new features
- The "Quality Beyond Features" lesson surfaces concrete gaps (module isolation,
  higher-level behaviors) without mandating specific work
- If the builder still chooses a feature, that's fine — the criterion now allows
  but doesn't force diversification

### Candidates considered

1. **Broaden evaluation criterion + quality lessons** ← CHOSEN. Highest leverage
   — changes what the builder values, not what it does.
2. **EvolveR-style lesson effectiveness scoring**: Add outcome tracking to
   BUILDER_LESSONS.md entries. Deferred — current lessons are all recently
   verified effective. Revisit when lessons accumulate enough to need pruning.
3. **Prompt instruction density audit**: Count and reduce instructions across
   builder prompt + lessons. Deferred — 308 total lines is within safe bounds
   per research (threshold at ~150 *instructions*, not lines). Monitor.
4. **parse-log.py multi-dimensional evaluation**: Track architecture quality
   and maintainability metrics. Deferred — would require defining what those
   metrics mean for session logs, which is non-trivial.
5. **Strengthen improver prompt with GVU-informed evaluation structure**.
   Deferred — the current prompt is working well. Self-modification should
   wait until there's evidence of improver failure modes.

## Iteration 545 — Composition E2E Tests for Multi-Step Workflows

Built 7 composition E2E tests that prove the agent's capabilities work together in realistic multi-step workflows, closing the composition gap identified by SWE-EVO research.

### What was built

**Composition test suite** (`src/composition.test.ts`) — 7 scenarios exercising
multi-step workflows through the full agent loop using the mock client:

1. **Code fix workflow** (grep → read → edit → read-back): Agent searches for a
   file with a typo, reads it, fixes it, and verifies the fix. Tests 4 tools in
   sequence with data flowing between them.

2. **Error recovery** (read fails → grep → read correct): Agent tries to read a
   non-existent file, gets an error, adapts by searching, and reads the correct
   file. Proves error results flow back correctly and the agent can recover.

3. **Write → edit → read roundtrip**: Agent creates a JSON config, edits a
   value, and reads back to confirm. Proves file creation, modification, and
   verification compose correctly.

4. **Lint-gated edit recovery**: Agent tries an edit that introduces a JS syntax
   error. The lint gate catches it and auto-reverts. The error flows back, and
   the agent retries with correct syntax. Proves the lint safety net works
   end-to-end through the loop.

5. **Multi-turn state persistence**: Agent writes a file in turn 1, then in
   turn 2 reads it back. Verifies that context from turn 1 (messages, tool
   results) is present in turn 2's API call.

6. **Task tracking + shell**: Agent creates a todo, runs a shell command, and
   marks the task done. Proves the todo and shell tools compose through the loop.

7. **Parallel + sequential**: Agent reads two files in parallel (multiToolResponse),
   then edits both sequentially. Verifies parallel tool results flow correctly
   into subsequent single-tool calls.

### Why it matters

The agent has 24+ individually tested capabilities, all passing unit tests. But
prior to this iteration, zero tests verified they compose into real workflows.
SWE-EVO research (arXiv 2512.18470) shows single-task eval overstates capability
3x for compositional work. These tests prove:

- Tool results flow correctly between sequential steps (context plumbing)
- Error results propagate and enable recovery
- Lint gate reverts integrate with the full loop
- State persists across multiple `send()` calls
- Parallel and sequential tool execution can be mixed in one workflow

Each test asserts not just final outcomes but also intermediate API call contents,
verifying that tool results from step N appear in the messages of step N+1.

### Verified
- Typecheck: clean
- Build: clean
- Tests: 2903 passed (128 files) — 7 new composition tests
- Lint: clean on all changed files
- CLI: `kota --help` loads correctly
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Files changed
- `src/composition.test.ts` (new) — 7 composition E2E test scenarios
- `DESIGN.md` — added Composition Tests section under Testing

### Future directions
- **Cross-session continuity**: E2E test that stores knowledge in session 1 and
  recalls it in session 2 (requires knowledge_store mocking)
- **Delegation composition**: Test that delegates to a sub-agent and integrates
  the result into the main workflow
- **Architect mode composition**: Test the architect → editor → verify pipeline
- **Ambiguous request handling**: Test that the agent asks for clarification when
  the request is underspecified
- **Context compaction under load**: Test that workflows still work after context
  compaction triggers mid-task

## Iteration 544 — Shift Builder from Feature Factory to Composition Testing

Added composition-aware brainstorming and a "Composition Gap" lesson to break the builder out of its feature-factory pattern and toward verifying that capabilities compose into working workflows.

### Verification of previous intervention (iter 542)
- **Lint batching lesson**: VERIFIED. Iter 543 had 4-5 lint calls vs the
  previous 6.8× average — ~35% reduction. Builder followed the batching
  pattern without prompting.

### Diagnosis
The process is highly efficient: iter 543 achieved the lowest cost ($3.88),
lowest rework (33%), and stable context (71k) in the 6-iteration window. All
efficiency interventions have converged. But 6/6 recent builder iters are
standalone features that pass unit tests without any verification that
capabilities compose. SWE-EVO (arXiv 2512.18470) confirms this is a real risk:
GPT-5 drops from 65% to 21% when evaluated on sustained composition vs single
patches. The evaluation signal (tests pass) rewards adding capabilities, not
proving they work together.

### Changes
1. **Builder prompt** (`prompts/build-agent.md`):
   - Added "ensuring capabilities compose into real working workflows" as a
     brainstorm category, pointing to the new BUILDER_LESSONS section
   - Sharpened evaluation criterion from "how much better for real users?" to
     "what specific multi-step user workflow does this enable or improve?" with
     a concrete vs vague example
2. **BUILDER_LESSONS.md**: Added "Composition Gap" section documenting the gap
   between 24+ unit-tested capabilities and untested user-facing workflows,
   citing SWE-EVO and FeatureBench evidence, and pointing to the mock-client
   E2E infrastructure as the verification tool
3. **Improvement thesis**: Updated hypothesis (efficiency → composition gap),
   verified lint intervention, added SWE-EVO/AgentRewardBench/AgentPRM research

### Expected effects
- Builder iter 545 considers composition/integration testing alongside new
  features in its brainstorm
- If it chooses composition work: E2E tests that exercise multi-step workflows
  (search → read → edit → verify) via mock client
- If it still chooses a feature: the evaluation criterion forces it to articulate
  a concrete workflow impact, which should produce better-targeted features

### Other candidates considered
- Exploration efficiency (delegate-then-read pattern): Low impact — cost already
  at $3.88, diminishing returns
- Structured skill bank (SkillRL-inspired): Medium impact but risks over-
  engineering BUILDER_LESSONS.md
- Offline trace evaluation (AgentRewardBench): High impact but requires
  infrastructure the improver can't build (builder domain)

## Iteration 543 — Task Router for Strategy-Adaptive Requests

Built a task-type detection and strategy routing system that classifies user requests and provides task-specific guidance, making the agent smarter about how it approaches different types of work from the first turn.

### What was built

**Task Router** (`src/task-router.ts`):
- Weighted pattern matching classifies prompts into 7 task types: research, coding, data_analysis, writing, planning, debugging, automation (plus general fallback)
- Each type has 4-5 regex patterns with weights (1-3); highest total score wins
- Minimum score threshold (2) prevents false positives on generic messages
- Returns strategy hints, recommended tool groups, and task type

**Strategy hints**: Compact, actionable per-task-type reminders appended to the user message:
- Research: "Delegate parallel searches on different angles. Compare 3+ sources with dates."
- Coding: "Start with repo_map. Group related changes. Run tests after each edit."
- Debugging: "Read the full error. Grep for context around the failure."
- etc.

**Auto-group enablement**: Task router recommends tool groups per task type (e.g., `web` + `management` for research, `code` + `advanced_editing` for coding). These are auto-enabled alongside the existing `detectToolGroups()` signal detection.

**Loop integration** (`src/loop.ts`): Task routing runs on every `send()` alongside request analysis. Strategy hint is appended to the user message; groups are auto-enabled. 5-line integration.

### Why it matters

The agent has comprehensive workflow guidance in its system prompt (8 workflow patterns), but system prompt guidance is constant — it doesn't adapt to the specific request. The task router makes the relevant strategy salient at the right moment by injecting a task-specific hint alongside the user's message.

This is relevance priming: the same information exists in the system prompt, but positioning it adjacent to the user's intent improves adherence. Research on prompt engineering consistently shows that proximity of guidance to the relevant context improves task completion.

Additionally, auto-enabling the right tool groups means users don't need to know about progressive disclosure or call `enable_tools` manually — the agent has the right tools available from turn 1.

### Verified
- Typecheck: clean
- Build: clean
- Tests: 2896 passed (127 files) — 24 new tests covering all task types, disambiguation, formatting, and edge cases
- Lint: clean on all changed files
- CLI: `kota --help` loads correctly
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Files changed
- `src/task-router.ts` (new) — task type detection, strategy hints, group recommendations
- `src/task-router.test.ts` (new) — 24 tests
- `src/loop.ts` — integrated task routing into request processing (import + 5 lines)
- `DESIGN.md` — added Task Router section

### Future directions
- **Task complexity detection**: Classify tasks as simple/moderate/complex to adjust depth of response (simple → direct answer, complex → plan with todo first)
- **Multi-type routing**: Detect compound tasks ("research and implement") and provide guidance for both phases
- **Feedback-driven pattern refinement**: Log task type detections and let the user correct misclassifications to improve patterns over time
- **Module-specific routing**: Let modules register their own task patterns and strategies via `registerCustomGroup`'s pattern parameter
- **Full-text conversation search**: Extend conversation_recall to search message content, not just titles

## Iteration 542 — Lint Batching Lesson and Research Synthesis

Added lint efficiency lesson to BUILDER_LESSONS.md, fixed parse-log.py test delta false positive, and synthesized 9 new research papers into improvement thesis.

### Verification of iter 540 intervention (research strategy)

**INCONCLUSIVE**: Iter 541 didn't use web research (0 web calls), which was the
correct decision for a feature built entirely on existing code. The research
strategy lesson wasn't stress-tested. No negative signal.

### Diagnosis: lint rework is the new efficiency bottleneck

Analyzed sessions 537, 539, 541 to understand why lint reruns average 6.8× per
iteration despite the builder auto-fixing lint per-file:

- **Session 537 (worst)**: 12 lint runs. Anti-pattern: per-file fix →
  intermediate verification → discover warnings → broader scope check → re-fix
  with `--unsafe` flag → re-verify.
- **Session 539 (middle)**: 8 lint runs. Same anti-pattern plus redundant
  re-verification of same file after edits.
- **Session 541 (optimal)**: 6 lint runs. Batched lint at operation boundaries
  (after Write, after batch Edits, after test Edits, final verification). No
  intermediate verification checks. 50% fewer runs than session 537.

### Changes

1. **BUILDER_LESSONS.md**: Added "Lint Efficiency" section codifying session
   541's optimal pattern — batch lint at operation boundaries, avoid
   intermediate verification between auto-fix passes.

2. **parse-log.py**: Fixed test delta false positive where "+1 new test file"
   was matching as "+1 test" instead of the correct "+13 new tests". Added
   negative lookahead `(?!\s+file)` to the P3 regex.

3. **improvement-thesis.md**: Major update with 9 new research papers:
   - SICA (ICLR 2025): self-improving coding agent, unified builder/improver
   - Darwin Godel Machine: population-based agent evolution
   - Huxley Godel Machine: clade-level metaproductivity (evaluate iterations
     by descendant productivity)
   - MemRL: Q-value-scored memory retrieval
   - SkillRL: hierarchical skill bank with recursive refinement
   - SWE-PRM: real-time antipattern detection (+10.6 points at $0.2/task)
   - FeatureBench: feature-level eval (Claude 74% SWE-Bench, 11% FeatureBench)
   - Hodoscope: unsupervised trajectory behavior discovery

### Expected effects

- Lint reruns should drop below 5× per iteration (verify iter 544)
- Test delta accuracy improved (trend now correctly shows +13 for iter 541)
- Research synthesis gives the improver a richer palette of techniques for
  future iterations

### Other candidates considered

- **SWE-PRM-style real-time monitoring**: High impact but requires monitoring
  infrastructure (modifying step.sh or adding a parallel process). Deferred.
- **SkillRL-inspired structured lessons**: Upgrade BUILDER_LESSONS.md to a
  structured skill bank. Current prose format works well — defer until evidence
  shows diminishing returns.
- **HGM metaproductivity tracking**: Cross-iteration correlation analysis.
  Would require parse-log.py changes. Deferred to avoid parse-log.py rut.

## Iteration 541 — Conversation Recall Module

Built a conversation_recall tool and history module so the agent can search and read its own past conversations, plus integrated history search into the per-request context analyzer for automatic recall.

### What was built

**Conversation Recall Tool** (`src/tools/conversation-recall.ts`):
- `search` action — keyword search across conversation titles and directories
- `list` action — show recent conversations with metadata (date, message count, source)
- `read` action — load messages from a specific conversation by ID or prefix, with truncation (500 chars/msg, 50 msgs max) to prevent context explosion
- Proper error handling: missing params, nonexistent IDs, ambiguous prefixes

**History Module** (`src/modules/history.ts`):
- 11th built-in module, registered in the `management` tool group
- Prompt section teaching the agent when to use conversation recall vs. memory/knowledge
- Classified as `safe` in guardrails (read-only access)

**Request Analyzer Integration** (`src/request-analyzer.ts`):
- Per-request context analysis now searches conversation history alongside memory
- When user keywords match past conversation titles, related conversations appear in the pre-loaded context hint
- Zero LLM cost — pure heuristic search
- `RequestAnalysis` type extended with `conversations` field

### Why it matters

The agent had complete amnesia between sessions. It could save/recall memories (key-value facts) and knowledge entries (structured documents), but couldn't reference actual prior conversations. When a user said "remember what we discussed about X?", the agent was helpless.

Now the agent can:
1. **Proactively recall** — the request analyzer auto-surfaces related past conversations in the context hint before the agent even responds
2. **Explicitly search** — use `conversation_recall` tool to find and read specific past conversations
3. **Reference prior context** — read full message histories from previous sessions

This is the difference between a stateless chatbot and a persistent assistant that builds continuity across sessions.

### Verified
- Typecheck: clean
- Build: clean
- Tests: 2872 passed (126 files) — 13 new tests covering all tool actions, edge cases, and integration
- Lint: clean on all changed files
- CLI: `kota --help` loads, history module registered
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Files changed
- `src/tools/conversation-recall.ts` (new) — tool definition and runner
- `src/tools/conversation-recall.test.ts` (new) — 13 tests
- `src/modules/history.ts` (new) — module registration
- `src/modules/index.ts` — added history module (10 → 11 builtins)
- `src/request-analyzer.ts` — added conversation history search
- `src/request-analyzer.test.ts` — updated for new `conversations` field
- `src/guardrails.ts` — added `conversation_recall` to SAFE_TOOLS
- `src/module-cli.integration.test.ts` — updated module count assertions (10 → 11)
- `DESIGN.md` — added Conversation Recall section, updated module count

### Future directions
- **Content-level search**: Currently searches conversation titles only (via `history.list()`). Could add full-text search across message content for deeper recall.
- **Conversation summarization**: Auto-generate summaries when conversations are saved, enabling richer search and more compact context hints.
- **Cross-session learning**: Use conversation recall to identify patterns across sessions — recurring questions, common workflows, frequently referenced files.
- **Conversation tagging**: Let the agent tag conversations for better organization and retrieval.


---

Older entries (iterations 1–540) archived to CHANGELOG.archive.md.
