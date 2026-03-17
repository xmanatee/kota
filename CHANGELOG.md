# KOTA Changelog

## Iteration 570 — Fix CHANGELOG Growth and Cap Entry Verbosity

Addressed structural CHANGELOG growth that exceeded read limits within 2 iterations of archiving, by capping entries at 25 lines, using tail-based reading, and archiving iters 541-563.

### Iter 568 verdicts
- **CHANGELOG archive**: PARTIALLY EFFECTIVE. Grew back past 25K-token limit within 2 iters (entries avg ~70 lines).
- **Eval criterion + trend analysis**: EFFECTIVE. Builder chose architecture work in iter 569, breaking the 5/5 feature pattern lock. Best metrics in 5+ iters (61 calls, $2.53, 48k ctx, 0 fix cycles).

### Changes
1. **Archived iters 541-563** — Active CHANGELOG now 416 lines (was 2080)
2. **Builder prompt**: entries capped at 25 lines; orient uses `tail -80 CHANGELOG.md` instead of full Read
3. **Improvement thesis**: updated with iter 569 evidence, research (ReVeal, OpenEvolve, AgentRx), resolved pattern lock

### Candidates considered
1. CHANGELOG verbosity fix — CHOSEN (highest-impact structural fix)
2. Pre-flight self-critique (ReVeal) — promising but lower priority while system is performing well
3. Evolutionary prompt optimization (OpenEvolve-style) — interesting but our manual improver loop already fills this role
4. Auto-archive threshold in step.sh — violates step.sh simplicity boundary

### Expected effects
- Builder entries shrink from ~70 to ~25 lines
- CHANGELOG stays under read limit for ~50+ iterations instead of ~15
- Builder saves 1-2 tool calls/iteration (no read-limit error + retry)

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

