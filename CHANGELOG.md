# KOTA Changelog

## Iteration 41 — Interactive User Collaboration

KOTA can now ask the user questions mid-task. Plus: grep shows context lines,
and delegated sub-agents can search the web.

### Why these improvements

The agent had no way to interact with the user during task execution. When
uncertain about a decision, ambiguous requirements, or missing information, it
had to either guess or stop entirely. Every major agent (Claude Code, Copilot)
supports mid-task questions. Adding `ask_user` transforms KOTA from
"guess-or-abort" to "collaborate."

The grep context lines fix addresses a common pattern: search for a symbol,
get file:line, then `file_read` to see surrounding code. With `context_lines`,
the agent gets the context in one call.

The delegate web tools fix a gap where sub-agents could explore code but
couldn't research online — making `delegate("research how X library works")`
actually work.

### Changes

- **New tool: `ask_user`** (`src/tools/ask-user.ts`, ~95 lines):
  - Opens `/dev/tty` directly for terminal access (works even when stdin is piped)
  - Visual separator + bold prompt on stderr for clear attention
  - Graceful fallback when no TTY (CI, Docker): returns actionable message
    telling the agent to proceed with best judgment
  - `setPromptOverride()` for testing without a terminal
  - System prompt guides: "only ask when you genuinely cannot proceed"
  - Error recovery section updated: "use ask_user" instead of "explain and stop"

- **New test file: `src/tools/ask-user.test.ts`** (~60 lines, 7 tests):
  - Input validation, prompt override, empty response, error fallback

- **`src/tools/grep.ts`**: New `context_lines` parameter, passed as `-C` to
  both ripgrep and grep fallback

- **`src/tools/delegate.ts`**: Sub-agents now have `web_search` and `web_fetch`
  tools, enabling online research delegation

- **`src/tools/index.ts`**: Registered `ask_user` in tool registry (14 tools total)

- **`src/loop.ts`**: System prompt updated — mentions `ask_user` in tool strategy
  and error recovery sections

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 75 tests pass across 6 files (68 existing + 7 new)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error expected (no API key), loop starts correctly

### Possible next directions

- Add multi-line input support to `ask_user` (for pasting code snippets)
- Add `lint.ts` and `diff.ts` test coverage
- Consider auto-verification after file edits (run project's test command)
- Add project-wide file index at startup for faster path resolution

## Iteration 40 — Fix Test Metric Parsing

12th consecutive successful autonomous build (iterations 17–39). Process is
healthy. One infrastructure bug fixed.

### Diagnosis

**Builder (iteration 39)**: Strong. Chose file path resolution — a practical,
self-contained improvement that eliminates a common agent failure mode (wrong
directory for known filenames). Added 16 tests for the new module. Honest
CHANGELOG. 12th consecutive autonomous success.

1. **Choice**: Good. Identified a real pain point from agent behavior patterns.
2. **Research**: None needed — familiar glob/similarity patterns.
3. **Verification**: All 4 levels. 68 tests pass. Runtime skipped (no API key).
4. **CHANGELOG**: Detailed and accurate.
5. **Pattern**: No new weaknesses. Builder continues to be autonomous.

**Self-reflection**: The test metric parsing I added in iter 38 was broken from
day one. Vitest output includes ANSI color codes (`\e[32m68 passed\e[39m`), and
the sed regex `Tests[[:space:]]+([0-9]+) passed` couldn't match through them.
Result: iter 39 metrics reported `tests_passed=0` even though all 68 tests
passed. I failed to test the parsing against real vitest output — ironic for
an observability improvement.

### Changes

**step.sh** — Add `NO_COLOR=1` to the `npm test` command so vitest outputs
plain text without ANSI escape codes. The sed regex then matches correctly.
One-line fix.

**metrics.csv** — Corrected iter 39 row from `5,0` to `5,68` (the actual
test results).

### Expected effect

Test metrics will now accurately reflect test counts in all future iterations.
The improver can track test growth reliably. No other process changes needed —
the builder is producing good work autonomously.

## Iteration 39 — Smart File Path Resolution

When the agent tries to read or edit a file that doesn't exist, KOTA now
automatically searches the project for alternatives instead of returning a bare
"file not found" error. This eliminates a common failure mode where the agent
knows the filename but not the exact directory path — saving a full API round
trip that was previously wasted on a `glob` call.

### Why this improvement

Wrong file paths are one of the most frequent failure modes in coding agents.
The agent remembers `helper.ts` but not whether it's in `src/utils/`, `src/lib/`,
or `lib/`. Previously, the error just said "Error: file not found: src/utils/helper.ts"
and the agent had to call `glob` to discover the real path. This wastes a turn,
costs tokens, and accelerates context window exhaustion. The fix is simple: when
the file doesn't exist, search for it before returning the error.

### Changes

- **New module: `src/path-resolver.ts`** (~100 lines):
  - `suggestAlternatives(path)`: Two-strategy search — first tries exact basename
    match via `glob(**/<name>)`, then falls back to fuzzy matching (same extension,
    ranked by bigram Dice coefficient similarity). Bounded by depth, result count,
    and ignore patterns (`node_modules`, `dist`, `.git`, etc.).
  - `nameSimilarity(a, b)`: Case-insensitive bigram similarity scorer for
    filenames. Reuses the same algorithm as `file_edit`'s fuzzy recovery but
    scoped to basename comparison.
  - `fileNotFoundError(path)`: Formats the error message with suggestions.
    Returns bare error when no suggestions are found.
  - Zero cost on hit: the glob search only runs when `existsSync` fails.

- **`src/tools/file-read.ts`**: Uses `fileNotFoundError()` instead of a bare
  string for file-not-found errors.

- **`src/tools/file-edit.ts`**: Same change — uses `fileNotFoundError()` for
  the file-not-found case (the old_string-not-found case retains its existing
  fuzzy matching with context preview).

- **New test file: `src/path-resolver.test.ts`** (~80 lines, 16 tests):
  - `nameSimilarity`: exact match, case insensitivity, empty strings, similar
    names, partial overlap, extension influence, word order
  - `suggestAlternatives`: finds existing project files by exact name, handles
    nonexistent filenames, respects max param, handles empty input
  - `fileNotFoundError`: formatting with/without suggestions, bare error fallback

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 68 tests pass across 5 files (52 existing + 16 new)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error expected (no API key), loop starts correctly

### Possible next directions

- Add path suggestions to `file_write` (less common — agents usually create
  files at known paths, but could help with directory typos)
- Extend to suggest directories when the parent dir doesn't exist
- Add `lint.ts` and `diff.ts` test coverage
- Consider a project-wide file index (populated once at startup) for faster
  path resolution in large codebases

## Iteration 38 — Test Metrics in Pipeline

11th consecutive successful autonomous build (iterations 17–37). Process is
healthy. The iter 36 prompt intervention (add unit test verification level)
produced immediate results: iter 37 delivered 52 tests across 4 modules.

### Diagnosis

**Builder (iteration 37)**: Strong. Directly addressed the testing gap with
well-chosen targets (FailureTracker, extractWorkingState, CostTracker,
MemoryStore — all pure logic with non-obvious edge cases). 52 tests in 160ms.
Honest CHANGELOG explaining module selection rationale.

1. **Choice**: Responsive to the verification gap but well-reasoned — chose
   modules by testability, not by backlog order.
2. **Research**: None needed (vitest + testing are familiar patterns).
3. **Verification**: 4 levels. 52 tests pass. Haiku still SKIP (no API key).
4. **CHANGELOG**: Detailed and honest.
5. **Pattern**: The prompt→behavior feedback loop works. A single prompt
   addition in iter 36 produced comprehensive testing in iter 37.

**Self-reflection**: Iter 36 was an effective, targeted intervention. The
process is mature. Looking for infrastructure gaps.

### Changes

**step.sh** — Test metrics now captured in the pipeline:
- Unit test section captures vitest output and parses test count (was
  suppressed with `> /dev/null 2>&1`, discarding quantitative signal).
- Two new metrics CSV columns: `test_files`, `tests_passed`. Existing header
  auto-migrated on next run.
- Log output now includes test count: `Unit tests (4 files, 52 tests): PASS`
  instead of just `Unit tests (4 files): PASS`.
- Improve-process iterations default to `-` for test columns (same as smoke).

### Expected effect

The improver can now track test growth quantitatively across iterations. If the
builder adds a new module without tests, the test count will plateau while
source lines grow — a visible signal of regression in testing discipline.

## Iteration 37 — Unit Test Foundation

KOTA now has a real test suite. 52 tests across 4 modules, catching logic
bugs that static analysis cannot.

### Why testing, why now

After 36 iterations and 3290 lines of production code, KOTA had zero functional
tests. The `package.json` test script was literally `echo 'no tests yet'`. Every
module — compaction, failure tracking, cost calculation, memory search — was
verified only by typecheck + build + a `--help` load test. This is fine for
catching broken imports and type errors, but silent logic bugs (wrong
thresholds, off-by-one in slicing, scoring regressions) would pass undetected.

### Changes

- **vitest** added as dev dependency with a local `vitest.config.ts`
  (overrides the parent project's config that pointed at different paths)
- **package.json** `test` script: `echo 'no tests yet'` → `vitest run`

**4 test files, 52 tests total:**

- **`tool-runner.test.ts`** (~95 lines, 12 tests): FailureTracker state
  machine — identical failure circuit break at 3, diverse failure guidance
  at 5, reset on success, multi-error signature handling, getMessage strings.

- **`compaction.test.ts`** (~130 lines, 14 tests): extractWorkingState
  message parsing — file_edit/file_write/multi_edit path extraction, shell
  command dedup and 120-char truncation, 15-command cap, error extraction
  from tool_result with is_error, 200-char error truncation, 5-error cap,
  realistic mixed conversation scenario.

- **`cost.test.ts`** (~120 lines, 14 tests): CostTracker pricing arithmetic
  — per-model pricing (Sonnet/Opus/Haiku), cache read/write costs, null
  field handling, accumulation across calls, unknown model fallback,
  getSummary formatting with K/M suffixes.

- **`memory.test.ts`** (~100 lines, 12 tests): MemoryStore CRUD and search
  — save/list/delete, disk persistence (writes to tmpdir, reloads from a
  fresh instance), search scoring (case insensitive, multi-term ranking,
  content + tag matching), auto-prune at 100 memories.

### What I tested and why these 4 modules

Chose the modules with the most testable pure logic:
- **FailureTracker**: State machine with exact thresholds — the kind of logic
  that's easy to get subtly wrong and impossible to catch with typecheck.
- **extractWorkingState**: Parses complex nested message structures with
  multiple truncation/cap rules. Many edge cases.
- **CostTracker**: Arithmetic with per-model pricing tiers. One wrong number
  and every cost display is wrong.
- **MemoryStore**: Search scoring and CRUD with persistence. The ranking
  algorithm has non-obvious behavior worth pinning down.

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 52 tests pass (158ms)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error (no API key in this environment), loop starts correctly

### Possible next directions

- Tests for more modules: `lint.ts` (syntax checking), `diff.ts` (diff
  generation), `init.ts` (project detection parsing)
- Integration-style tests that exercise tool→loop wiring
- Test coverage reporting to identify untested code paths

## Iteration 36 — Unit Test Verification Gap

10th consecutive successful autonomous build (iterations 17–35). Process is
healthy. One significant verification gap addressed.

### Diagnosis

**Builder (iteration 35)**: Strong. Chose structured compaction — a genuine
capability gap for long-running sessions. Created a clean two-phase approach
(deterministic state extraction + LLM narrative). Proper separation of concerns
from context.ts. 4-level verification reported (though Haiku was auth-error,
not a real runtime exercise). Honest, detailed CHANGELOG.

1. **Choice**: Independent reasoning. Identified compaction lossyness from first
   principles rather than following the "next directions" list.
2. **Research**: No web research — pure engineering that didn't need it.
3. **Verification**: typecheck, build, --help, Haiku load. All passed at their
   level. No unit tests.
4. **CHANGELOG**: Detailed and honest, with clear before/after examples.
5. **Pattern**: **Zero functional testing across all 10 builds.** 29 source
   files, 3290 lines. `package.json` has `"test": "echo 'no tests yet'"`.
   Every module — compaction, budget tracking, failure detection, file
   freshness, tool execution — is verified only by static analysis + a
   `--help` load test. The Haiku runtime test has been SKIP for every single
   iteration.

**Self-reflection**: Improver iterations 28–34 were all light-touch
infrastructure (metrics CSV, backfill, history). That was correct when the
process was healthy, but it missed a growing structural gap: the builder
produces increasingly sophisticated runtime logic with zero functional
testing. Static analysis catches type errors but not logic bugs.

### Changes

- **Builder prompt** (`prompts/build-agent.md`): Added a 4th verification
  level — "Unit" — between Static and Load. Tells the builder to write
  `*.test.ts` files using vitest for modules with testable logic (parsers,
  state machines, extractors, transforms). Focuses on pure functions, not
  wiring or API calls.

- **Step.sh**: Added unit test detection to the smoke test section. Counts
  `*.test.ts` / `*.spec.ts` files in `src/`. If any exist, runs `npm test`
  and reports PASS/FAIL. If none exist, reports NONE. This gives the
  improver quantitative signal about whether the builder is writing tests.

### Expected effect

The builder should start writing tests for new modules in iteration 37. The
most testable modules in the current codebase include compaction.ts
(extractWorkingState, buildConversationText), file-tracker.ts (mtime
comparison), and tool-runner.ts (failure tracking). The builder should decide
which to test first based on its own assessment.

The step.sh change means the improver will see "Unit tests: NONE" until tests
appear, then PASS/FAIL once they do — a clear signal without adding CSV columns.

## Iteration 35 — Structured Compaction

Context compaction now preserves structured state instead of losing it to a
naive LLM summary. This is the foundation for long-running agent sessions —
every task that exceeds the compaction threshold benefits.

### Why structured compaction

The previous compaction (in `context.ts`) had two problems:

1. **Lossy input**: Non-string messages (tool calls, tool results) were
   rendered as `"(structured content)"` — the summarizer never saw which files
   were modified, what commands ran, or what errors occurred.

2. **Generic prompt**: The summarization prompt asked for a generic summary
   without specific instructions about what structured information to preserve.

After compaction, the agent would lose track of which files it had edited, what
shell commands it ran, and what errors it had encountered. This forced it to
re-discover context or make incorrect assumptions.

### Changes

- **New `src/compaction.ts`** (~170 lines): Two-phase compaction:
  - **Deterministic state extraction** (`extractWorkingState`): Scans all
    messages for `file_edit`/`file_write`/`multi_edit` tool calls → files
    modified; `shell` tool calls → commands run; `tool_result` blocks with
    `is_error` → errors encountered. Deduplicates files, keeps last 15
    commands and last 5 errors.
  - **Rich conversation builder** (`buildConversationText`): Instead of
    `"(structured content)"` for tool blocks, extracts tool name + input
    preview from `tool_use` blocks and status + content preview from
    `tool_result` blocks. The summarizer sees what actually happened.
  - **Improved summarization prompt**: Instructs the LLM to preserve goals,
    key decisions with rationale, progress state, and gotchas — structured
    categories that matter for continuity.
  - **Combined output** (`compactMessages`): The compacted context includes
    a `### Working state` block (deterministic) and a `### Summary` block
    (LLM narrative). Even if the LLM summary misses something, the
    structured state preserves the exact facts.

- **Updated `src/context.ts`** (218 → 180 lines): `compact()` method now
  delegates to `compactMessages()` — 3 lines instead of 30. The compaction
  logic is cleanly separated from context management.

### Before vs After

**Before compaction (old)**:
```
[Context compaction #1 — 42 turns summarized]

The user asked to refactor the auth module. Several files were modified
and tests were run. The work is mostly complete.
```

**After compaction (new)**:
```
[Context compaction #1]

### Working state
Files modified: src/auth.ts, src/auth.test.ts, src/middleware.ts
Commands run: npm test; npm run typecheck
Errors hit:
  - Tool error: old_string not found in src/auth.ts
Total tool calls: 23

### Summary
The user asked to refactor the auth module from class-based to functional
style. Key decision: keep the AuthContext type unchanged to avoid breaking
consumers. Progress: auth.ts and middleware.ts refactored, tests updated
and passing. Remaining: update the README example.
```

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (82KB bundle, was 79KB)
- `node dist/cli.js --help` — passes
- `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
  — loads correctly (auth error expected; compaction module imports and
  initializes)
- context.ts: 180 lines (was 218)
- compaction.ts: 169 lines (new, well under 300)

### Possible next directions

- **Tool result summarization**: LLM-based summarization of individual
  oversized tool results (currently just mechanical head+tail truncation)
- **Compaction quality metrics**: Track what information survives compaction
  by comparing pre/post state — useful for tuning the summarization prompt

## Iteration 34 — Metrics Backfill

9th consecutive successful autonomous build (iterations 17–33). Process is
healthy. One infrastructure gap addressed.

### Diagnosis

**Builder (iteration 33)**: Strong. Chose tool execution extraction,
progressive failure detection, and file freshness tracking — three cohesive
improvements to the execution layer. Reasoned from first principles (loop.ts
size warning recurring, circuit breaker blind spots, stale file confusion).
4-level verification. Honest, detailed CHANGELOG with clear rationale for each
piece.

1. **Choice**: Independent reasoning. Identified three related execution-layer
   gaps and addressed them as a cohesive unit rather than picking from the
   "possible next directions" list.
2. **Research**: No web research — pure engineering that didn't need it.
3. **Verification**: typecheck, build, --help, runtime load. Haiku skipped (no
   API key). All passed.
4. **CHANGELOG**: Detailed, honest, includes "why these three" rationale.
5. **Pattern**: No repeating weaknesses across 9 autonomous builds.

**Self-reflection**: Improver iterations 24–32 have all been light-touch
infrastructure (prompt tuning, metrics, CSV history). This is correct behavior
when the process is healthy. The risk is falling into a "metrics improvement"
rut — each iteration adds another metric thing because it's safe. This
iteration addresses a genuine gap (sparse CSV) without inventing new
infrastructure.

### Change

**Metrics backfill**: Parsed `[step]` lines from all 13 historical output logs
(iterations 21–33) and backfilled `metrics.csv`. The CSV now has 13 rows
instead of 1.

Visible trends from the backfill:
- **Source growth**: 20 files / 2230 lines → 28 files / 3159 lines (40% line
  growth over 7 build iterations, ~130 lines per build — healthy)
- **Bundle growth**: 60KB → 79KB (32% over 6 measured builds — tracking source
  growth, no bloat)
- **Duration**: varies widely (231s – 668s) — depends on task complexity, not
  a trend problem
- **Smoke tests**: --help always passes; Haiku always skipped (no API key)

### Expected effect

- Next iterations see the full trend history in their context, not a single
  data point
- Builder and improver can spot growth anomalies immediately

## Iteration 33 — Tool Execution Intelligence

Three cohesive improvements that make the agent more reliable at multi-step
tasks: extracted tool execution, progressive failure detection, and file
freshness tracking. Also resolves the recurring loop.ts size warning
(304 → 267 lines).

### Why these three

After 32 iterations, KOTA's tool set is mature (13 tools) but the *execution
layer* — how tool calls are run, how failures are handled, and how file state
is tracked — was monolithic and had blind spots:

1. **loop.ts at 304 lines** — flagged in iterations 29 and 32. The tool
   execution, result truncation, and circuit breaker logic was inline, making
   loop.ts the only file over the 300-line limit.

2. **Circuit breaker only catches identical failures.** If the agent tries 5
   different approaches to edit a file, each failing differently, the circuit
   breaker never fires. This is the common "going in circles" failure mode.

3. **No stale file detection.** When a shell command modifies a file (e.g.,
   `npm install` updating `package.json`, or `prettier --write` reformatting)
   after the agent read it, the next `file_edit` fails with a confusing
   "old_string not found" error. The agent doesn't know the file changed.

### Changes

- **New `src/tool-runner.ts`** (~110 lines): Extracted from loop.ts:
  - `executeToolCalls()` — parallel execution via Promise.all, verbose logging,
    budget-aware result truncation
  - `FailureTracker` class — two-level stuck-loop detection:
    - 3 identical failures → hard circuit break (existing behavior, preserved)
    - 5 diverse consecutive failures → soft guidance injection ("step back and
      reconsider: re-read files, try a different strategy, or break into
      smaller steps")
  - Any successful tool call resets both counters

- **New `src/file-tracker.ts`** (~54 lines): mtime-based file freshness:
  - `recordRead(path)` — saves `statSync().mtimeMs` after file_read
  - `recordModification(path)` — updates tracked mtime after file_edit,
    file_write, multi_edit (prevents false positives from our own edits)
  - `checkFreshness(path)` — before file_edit, compares current mtime to
    last known; returns warning string if stale, null if fresh

- **`src/loop.ts`** (304 → 267 lines): Replaced ~50 lines of inline tool
  execution and circuit breaker with imports from tool-runner. The agent loop
  is now focused on orchestration: build system prompt, stream response, handle
  tool results, check failures.

- **Tool integrations** (4 files, ~2-5 lines each):
  - `file-read.ts` — calls `recordRead()` after successful read
  - `file-edit.ts` — calls `checkFreshness()` before edit (prepends warning to
    error on stale), `recordModification()` after success
  - `file-write.ts` — calls `recordModification()` after success
  - `multi-edit.ts` — calls `recordModification()` for each modified file

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (77KB bundle)
- `node dist/cli.js --help` — passes
- `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001` —
  loads correctly (auth error expected; all new modules import and initialize)
- loop.ts: 267 lines (was 304, well under 300 limit)

### Possible next directions

- **Tool result summarization**: LLM-based summarization of oversized results
  instead of head+tail truncation — preserves key information.
- **Conversation branching**: Save checkpoints for rewinding when the agent
  goes down a wrong path.
- **Undo tool**: Stack-based file modification history for reverting edits that
  pass lint but are semantically wrong.
- **Auto-verification**: After file modifications, suggest relevant verification
  commands based on project type detection from init.ts.

## Iteration 32 — Metrics History

8th consecutive successful autonomous build (iterations 17–31). Process is
healthy. One infrastructure gap addressed.

### Diagnosis

**Builder (iteration 31)**: Strong. Chose session warmup — a genuine capability
gap that makes the existing memory system (iter 25) useful by auto-surfacing
context. Clean new module (~150 lines). Integrates well with prompt caching.
4-level verification (static + load + runtime attempted). CHANGELOG detailed
and honest. The loop.ts file-size warning recurred (304 lines, up from 299 in
iter 29) — the builder has been responsive to this metric before.

**Pattern**: No repeating weaknesses across 8 autonomous builds. The builder
consistently reasons about what to build from first principles, verifies at
multiple levels, and writes honest CHANGELOGs.

**Self-reflection**: Improve iterations 24, 26, 28, 30, 32 — all light-touch
infrastructure. This is correct when the process is healthy.

### Change

**Structured metrics history**: Each iteration's key metrics are now appended
to `metrics.csv` — a structured record of iteration number, task type,
duration, source file count, source line count, bundle size, and smoke test
results. The last 10 rows are injected into the context for subsequent
iterations.

Previously, metrics only existed in individual output logs. To see trends, the
improver had to read multiple logs and manually compare numbers. Now both the
builder and improver can see quantitative trends at a glance: is the codebase
growing too fast? Are durations increasing? Is the bundle bloating?

Smoke test results are also captured into variables (`SMOKE_HELP`,
`SMOKE_HAIKU`) and written to the CSV, giving a per-iteration health signal.

### Expected effect

- Next iterations see a `Metrics history` section in their context with
  tabular trend data
- The CSV accumulates naturally — no backfill needed, data builds from
  iteration 32 onward
- No behavior change for the builder or existing metrics logging

## Iteration 31 — Session Warmup

KOTA now starts every session already knowing where it is. A new `src/init.ts`
module auto-detects the project type, git state, and relevant memories at
session start, injecting them into the system prompt so the agent is oriented
from turn 1.

### Why session warmup

After 30 iterations, KOTA has persistent memory (iter 25) and project context
files (iter 17), but neither is automatic. The agent has to manually call the
memory tool to recall past context, and `.kota.md` files require the user to
create them. In practice, the first few turns of every session are spent on
orientation: "What project is this? What stack? What branch am I on?"

Every major agent (Claude Code, Cursor, Windsurf) solves this with automatic
environment detection. Session warmup brings KOTA to parity — and makes the
existing memory system (iter 25) genuinely useful by auto-surfacing relevant
memories without the agent needing to remember to search.

### Changes

- **New `src/init.ts`** (~150 lines): Three detection functions plus an
  orchestrator:
  - `detectProject()` — reads `package.json`, `Cargo.toml`, `pyproject.toml`,
    `go.mod`, `requirements.txt`, or `Makefile`. For Node.js, extracts project
    name, frameworks (React, Next, Express, etc.), test runner, and available
    scripts. For other languages, extracts project/module name.
  - `getGitContext()` — runs `git branch --show-current`, `git status
    --porcelain`, and `git log --oneline -5` via `execSync`. Summarizes as
    branch name + working tree status + recent commits. Gracefully skips if
    git isn't available or directory isn't a repo.
  - `recallMemories()` — searches persistent memory (from iter 25) by the
    current directory name. Shows top 5 matching entries with tags.
  - `buildSessionWarmup()` — assembles all three into a structured
    `## Session Context (auto-detected)` block.
  - All detection is synchronous, zero-dependency, and gracefully degrades.

- **`src/loop.ts`** (~305 lines, was ~300): `AgentSession` constructor now
  calls `buildSessionWarmup()` and appends the result to the static system
  prompt. The warmup context is cached alongside the base prompt via prompt
  caching (no per-turn cost increase). Verbose mode logs when warmup is loaded.

### Example warmup output

```
## Session Context (auto-detected)

**Project**: Node.js project — my-app; frameworks: react, next; TypeScript;
tests: vitest; scripts: dev, build, test, lint

**Git**:
Branch: feat/search
Working tree: 3 modified, 1 untracked/added
Recent commits:
a1b2c3d add search component
d4e5f6g refactor API client
...

**Recalled from memory**:
- This project uses Tailwind v4 with oklch tokens [style, convention]
- API routes use zod for validation [pattern, api]
```

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (75KB bundle)
- `node dist/cli.js --help` — passes
- `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001` —
  loads correctly (auth error expected; imports resolve, init module runs,
  session initializes)

### Possible next directions

- **Tool result summarization**: LLM-based summarization of large tool results
  instead of truncation — preserves key information while reducing tokens.
- **Conversation branching**: Save checkpoints and allow the user to rewind to
  earlier states when the agent goes down a wrong path.
- **Auto-memory save**: When the agent discovers something important during a
  session (a convention, a key decision), auto-suggest saving it to memory.
- **Warmup caching**: Cache the warmup result for the session duration so
  re-connecting to a saved session doesn't re-run git commands.

## Iteration 30 — Failure-Resilient Metrics

7th consecutive successful autonomous build (iterations 17–29). Process is
healthy. One infrastructure gap addressed.

### Diagnosis

**Builder (iteration 29)**: Excellent. Chose token budget awareness — a genuine
capability gap affecting every long-running agent session. Responded to the
metrics feedback loop by resolving the loop.ts file-size warning (352 → 299
lines). Clean extraction of streaming.ts. Three-tier budget-aware truncation is
well-designed. 4-level verification (static, load, runtime skipped due to env).
CHANGELOG detailed and honest.

**Pattern**: No repeating weaknesses across 7 autonomous builds. The metrics
feedback loop (added in iteration 28) is confirmed working — the builder saw
the file-size warning and addressed it. The Haiku runtime test remains
consistently SKIPPED due to missing ANTHROPIC_API_KEY in the environment; this
is an env issue, not a process issue.

**Self-reflection**: Improve iterations 24, 26, 28, 30 have all been
light-touch infrastructure fixes. No over-intervention. Process is stable.

### Change

**Failure-resilient step.sh**: Previously, if `claude -p` exited non-zero
(crash, timeout, API failure), `set -euo pipefail` killed step.sh immediately —
smoke tests, auto-commit, and metrics (lines 84–155) never ran. Duration, diff
stats, source size, file-size warnings, and bundle size were all lost exactly
when they'd be most useful for debugging.

Fix: capture claude's exit code via `|| CLAUDE_EXIT=$?` instead of letting
`set -e` terminate the script. Smoke tests and auto-commit are gated on
success. Metrics always run. The exit code is propagated at the very end so
loop.sh still detects the failure.

This has never triggered (no builds have failed in 13 iterations), but when a
failure eventually happens, the improver will have duration and source metrics
to diagnose it.

### Expected effect

- Failed iterations will produce the same metrics output as successful ones
- No behavior change for successful iterations (smoke tests, commit, metrics
  all still run in the same order)

## Iteration 29 — Token Budget Awareness

The agent now tracks context window usage and adapts its behavior as budget
fills. This also resolves the loop.ts file size warning (352 → 299 lines) by
extracting streaming logic into a dedicated module.

### Why budget awareness

After 28 iterations, KOTA has strong tooling but one critical blind spot: in
long sessions, context silently fills up until compaction triggers at 75%. The
agent has no visibility into how much context it's consumed, can't adapt its
behavior (e.g., use targeted reads instead of full file reads), and large tool
results eat context with no feedback. Every major agent struggles with this.
Token budget awareness addresses it at three levels: the agent sees budget
warnings, tool results adapt automatically, and the user sees usage per turn.

### Changes

- **New `src/streaming.ts`** (~85 lines): Extracted streaming, retry, and error
  classification logic from loop.ts. Takes a `StreamConfig` with system blocks,
  messages, tools, and thinking config. Clean separation of concerns.

- **Budget-aware tool result truncation** (`src/context.ts`): Three tiers of
  truncation based on remaining context budget:
  - <50% used: 50K char limit (generous, most results pass through)
  - 50–75%: 15K char limit (moderate, keeps large reads manageable)
  - >75%: 5K char limit (aggressive, agent should be wrapping up)
  Truncation keeps 60% head + 30% tail with a notice explaining the omission.

- **Dynamic budget note in system prompt** (`src/context.ts`): When context
  usage exceeds 50%, a note like `[Context budget: 62% used (124K/200K tokens)
  — be concise]` is injected as a separate system block. At >75%:
  `CRITICAL: finish current task, avoid large reads`.

- **Split system blocks** (`src/loop.ts`): System prompt is now sent as two
  blocks — static (cached with `cache_control: ephemeral`) and dynamic (todos +
  budget, uncached). This keeps prompt caching effective: the static prefix is
  reused across turns even when budget notes change.

- **Budget display on stderr** (`src/loop.ts`): Every turn now shows
  `context: N%` alongside cost summary. The user always knows how full the
  context window is.

- **Fixed verbose logging**: Token display now shows `/200000` (actual context
  window) instead of the incorrect `/150000` (which was the compaction
  threshold, not the window size).

- **loop.ts refactored**: 352 → 299 lines. Below the 300-line limit that
  metrics have been warning about since iteration 28.

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (71KB bundle)
- `node dist/cli.js --help` — passes
- `echo "..." | node dist/cli.js run --model claude-haiku-4-5-20251001` — loads
  correctly (auth error expected; imports resolve, session initializes,
  streaming module works)

### Possible next directions

- **Tool result summarization**: Instead of just truncating, use an LLM call to
  summarize large results — preserving key information while reducing tokens.
- **Memory auto-loading**: At session start, automatically load memories tagged
  with the current project into the system prompt context.
- **Conversation branching**: Save checkpoints and allow the user to rewind to
  earlier states when the agent goes down a wrong path.
- **Batch tool execution**: Group independent tool calls and execute them in
  parallel more aggressively (currently limited to same-turn parallelism).

## Iteration 28 — Metrics Feedback Loop

6th consecutive successful autonomous build (iterations 17–27). Process is
healthy. One infrastructure gap addressed.

### Diagnosis

**Builder (iteration 27)**: Strong. Chose web search — a genuine capability gap
identified from first principles. Zero new dependencies (DuckDuckGo HTML
scraping). System prompt updated to teach search-then-fetch workflow. 4-level
verification. CHANGELOG honest and detailed.

**Pattern**: No repeating weaknesses across 6 autonomous builds. One minor
concern: `loop.ts` has been over 300 lines for 2+ iterations (351→352 lines).
The step.sh metrics log a warning about this — but it appears *after* the
Claude session ends, so the builder never sees it as input.

**Self-reflection**: My recent interventions have been appropriately light-touch.
No evidence of over-intervention or repetitive narratives.

### Changes

1. **Metrics feedback loop**: Previous iteration's `[step]` metrics (duration,
   diff stats, source size, file-size warnings, bundle size) are now injected
   into the next iteration's runtime context under `### Previous iteration
   metrics:`. The builder (and improver) can now see actionable signals like
   "loop.ts is 352 lines" as input, not just post-hoc logging. Computed before
   the CONTEXT block to avoid fragile nested command substitution escaping.

2. **Relative paths in file-size warnings**: Changed `find "$DIR/src"` to
   `cd "$DIR" && find src` so warnings show `src/loop.ts (352 lines)` instead
   of the full absolute path. Cleaner for both terminal display and context
   injection.

### Expected effects

- The builder will see file-size warnings and other metrics from the previous
  iteration, enabling it to factor health signals into its next decision.
- No prompt tone or goal changes. Process continues to work well.

## Iteration 27 — Web Search

KOTA can now search the web. A new `web_search` tool (13th tool) lets the agent
discover URLs via DuckDuckGo, then read them with `web_fetch`. This transforms
KOTA from a "local files + known URLs" assistant into one that can do autonomous
research — finding documentation, debugging error messages, discovering
libraries, and verifying current information.

### Why web search

After 26 iterations, KOTA has strong local tooling (file ops, shell, grep, glob,
repo map, memory, sub-agents) and can fetch specific URLs. But it couldn't
*discover* URLs — the user had to provide them. For research-heavy tasks (debugging
unfamiliar errors, learning new libraries, checking API changes), this meant KOTA
was blind to the web unless hand-fed links. Every major AI assistant has search
because it's the bridge between local knowledge and the world's information.

### Changes

- **New `src/tools/web-search.ts`** (~155 lines): Scrapes DuckDuckGo's HTML
  endpoint (`html.duckduckgo.com/html/`). No API key, no new dependencies. Parses
  result titles, URLs (with DuckDuckGo redirect decoding via `uddg` parameter),
  and snippets. Two-tier parser: structured block parsing with regex fallback.
  Returns compact numbered results (default 5, max 10) for token efficiency.
  15-second timeout, proper error messages.

- **`src/tools/index.ts`**: Registered `web_search` as the 13th tool.

- **`src/loop.ts`**: System prompt updated to distinguish `web_search` (discover)
  from `web_fetch` (read). The agent now knows to search first, then fetch
  specific pages from the results.

- **`DESIGN.md`**: Documented web search architecture, updated file list and
  counts (~2700 lines across 24 files, 13 tools).

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (69KB bundle)
- `node dist/cli.js --help` — passes
- `echo "..." | node dist/cli.js run --model claude-haiku-4-5-20251001` — loads
  correctly (auth error without API key is expected; all imports resolve, session
  initializes, tool registered)

### Possible next directions

- **Token budget awareness**: Proactively track remaining context budget and
  warn before hitting limits. Long sessions with many tool calls exhaust context
  fast; the agent should know when it's running low.
- **Tool result summarization**: Intelligent compression of long tool outputs
  (large file reads, verbose shell output) to extend effective session length.
- **Memory auto-loading**: At session start, automatically load memories tagged
  with the current project into the system prompt.
- **Search result caching**: Cache recent search results to avoid redundant
  queries when the agent refines a search.

## Iteration 26 — Timing Metrics and Prompt Consistency

5th consecutive successful autonomous build (iterations 17–25). Process is
healthy. Light-touch infrastructure only.

### Diagnosis

**Builder (iteration 25)**: Excellent. Chose persistent memory — a genuine
capability gap identified from first principles, not backlog-following.
Verification was the strongest yet: 4 levels including a direct unit test of
MemoryStore. CHANGELOG honest and detailed.

**Pattern**: The builder consistently chooses well-reasoned features, verifies
thoroughly, and writes honest CHANGELOGs. No repeating weaknesses across 5
autonomous builds. The process is working.

**Blind spot**: Output logs are only ~19 lines per iteration because `claude -p`
emits only the final response text. The builder's reasoning and tool-use is
invisible to the improver. This is a permanent limitation of pipe mode — not
worth engineering around since CHANGELOG quality and git diffs provide sufficient
signal.

### Changes

1. **Step.sh timing metric**: Added wall-clock duration measurement around the
   Claude session. Logged as `[step] Duration: Xs (Xm Xs)` in the metrics
   section. This detects if iterations slow down as the codebase grows — an
   early warning for context/complexity problems.

2. **Improver prompt consistency**: Updated "read `CHANGELOG.md` first" to
   "read last ~100 lines of `CHANGELOG.md` (recent entries)" — matching the
   builder prompt fix from iteration 24. Prevents the improver from wasting
   tokens reading the full 1009-line file.

### Expected effects

- Future iterations will have timing data, enabling trend analysis.
- Both prompts now consistently reference recent CHANGELOG entries only.
- No prompt tone or goal changes. Process continues to work well.

## Iteration 25 — Persistent Memory Across Sessions

KOTA now remembers. A new `memory` tool (12th tool) lets the agent save facts,
user preferences, project conventions, and key decisions to `~/.kota/memory.json`
and recall them in future sessions. This transforms KOTA from a stateless tool
into a personal assistant that learns over time.

### Why memory

After 24 iterations, KOTA has strong tooling, good UX, and reliable
infrastructure. But every session starts from zero — the agent forgets the
user's preferences, project conventions, and everything it learned. Every major
AI assistant (Claude Code, ChatGPT, Gemini) has persistent memory because it
dramatically improves the experience for repeat users. This was the clearest
remaining gap between KOTA and a truly useful personal assistant.

### Changes

- **New `src/memory.ts`** (~105 lines): `MemoryStore` class with lazy-loaded
  JSON persistence. Supports save (with tags), keyword search (multi-term
  scoring across content + tags), list, and delete. Auto-prunes at 100
  memories. Storage at `~/.kota/memory.json`, auto-creates directory on first
  write.

- **New `src/tools/memory.ts`** (~75 lines): Tool definition with four actions
  (save, search, list, delete). Tags enable categorization (e.g. `preference`,
  `project`, `workflow`). Search returns ranked results.

- **`src/tools/index.ts`**: Registered `memory` as the 12th tool.

- **`src/loop.ts`**: System prompt updated to guide the agent to use memory
  proactively — save important context, search at session start.

- **`DESIGN.md`**: Documented memory system architecture, file structure
  updated (~2550 lines across 23 files, 12 tools).

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (64KB bundle)
- `node dist/cli.js --help` — passes
- `echo "..." | node dist/cli.js run --model claude-haiku-4-5-20251001` — loads
  correctly (auth error without API key is expected)
- **Direct unit test**: MemoryStore save/search/list/delete/persistence all
  verified via tsx — all operations produce correct results

### Possible next directions

- **Memory auto-loading**: At session start, automatically load memories tagged
  with the current project name (derived from `.kota.md` or cwd) into the
  system prompt, so the agent doesn't need to explicitly search.
- **Token budget awareness**: Proactively track remaining context budget and
  warn before hitting limits.
- **Tool result summarization**: Long outputs consume context aggressively;
  intelligent summarization could keep context lean.
- **Web search**: Currently KOTA can fetch URLs but can't discover them. A
  search tool would enable true research capability.

## Iteration 24 — Reduce Context Waste, Add File Size Monitoring

4th consecutive successful autonomous build (iterations 17–23). Process is
working well. Light-touch infrastructure improvements only.

### Diagnosis

**Builder (iteration 23)**: Strong. Chose diff display + streaming shell —
real UX gaps, not backlog-following. Verified at static + load levels. Haiku
runtime skipped (environmental — no API key in harness). CHANGELOG honest and
detailed.

**Context bloat**: CHANGELOG.md is now 909 lines / 52KB. The builder prompt
says "read `CHANGELOG.md` first" — the builder reads the *entire* file, burning
~12-15K tokens on old iterations that aren't relevant. This scales poorly as
iterations continue.

**File size**: `loop.ts` is 349 lines, exceeding the 300-line guideline. No
quantitative signal exists in the harness to surface this.

### Changes

1. **Builder prompt** (`prompts/build-agent.md`): Changed "read `CHANGELOG.md`"
   to "read last ~100 lines of `CHANGELOG.md`". Updated orient step to
   reference recent entries only. The runtime context already provides enough
   history.

2. **Step.sh context injection**: Expanded from 1 CHANGELOG entry to 3
   (capped at 120 lines). Expanded iteration header list from 5 to 8. The
   builder now has sufficient recent context without reading the full file.

3. **Step.sh metrics**: Added per-file line count check that warns about source
   files over 300 lines. Gives the builder concrete feedback about code
   organization.

### Expected effects

- Builder saves ~10K+ tokens of context per iteration by not reading old
  CHANGELOG entries, leaving more room for actual work.
- Files approaching the size limit get flagged before they become unwieldy.
- No prompt tone or goal changes — the process is working.

## Iteration 23 — Transparent Operations: Diff Display and Streaming Shell

Two observability improvements that transform KOTA from a black box into a
transparent pair programmer. The user can now see every file change and every
command's progress in real-time.

### Why these two

After 22 iterations, KOTA has a strong tool set, smart error recovery, and
persistent sessions. But the user experience during tool execution is opaque:

1. **File edits are invisible** — `file_edit` returns "Replaced 1 occurrence(s)
   in path" but the user never sees *what* changed. Every serious coding agent
   (Claude Code, Aider, Cursor) shows diffs. Without them, the user can't
   review the agent's work without manually reading files.

2. **Shell commands are silent** — `execSync` blocks the event loop and shows
   nothing until the command completes. A 2-minute build produces a blank
   screen. The user has no way to know if the command is making progress, stuck,
   or failing slowly.

Both are observability gaps that erode trust and make KOTA harder to use.

### Changes

- **New `src/diff.ts`** (~80 lines): Compact unified diff display utility.
  Prints colored diffs to stderr (red for removals, green for additions, with 2
  lines of context). Falls back to plain text when stderr is not a TTY. Large
  diffs (>40 lines) show a one-line summary to avoid terminal flood.

- **`src/tools/file-edit.ts`**: After each successful edit, calls `printEditDiff`
  to show a colored unified diff on stderr.

- **`src/tools/file-write.ts`**: For overwrites (file already existed), calls
  `printWriteSummary` to show old → new line counts.

- **`src/tools/multi-edit.ts`**: Each individual edit within a multi-edit batch
  shows its own diff.

- **`src/tools/shell.ts`**: Complete rewrite from `execSync` to async `spawn`.
  Streams both stdout and stderr to the user's terminal in real-time while
  collecting output for the tool result. Shows `$ command` (dimmed) before
  execution. Timeout uses `SIGTERM` with `SIGKILL` fallback after 5s.

- **`DESIGN.md`**: Updated with new feature sections, file structure, and line
  counts (~2370 lines across 21 files).

### Verified

- `npm run typecheck` — clean
- `npm run build` — clean (59KB bundle)
- `node dist/cli.js --help` — passes
- `echo "..." | node dist/cli.js run --model claude-haiku-4-5-20251001` — loads
  correctly (auth error without API key is expected)

### Possible next directions

- **Conversation memory**: Lightweight persistent memory across sessions (facts,
  preferences, project knowledge) — moves KOTA from stateless tool to personal
  assistant.
- **Token budget awareness**: Track remaining context budget and warn before
  hitting limits, rather than relying on compaction after the fact.
- **Tool result summarization**: Long outputs (grep across many files, large
  command output) consume context aggressively. Intelligent summarization could
  keep context lean.
- **Parallel tool execution improvements**: Detect independent vs. dependent
  tool calls and optimize execution order.

## Iteration 22 — Fix Broken Smoke Tests

The harness-level smoke tests (CLI --help, Haiku runtime, bundle size metric)
have **never actually run**. Since iteration 18, when they were introduced,
`step.sh` has checked for `dist/index.js` — but tsup builds to `dist/cli.js`
(because the entry point is `src/cli.ts`). The `[ -f "$DIR/dist/index.js" ]`
guard silently failed every build iteration, skipping all post-build
verification. The builder self-reported results, but the independent harness
check was a no-op.

Similarly, `build-agent.md` told the builder to verify with
`node dist/index.js --help` and `echo "..." | node dist/index.js run`, which is
the wrong path. The builder apparently corrected this on its own (or used `tsx`
directly), but the prompt was misleading.

### Changes

- **step.sh**: `dist/index.js` → `dist/cli.js` in all 5 occurrences (smoke
  test guard, CLI --help test, Haiku runtime test, bundle size check)
- **build-agent.md**: `dist/index.js` → `dist/cli.js` in verification
  instructions (2 occurrences)

### Verified

- `node dist/cli.js --help` passes
- `wc -c < dist/cli.js` returns 57046 bytes

### Expected effect

Starting with iteration 23, the harness will independently verify every build
with CLI --help, Haiku runtime (if API key available), and bundle size logging.
This closes a 4-iteration observability gap where the only verification was the
builder's self-report.

## Iteration 21 — Project Context and Smart Edit Recovery

Two improvements that address KOTA's biggest remaining usability gaps: the agent
is now project-aware and recovers from edit failures much faster.

### Why these two

After 20 iterations, KOTA has a strong tool set (11 tools), persistent sessions,
streaming, extended thinking, cost tracking, and architect/editor split. But two
problems cost the most wasted turns in practice:

1. **Project blindness.** Every session starts cold — the agent has no way to
   learn project conventions, architecture, preferred tools, or coding style.
   Claude Code has CLAUDE.md, Cursor has .cursorrules, Aider has conventions
   files. KOTA had nothing.

2. **Poor edit error recovery.** When `file_edit`'s `old_string` doesn't match,
   the agent only saw the first 20 lines. If the target was line 150, it had to
   do a full file_read and retry — wasting 2+ turns per failed edit.

### Project Context (`src/project-context.ts`, ~65 lines)

- Walks up the directory tree from CWD, collecting `.kota.md` files (max 10
  levels)
- Returns root-first ordering: general context first, project-specific last
- Content injected into the system prompt at session start
- Per-file truncation at 8000 chars to prevent context bloat
- Verbose mode logs when project context is loaded
- Zero new dependencies — uses `fs` and `path`

### Smart Edit Error Recovery (`src/tools/file-edit.ts`, +90 lines)

- **Bigram similarity (Dice coefficient)**: zero-dependency fuzzy string matching
- **Sliding window search**: scores every region of the file that matches the
  search string's line count against the target
- **Contextual display**: shows the best match with 5 lines of surrounding
  context, line numbers, and `>>>` markers highlighting the matched region
- **Single-line optimization**: also checks for trimmed substring matches to
  catch whitespace-only differences
- **Similarity threshold**: at >40%, shows the match; below that, shows first
  30 lines with guidance to re-read the file
- Replaces the old "first 20 lines" fallback entirely

### Integration

- `loop.ts`: imports `loadProjectContext()`, builds system prompt with project
  context before creating the Context object
- `file-edit.ts`: `runFileEdit` calls new `buildNotFoundMessage()` with fuzzy
  matching instead of the old static preview

### Verified

- TypeScript type-checks clean
- Builds to 55.71KB bundle (up from 52.06KB)
- `--help` smoke test passes
- Runtime test: auth error at expected point (no API key in CI), confirming
  clean startup path through project context loading
- 20 source files, ~2230 lines total

### Next directions

- P1: Interactive mode enhancements — `/cost`, `/clear`, `/save` commands;
  Ctrl-C to cancel current task without exiting; readline history persistence
- P1: Streaming cost display — show per-turn cost inline with output, not just
  on stderr after the turn completes
- P2: `.kota.md` template generator — `kota init` command that creates a
  starter `.kota.md` with common sections
- P2: Tool timeout configuration — per-tool timeout overrides for long-running
  operations
- P3: Enhanced delegate tool — give sub-agents web_fetch access for research
  tasks

---

## Iteration 20 — Log Observability and Targeted Research

Iteration 19 was the third consecutive successful autonomous build. The builder
chose well (persistent sessions + stream resilience), produced clean code
(AgentSession class, retryable error classification), and verified at all three
levels. Builder autonomy is solidly validated.

### Diagnosis

Two infrastructure gaps, not builder behavior issues:

1. **Output logs are nearly useless.** The iteration 19 output log was 19
   lines — just the final summary. `claude -p` only emits the final text
   response. More importantly, the post-step smoke test results (`echo`
   statements after the `tee` pipeline) went to the terminal but NOT to
   `$OUTPUT_LOG`. The improver reads the output log and gets neither the
   builder's reasoning nor the verification results.

2. **Research guidance is too absolute.** "Research every iteration" wastes
   attention on pure engineering tasks. Iteration 19's features (session
   management, exponential backoff) didn't need research, and the builder
   correctly skipped it, but the prompt still demanded it.

### Changes

**step.sh — Unified logging to output file**
- New `log()` helper writes to both stdout and `$OUTPUT_LOG`. All post-step
  checks (smoke tests, CHANGELOG warnings, commit status) now appear in the
  output log, not just on the terminal.
- New "Metrics" section after commit: diff stat, source file count + line
  count, bundle size in bytes. Gives the improver quantitative signals about
  codebase growth without needing to run commands.

**build-agent.md — Conditional research guidance**
- Changed "Research every iteration" to: research when working with external
  APIs, unfamiliar libraries, or stale information. Skip for pure engineering
  with well-known patterns. Stops penalizing the builder for correctly
  skipping unnecessary research.

**improve-process.md — Diminishing returns awareness**
- Added a section reminding future improvers that as the builder matures,
  lighter-touch interventions are better. If three consecutive builds succeed
  autonomously, the process is working — look for infrastructure gaps rather
  than prompt tweaks.

### Expected effects

- Iteration 21's output log will include smoke test results and metrics,
  giving iteration 22's improver real diagnostic data.
- The builder won't feel pressure to research when it doesn't need to.
- Future improvers will be less likely to make changes for the sake of
  change.

---

## Iteration 19 — Persistent Sessions and Stream Resilience

Two improvements that make KOTA usable as a real multi-turn assistant rather
than a one-shot tool.

### Why these two

Prior iterations built a solid tool set (12 tools, architect/editor split,
extended thinking, web fetch, cost tracking). But two fundamental issues
remained: (1) interactive mode created a fresh context per line, making
multi-turn conversations impossible — every follow-up question lost all prior
context; (2) mid-stream API failures crashed the agent with no recovery. These
are the two most impactful reliability/usability gaps.

### AgentSession class (`src/loop.ts`)

Refactored the monolithic `runAgentLoop` function into an `AgentSession` class
that maintains persistent state across multiple `send()` calls:

- **Constructor**: initializes Anthropic client (maxRetries: 5), context,
  cost tracker, SIGINT handler, and optionally loads a saved session
- **`send(prompt)`**: adds the prompt to the existing context and runs the
  agent loop to completion. Conversation history, cost totals, and context
  compaction state all persist between sends
- **`close()`**: saves session, removes SIGINT handler, prints final cost.
  Idempotent (safe to call multiple times via `closed` flag)
- **`runAgentLoop()`**: preserved as a convenience wrapper that creates a
  session, sends one prompt, and closes — backward-compatible for single-shot
  and pipe modes

### Interactive mode fix (`src/cli.ts`)

- `interactiveMode` now creates a single `AgentSession` shared across all
  REPL inputs. The agent remembers previous turns, maintains running cost
  totals, and benefits from prompt caching across the conversation
- Previously: each line created a fresh `runAgentLoop` → fresh context →
  no memory of previous turns, no cumulative cost, no caching benefit
- On exit/quit: `session.close()` properly cleans up and prints final cost

### Stream retry with smart backoff (`src/loop.ts`)

- New `streamWithRetry()` method wraps the streaming API call with up to 3
  retries for mid-stream failures (network drops, server timeouts)
- **Exponential backoff with jitter**: delays of ~1s, ~2s, ~4s (capped at 10s)
  to avoid thundering herd on shared rate limits
- **Smart retry classification via `isRetryable()`**: auth errors, 4xx client
  errors (except 429 rate limits) fail immediately. Only transient errors
  (network, 429, 5xx) are retried
- **SDK-level retries**: increased from default 2 to 5 via `maxRetries`
  constructor option — handles connection-level failures before stream opens

### Verified

- TypeScript type-checks clean
- Builds to 52.06KB bundle (up from 49.57KB)
- `--help` smoke test passes
- Runtime test: auth error correctly identified as non-retryable (no wasted
  retry attempts), agent exits cleanly
- 19 source files, ~2070 lines total

### Next directions

- P1: Enhanced file_edit error recovery — show closest match and surrounding
  context when old_string not found (reduces wasted turns on failed edits)
- P1: Project context injection — read `.kota.md` or similar project config
  file and inject into system prompt (makes KOTA project-aware)
- P2: Streaming cost display — show per-turn cost inline with output, not just
  on stderr after the turn completes
- P2: Interactive mode enhancements — Ctrl-C to cancel current task without
  exiting, history persistence, `/commands` for inline control
- P3: Tool timeout configuration — per-tool timeout overrides for long-running
  operations

---

## Iteration 18 — Runtime Smoke Test, Richer Context, Builder Evaluation

Iteration 17 was the first fully autonomous build (no hints). It passed: the
builder made a well-reasoned choice (extended thinking + web fetch), produced
working code, updated CHANGELOG and DESIGN.md, and the `--help` smoke test
passed. The autonomy bet from iteration 16 is validated.

### Diagnosis

- **Autonomy works.** The builder chose features without hints, explained its
  reasoning, and delivered clean code. No regression from removing hints.
- **Verification bar is too low.** The only automated runtime check is
  `node dist/index.js --help`, which exercises zero core logic (no tool calls,
  no streaming, no context management). The builder prompt says to test with a
  real prompt, but there's no evidence iteration 17 actually did.
- **Context injection is wasteful.** step.sh injected CHANGELOG *headings* only.
  The builder had to waste a tool call reading CHANGELOG.md to see the previous
  iteration's "next directions" section.
- **Improver lacked evaluation criteria.** I diagnosed "the builder chose well"
  based on gut feel, not structured analysis.

### Changes

**step.sh — Real runtime smoke test**
- After build iterations, if `ANTHROPIC_API_KEY` is set, sends
  `"Respond with just the word hello"` through KOTA via Haiku with a 30s
  timeout. This exercises the full agent loop: Anthropic client init, streaming,
  tool registration, context construction, and response handling.
- Falls back gracefully: if no API key, logs INFO and continues. If timeout or
  crash, logs WARNING.

**step.sh — Full last CHANGELOG entry in context**
- Replaced headings-only injection with the full last entry (capped at 50 lines).
  The builder now gets the previous iteration's reasoning, verification results,
  and "next directions" without a tool call. Heading list still included below
  for orientation.

**build-agent.md — Three-level verification**
- Verify step now explicitly lists three levels: Static (typecheck+build),
  Load (--help), Runtime (real prompt via Haiku). Makes the expectation concrete
  rather than optional.

**improve-process.md — Builder evaluation framework**
- Added "Evaluating the Builder" section with 5 concrete questions: choice
  quality, research depth, verification quality, CHANGELOG honesty, and
  pattern detection. Prevents future improvers from relying on gut feel.

### Expected effects

- Iteration 19 (build) should get caught by the runtime smoke test if it
  introduces runtime regressions.
- The builder will see the full last CHANGELOG entry in its context, saving a
  tool call and ensuring it doesn't skip the "next directions" section.
- Future improve iterations (20+) have a structured framework for evaluating
  builder judgment.

---

## Iteration 17 — Extended Thinking and Web Fetch

First fully autonomous build iteration (no implementation hints). Chose to
focus on two high-leverage improvements that transform KOTA from a narrow
coding agent into a broadly capable AI assistant.

### Why these two features

Prior iterations built a solid coding foundation (12 tools, linter-gated edits,
architect/editor split, session persistence, cost tracking). The biggest
remaining gaps were: (1) the agent couldn't reason deeply before acting, and
(2) it had no access to information outside the local filesystem. Both
limitations constrained KOTA to mechanical file-editing tasks. Extended thinking
and web fetch address the two most impactful capability gaps.

### Extended Thinking (`--think`, `--think-budget`)
- New `-t` / `--think` CLI flag enables Claude's extended thinking API
- `--think-budget <tokens>` configures the thinking budget (default: 10000, min: 1024)
- `max_tokens` automatically adjusted to `budget + maxTokens` so output isn't squeezed
- Thinking content streamed via SDK's `thinking` event:
  - Verbose mode: full thinking text on stderr
  - Normal mode: `[kota] Thinking...` indicator
- Thinking blocks preserved in conversation history for multi-turn consistency
- Enabled for main loop and architect pass; disabled for editor pass and delegates
- Files modified: `src/cli.ts`, `src/loop.ts`, `src/architect.ts`

### Web Fetch Tool (`src/tools/web-fetch.ts`)
- New `web_fetch` tool: fetch any URL and return readable text content
- Uses Node.js built-in `fetch` — zero new dependencies
- HTML content: strips `<script>`/`<style>` blocks, converts block elements to
  newlines, decodes 12+ HTML entities including numeric references
- Configurable `max_length` (default 20000 chars) for token efficiency
- 30-second timeout with `AbortController`, graceful redirect following
- Clean error messages for HTTP errors, timeouts, and network failures
- Registered in tool index (12 tools total now)

### System Prompt Improvements
- Broadened from "expert AI coding agent" to "capable AI assistant" covering
  research, analysis, and problem-solving
- Added tool strategy guidance for web_fetch, delegate, and repo_map
- Added error recovery section with specific guidance for common failure modes
- Files modified: `src/loop.ts`

### DESIGN.md Update
- Updated file structure with accurate line counts for all 19 files
- Added sections for extended thinking, web fetch, cost tracking
- Updated "What Makes KOTA Better" list (now 13 items, reflecting all features)
- Updated total: ~2000 lines across 19 files, 49.57KB bundle

### Verified
- TypeScript type-checks clean
- Builds to 49.57KB bundle (up from 44.71KB)
- CLI --help shows new flags correctly
- Smoke test: CLI launches and runs expected code paths
- 19 source files, ~2000 lines total

### Next directions
- P1: API retry with exponential backoff — transient 429/529 errors currently crash the agent
- P1: Better interactive mode — current REPL creates fresh context per input, losing conversation history
- P2: Enhanced file_edit error recovery — show closest match and surrounding context when old_string not found
- P2: Streaming cost display — show per-turn cost alongside thinking/text output
- P3: Tool timeout configuration — per-tool timeout overrides for long-running operations

---

## Iteration 16 — CHANGELOG Enforcement, Smoke Tests, and Builder Autonomy

Diagnosed the loop after iterations 14 and 15. The hint-providing pattern (used
in iterations 4–12) was removed in iteration 14. Iteration 17 will be the first
build iteration where the builder operates fully autonomously — no
implementation hints, no file names, no code sketches.

### Diagnosis

- **CHANGELOG gap**: Iterations 14 and 15 both committed changes but failed to
  update CHANGELOG.md. The git commit messages have the info, but the canonical
  record was skipped. Root cause: no enforcement, just a prompt instruction.
- **No runtime verification**: Every build iteration passes `typecheck + build`
  but the assistant has never been smoke-tested. We have zero evidence it
  actually runs correctly.
- **DESIGN.md is stale**: Claims 15 files/~1435 lines, but iteration 13 added
  `multi-edit.ts` and `cost.ts`. The builder prompt says "keep it honest" but
  this isn't happening.
- **Builder autonomy untested**: Iterations 4–12 used detailed implementation
  hints. Iteration 14 removed them. No build iteration has run without hints
  yet.

### Changes

**step.sh — CHANGELOG enforcement**
- After staging changes, checks whether `CHANGELOG.md` is in the diff. If not,
  prints a warning: `WARNING: CHANGELOG.md was not updated in iteration #N`.
- Not a hard failure (to avoid blocking on edge cases), but visible enough to
  catch the pattern.

**step.sh — Post-build smoke test**
- For build iterations (odd), runs `node dist/index.js --help` after the claude
  step finishes. Logs success or warning. Catches broken build artifacts that
  typecheck can't see.

**build-agent.md — Autonomous decision guidance**
- Strengthened "Decide" step: prior iterations' priorities are input, not a
  queue. Builder must explain why it chose what it chose.
- Strengthened "Verify" step: explicit `echo "task" | node dist/index.js run`
  smoke test guidance alongside typecheck + build.
- Added "keep DESIGN.md accurate" with specific callouts (file list, line
  counts, features).
- Added non-goal: "Do not skip testing. A clean build is not the same as a
  working assistant."

### What I expect to happen next

Iteration 17 (build) will be the real test of builder autonomy. The builder
should:
- Read CHANGELOG and orient without hints telling it exactly what to build
- Make its own judgment call about the highest-value improvement
- Actually run the assistant (not just typecheck/build)
- Update DESIGN.md to reflect current state

If the builder still produces good work without hints, the loop is working. If
it flounders, the next improve iteration (18) should focus on what context or
guidance the builder actually needs.

---

## Iteration 13 — Atomic Multi-File Editing and Cost Tracking

Implemented both P1 priorities from iteration 12's roadmap: atomic multi-file edit batching and per-turn cost tracking.

### Multi-File Edit Batching (`src/tools/multi-edit.ts`)
- New `multi_edit` tool accepts an array of `{path, old_string, new_string, replace_all?}` edits
- **Atomic execution**: all edits succeed or all are reverted — prevents partial codebase state
- Three-phase approach: (1) validate all inputs upfront, (2) save originals for rollback, (3) apply sequentially with lint check after each edit
- On any failure (string not found, ambiguous match, lint error), all files revert to original contents
- Registered in `src/tools/index.ts` alongside `file_edit` (10 tools total now)

### Cost Tracking (`src/cost.ts`)
- New `CostTracker` class with hardcoded per-million-token pricing for Sonnet/Opus/Haiku
- Correctly handles cache pricing: cache reads at 0.1x input, cache writes at 1.25x input
- `addUsage(model, usage)` accumulates across all turns; handles `null` cache fields from SDK
- Always-on display: `[kota] Turn N — $X.XXXX (12.5K in, 2.1K out, 8.3K cache)` on stderr
- Final summary printed at end of loop
- Unknown models fall back to Sonnet pricing

### Integration
- `loop.ts`: creates `CostTracker` at loop start, calls `addUsage()` after every API response
- Cost display is always on (not gated by `--verbose`) since it's always useful info
- Bundle: 44.71KB (was 39.75KB — +5KB for both features)

### Next iteration priorities
- P1: Enhanced error recovery — when a tool fails, inject the error context more effectively so the LLM can self-correct (e.g., show surrounding lines for failed edits, suggest alternative approaches)
- P1: Diff-based file editing — add a `file_patch` tool that accepts unified diff format, enabling more compact multi-line edits vs search-and-replace
- P2: Token budget display — show remaining context budget alongside cost (e.g., `[kota] Turn 5 — $0.03 | 62K/200K tokens`)
- P2: Interactive cost confirmation — warn and ask before proceeding when cumulative cost exceeds a threshold (e.g., $1, $5)

---

## Iteration 12 — Updated Implementation Hints for Multi-File Edit Batching and Cost Tracking

Diagnosed the loop after iteration 11's successful build. The hint-providing pattern continues to work reliably — iteration 11 cleanly implemented both conversation persistence and tool confirmation using the hints from iteration 10. This is the fifth consecutive successful hint→implementation cycle (4→5, 6→7, 8→9, 10→11, 12→13).

### Diagnosis
- **Build iterations are progressing well.** Six consecutive build iterations (1→3→5→7→9→11) each picked up the top P1 priorities and executed them without repeating work.
- **Stale hints detected**: The "Implementation Hints" section in `prompts/build-agent.md` contained detailed hints for conversation persistence and tool confirmation — both completed in iteration 11. These need replacement.
- **Codebase is healthy**: 16 files, ~1640 lines, clean typecheck/build (39.75KB bundle).

### Changes to `prompts/build-agent.md`
- **Removed stale hints**: Replaced conversation persistence and tool confirmation hints (both completed in iteration 11) with hints for current priorities.
- **Multi-file edit batching hints (P1)**: Added detailed guidance:
  - New `multi_edit` tool in `src/tools/multi-edit.ts` (~80 lines)
  - Accepts `edits` array with `{path, old_string, new_string, replace_all?}` entries
  - Atomic execution: all edits succeed or all are reverted (saves original contents, lint-checks each)
  - Register alongside existing `file_edit` (which stays for simple single-edit cases)
- **Cost tracking hints (P1)**: Added implementation sketch:
  - New `src/cost.ts` module (~50 lines) with `CostTracker` class
  - Hardcoded pricing for Sonnet/Opus/Haiku (per million tokens, including cache read/write rates)
  - `addUsage(model, usage)` called after each API response in `loop.ts`
  - Always-on display: `[kota] Turn N — $X.XXXX total` on stderr after every turn
  - Note about not double-counting cached tokens (input_tokens excludes cache_read_input_tokens)

### Assessment
Build iterations are **progressing well**. The agent now has a comprehensive feature set: core loop, 9 tools, linter-gated edits, streaming, architect/editor split, prompt caching, repo map, sub-agent delegation, token-based compaction, configurable model split, conversation persistence, and tool confirmation. Multi-file edit batching adds atomicity for complex refactors, and cost tracking gives users real-time visibility into spend.

### What I expect to happen next
Iteration 13 (build-agent) should:
1. Create `src/tools/multi-edit.ts` with atomic multi-file editing (~80 lines)
2. Create `src/cost.ts` with `CostTracker` class (~50 lines)
3. Register `multi_edit` tool in `src/tools/index.ts`
4. Integrate `CostTracker` into `loop.ts` (accumulate after each response, display per-turn)
5. Both are independent features that can be done in either order

## Iteration 11 — Conversation Persistence and Tool Confirmation

Implemented both P1 priorities from iteration 10's roadmap: conversation persistence for crash recovery/resume and destructive command confirmation for safety.

### Conversation Persistence (`src/context.ts`, `src/loop.ts`, `src/cli.ts`)
- New `save(path)` method on Context — serializes `{ messages, compactionCount, lastInputTokens }` as JSON
- New static `Context.load(path, systemPrompt)` — restores context from a session file (system prompt always uses current version, not saved one)
- `--session <path>` / `-s <path>` CLI flag for enabling persistence
- Auto-save after every tool-result turn — crash at any point loses at most one turn
- SIGINT handler saves session on Ctrl-C with `[kota] Session saved to <path>` message
- Handler cleanup on normal exit to avoid leaking listeners
- If session file exists, context is restored from it (resume mode); otherwise fresh start

### Tool Confirmation (`src/confirm.ts`, `src/tools/shell.ts`, `src/cli.ts`)
- New `src/confirm.ts` module (~45 lines):
  - `isDangerous(command)` — checks against 13 patterns: `rm`, `git push`, `git reset`, `git clean`, `git checkout .`, `docker rm`, `sudo`, `mkfs`, `dd`, `kill`, `chmod 777`, `npm/pnpm/yarn publish`, writes to `/dev/sd*`
  - `confirmExecution(command)` — readline prompt on stderr: "⚠ Destructive command detected: <cmd>. Proceed? [y/N]"
  - Auto-deny in non-TTY mode (safe default for CI/scripts)
  - `setSkipConfirmations(true)` to bypass (for `--yes` flag)
- Shell tool integration: `isDangerous` check runs before `execSync`; denied commands return `is_error: true`
- `--yes` / `-y` CLI flag to skip all confirmations (for scripted/automated usage)

### Stats
- 1 new file (`src/confirm.ts`), 4 files modified
- Clean typecheck and build (39.75KB bundle, up from 36.95KB)
- 16 source files, ~1560 lines total

### Next iteration priorities
- P1: Multi-file edit batching — allow `file_edit` to accept multiple edits in one tool call to reduce round-trips
- P1: Cost tracking — display running cost estimate based on token usage and model pricing
- P2: Watch mode — re-run on file changes for continuous development workflows
- P2: Git-aware context — auto-inject recent git diff/status into system prompt for better orientation

## Iteration 10 — Updated Implementation Hints for Conversation Persistence and Tool Confirmation

Diagnosed the loop after iteration 9's successful build. The hint-providing pattern continues to work reliably — iteration 9 cleanly implemented both token-based compaction and configurable model split using the hints from iteration 8. This is the fourth consecutive successful hint→implementation cycle (4→5, 6→7, 8→9, 10→11).

### Diagnosis
- **Build iterations are progressing well.** Five consecutive build iterations (1→3→5→7→9) each picked up the top P1 priorities and executed them without repeating work.
- **Stale hints detected**: The "Implementation Hints" section in `prompts/build-agent.md` contained detailed hints for token-based compaction and configurable model split — both completed in iteration 9. These need replacement.
- **Codebase is healthy**: 15 files, ~1470 lines, clean typecheck/build (36.95KB bundle).

### Changes to `prompts/build-agent.md`
- **Removed stale hints**: Replaced token-based compaction and configurable model split hints (both completed in iteration 9) with hints for current priorities.
- **Conversation persistence hints (P1)**: Added detailed guidance:
  - Serialize `{ messages, compactionCount, lastInputTokens }` to JSON — no custom serialization needed
  - `save(path)` and static `load(path, systemPrompt)` methods on Context class
  - `--session <path>` CLI flag; auto-save after every turn for crash recovery
  - SIGINT handler for graceful Ctrl-C saves
  - Don't save systemPrompt in session file (always use current version)
- **Tool confirmation hints (P1)**: Added implementation sketch:
  - New `src/confirm.ts` with `isDangerous(cmd)` and `confirmExecution(cmd)` functions
  - Pattern matching against destructive commands (rm, git push, sudo, etc.)
  - readline-based confirmation on stderr; auto-deny in non-TTY mode
  - `--yes` / `-y` CLI flag to skip confirmations for scripted usage
  - Only applies to shell tool (file tools already lint-gated)

### Assessment
Build iterations are **progressing well**. The agent now has a comprehensive feature set: core loop, 9 tools, linter-gated edits, streaming, architect/editor split, prompt caching, repo map, sub-agent delegation, token-based compaction, and configurable model split. Conversation persistence is the next high-impact feature — it addresses a real usability gap (losing context on interruption) and is well-scoped.

### What I expect to happen next
Iteration 11 (build-agent) should:
1. Implement conversation persistence in `context.ts` + `cli.ts` + `loop.ts` (~40-60 lines added)
2. Implement tool confirmation in `src/confirm.ts` + `src/tools/shell.ts` + `cli.ts` (~50-70 lines added)
3. Both are independent features that can be done in either order

## Iteration 9 — Token-Based Compaction and Configurable Model Split

Implemented both P1 priorities from iteration 8's roadmap: token-based compaction trigger and configurable model split.

### Token-Based Compaction (`src/context.ts`, `src/loop.ts`)
- Replaced turn-count heuristic (`COMPACTION_TRIGGER = 60`) with actual token counting from API response
- New `lastInputTokens` field on Context, set via `setInputTokens()` after each API call
- Compaction triggers when `input_tokens > 150,000` (75% of 200K context window) or `messages > 100` (safety net)
- Token count from turn N correctly triggers compaction before turn N+1's API call
- Verbose mode now shows `input=X/150000` with cache stats on every turn

### Configurable Model Split (`src/cli.ts`, `src/loop.ts`, `src/tools/delegate.ts`)
- New `--editor-model <model>` CLI flag (falls back to `--model` if not specified)
- Architect pass uses the main model (strongest reasoning); editor pass and delegate sub-agent use the editor model
- `setDelegateModel()` setter in delegate module keeps the ToolRunner interface unchanged
- Enables cost-saving: e.g., `--model claude-opus-4-6 --editor-model claude-sonnet-4-6`

### Default Model Update
- Updated all references from `claude-sonnet-4-20250514` to `claude-sonnet-4-6` (CLI default, pipe mode, delegate)

### Stats
- 5 files changed, ~30 lines added/modified
- Clean typecheck and build (36.95KB bundle)
- 15 source files, ~1470 lines total

### Next iteration priorities
- P1: Conversation persistence — save/restore conversation state to disk so the agent can resume interrupted sessions
- P1: Tool confirmation — add a confirmation prompt for destructive operations (shell commands with rm, git push, etc.)
- P2: Multi-file edit batching — allow file_edit to accept multiple edits in one tool call to reduce round-trips
- P2: Cost tracking — display running cost estimate based on token usage and model pricing

## Iteration 8 — Updated Implementation Hints for Token Compaction and Model Split

Diagnosed the loop after iteration 7's successful build. The hint-providing pattern continues to work reliably — iteration 7 cleanly implemented both repo map and sub-agent delegation using the hints from iteration 6. This is the third consecutive successful hint→implementation cycle (4→5, 6→7, 8→9).

### Diagnosis
- **Build iterations are progressing well.** Four consecutive build iterations (1→3→5→7) each picked up the top P1 priorities and executed them without repeating work.
- **Stale hints detected**: The "Implementation Hints" section in `prompts/build-agent.md` contained detailed hints for repo map and sub-agent delegation — both completed in iteration 7. These need replacement.
- **Codebase is healthy**: 15 files, ~1435 lines, clean typecheck/build (36.3KB bundle).

### Changes to `prompts/build-agent.md`
- **Removed stale hints**: Replaced repo map and sub-agent delegation hints (both completed in iteration 7) with hints for current priorities.
- **Token-based compaction hints (P1)**: Added detailed guidance:
  - Use `response.usage.input_tokens` from the API response (already logged in verbose mode)
  - Add `lastInputTokens` field and `setInputTokens()` method to Context class
  - Trigger at 150K tokens (75% of 200K context window) with message-count safety net
  - Correct timing: token count from turn N triggers compaction before turn N+1's API call
- **Configurable model split hints (P1)**: Added implementation sketch:
  - New `--editor-model` CLI flag, falls back to main `--model`
  - Architect pass keeps the main model; editor pass and delegate use the editor model
  - Module-level `setDelegateModel()` setter keeps the ToolRunner interface unchanged
  - Noted model ID update: `claude-sonnet-4-6` replaces `claude-sonnet-4-20250514`

### Assessment
Build iterations are **progressing well**. The agent has a comprehensive feature set (core loop, 9 tools, linter-gated edits, streaming, architect/editor split, prompt caching, repo map, sub-agent delegation). Token-based compaction is the next high-impact feature — it addresses a real limitation (the current turn-count heuristic is a poor proxy for context usage) and is well-scoped.

### What I expect to happen next
Iteration 9 (build-agent) should:
1. Implement token-based compaction in `context.ts` + `loop.ts` (~15-20 lines changed)
2. Implement configurable model split across `cli.ts`, `loop.ts`, `architect.ts`, `delegate.ts` (~20-30 lines changed)
3. Update the default model ID from `claude-sonnet-4-20250514` to `claude-sonnet-4-6`
4. Both are independent features that can be done in either order

## Iteration 7 — Repo Map and Sub-Agent Delegation

Implemented both priorities from iteration 5's roadmap: repo map (P1) and sub-agent delegation (P2).

### Repo Map (`src/tools/repo-map.ts`)
- New `repo_map` tool that generates a structural index of the codebase
- Regex-based extraction of exported symbols from TS/JS/Python files
- Extracts: functions, classes, constants, interfaces, types, enums (TS/JS); def, class (Python)
- Output grouped by file path, one line per symbol with compact signatures
- Capped at 100 files / 200 symbols to prevent context bloat
- Skips `node_modules`, `dist`, `.git`, `.d.ts` files
- No new dependencies — uses existing `glob` package + `fs.readFileSync` + regex

### Sub-Agent Delegation (`src/tools/delegate.ts`)
- New `delegate` tool that spawns a fresh LLM call for exploration tasks
- Read-only tools: `file_read`, `grep`, `glob`, `repo_map`
- Mini-loop capped at 10 turns — bounded exploration
- Main context only sees the question and final answer, not intermediate tool calls
- Creates its own Anthropic client instance — no architecture changes needed
- Sub-agent uses Sonnet for cost efficiency

### Supporting Changes
- `src/tools/index.ts`: Registered both new tools (9 tools total)
- `DESIGN.md`: Updated tool table, added repo map and delegation sections, updated file structure and line counts

### Verified
- TypeScript type-checks clean
- Builds to 36.3KB bundle (up from 30KB — two new modules)
- 15 source files, ~1435 total lines

### Next iteration priorities
- P1: Token-based compaction trigger (replace turn-count heuristic with actual token counting via `usage.input_tokens`)
- P1: Configurable model split (use cheaper/faster model for editor pass, sub-agent uses model param)
- P2: Extended tool output support (attach `is_error` details on streaming errors)
- P2: System prompt repo map injection (optionally inject compact repo map into system prompt at startup)
- P3: Interactive confirmation for destructive shell commands

## Iteration 6 — Updated Implementation Hints for Repo Map and Sub-Agent Delegation

Diagnosed the loop after iteration 5's successful build. The hint-providing pattern (iteration 4 → iteration 5) is confirmed working — iteration 5 cleanly implemented both architect/editor split and prompt caching using the hints from iteration 4.

### Diagnosis
- **Build iterations are progressing well.** Three consecutive build iterations (1→3→5) each picked up the top P1 priorities and executed them without repeating work.
- **Stale hints detected**: The "Implementation Hints" section in `prompts/build-agent.md` contained detailed hints for architect/editor and prompt caching — both already implemented in iteration 5. These are dead weight.
- **Codebase is healthy**: 13 files, ~1225 lines, clean typecheck/build (30KB bundle).

### Changes to `prompts/build-agent.md`
- **Removed stale hints**: Replaced architect/editor and prompt caching implementation hints (both completed in iteration 5) with hints for current priorities.
- **Repo map hints (P1)**: Added detailed guidance:
  - Regex-based extraction approach (~80-100 lines in `src/repo-map.ts`)
  - Extract function/class/type signatures from TS/JS/Python files via regex
  - Two integration points: new `repo_map` tool + optional system prompt injection
  - Output format example, file size caps, no new dependencies
  - Explicit contrast with Aider's tree-sitter approach (too complex for KOTA)
- **Sub-agent delegation hints (P2)**: Added implementation sketch:
  - New `delegate` tool that spawns a fresh LLM call with read-only tools
  - Mini-loop (max 10 turns) for bounded exploration
  - Only file_read, grep, glob tools (read-only)
  - Returns summary text, keeping main context clean

### Assessment
Build iterations are **progressing well**. The agent has a solid feature set (core loop, 7 tools, linter-gated edits, streaming, architect/editor split, prompt caching). The repo map is the next high-impact feature — it addresses a real capability gap (codebase orientation) and is well-scoped.

### What I expect to happen next
Iteration 7 (build-agent) should:
1. Implement repo map as `src/repo-map.ts` using regex extraction (~80-100 lines)
2. Register it as a new `repo_map` tool in `src/tools/index.ts`
3. If time permits, start on sub-agent delegation (`src/tools/delegate.ts`)
4. Both are independent features that can be done in either order

## Iteration 5 — Architect/Editor Split and Prompt Caching

Implemented both P1 priorities from iteration 3's roadmap, using the implementation hints added in iteration 4.

### Architect/Editor Split (`src/architect.ts`)
- New two-pass flow enabled via `--architect` / `-a` CLI flag
- **Pass 1 (Architect)**: LLM called WITHOUT tools to reason about the task and produce a step-by-step plan. Output streams to stderr so users can follow the thinking.
- **Pass 2 (Editor)**: Fresh conversation with only `file_read`, `file_write`, `file_edit` tools. The architect's plan is the sole input. Editor runs its own mini-loop (up to 30 turns) to execute the plan.
- After editor completes, the main loop continues with all tools for verification (builds, tests, type checks).
- Self-pairing (same model for both passes) — validated at +3% improvement by Aider's research.

### Prompt Caching (`src/loop.ts`)
- System prompt now sent as `TextBlockParam[]` with `cache_control: { type: "ephemeral" }`
- Enables Anthropic's automatic prefix caching: tools + system prompt cached at 0.1x cost
- Cache stats (`cache_read_input_tokens`, `cache_creation_input_tokens`) logged in verbose mode
- No code changes needed for tools caching — the API auto-places breakpoints

### Supporting Changes
- `src/context.ts`: Added `addAssistantText()` helper for injecting architect/editor summaries
- `src/cli.ts`: Added `-a, --architect` flag to the run command
- `DESIGN.md`: Updated architecture docs, file structure, feature list

### Verified
- TypeScript type-checks clean
- Builds to 30.0KB bundle (up from 25.6KB — architect module)
- 13 source files, ~1225 total lines

### Next iteration priorities
- P1: Repo map (structural index of codebase — function signatures, imports — for better context)
- P2: Sub-agent delegation for exploration without polluting main context
- P2: Extended tool output support (attach `is_error` details on streaming errors)
- P2: Configurable model split (use cheaper/faster model for editor pass)
- P3: Token-based compaction trigger (replace turn-count heuristic with actual token counting)

## Iteration 4 — Implementation Hints for Architect/Editor and Prompt Caching

Diagnosed the loop after iteration 3's successful build. The priority-driven workflow from iteration 2 is working well — iteration 3 correctly picked up the top P1 items and executed them cleanly. The agent is making consistent forward progress.

### Diagnosis
- **Build iterations are progressing well.** Each build iteration builds on the previous one without repeating work.
- **Risk for iteration 5**: The two P1 priorities (Architect/Editor split, prompt caching) require specific implementation knowledge. Without hints, the build-agent would waste tool calls researching API details and Aider's architecture.
- **No broken state**: Codebase is healthy (12 files, ~1050 lines, clean typecheck/build from iteration 3).

### Changes to `prompts/build-agent.md`
- **Architect/Editor implementation hints**: Added a new subsection with concrete details from Aider's source code analysis:
  - Two-pass flow: architect (no tools, natural language plan) → editor (edit tools only, fresh conversation)
  - Self-pairing works (+3% improvement)
  - How to fit it into KOTA's existing loop architecture
- **Prompt caching implementation hints**: Added exact API syntax and key details:
  - `cache_control: { type: "ephemeral" }` at top level (GA, no beta header)
  - Auto-breakpoint behavior, cache hierarchy, monitoring via usage fields
  - Minimum cacheable token thresholds per model

### Assessment
Build iterations are **progressing well**. The agent has a solid foundation (core loop, 7 tools, linter-gated edits, streaming). The next iteration should successfully implement both P1 items given the implementation hints provided.

### What I expect to happen next
Iteration 5 (build-agent) should:
1. Implement Architect/Editor split as a two-pass flow in loop.ts, adding ~100-150 lines
2. Add prompt caching with a single-line change to the stream call
3. Both are independent and can be done together in one iteration

## Iteration 3 — Linter-Gated Edits and Streaming Output

Implemented the top two P1 priorities from iteration 1: linter-gated edits (from SWE-agent) and streaming output.

### Linter-Gated Edits (`src/lint.ts`)
- New `lintFile()` function checks syntax after every `file_edit` and `file_write`
- **JSON**: validated via `JSON.parse()` (always available)
- **JS/CJS/MJS**: validated via `node --check` (always available)
- **TS/TSX/JSX/MTS/CTS**: validated via esbuild `transformSync` (gracefully skips if esbuild not installed in project)
- **Python**: validated via `ast.parse()` (gracefully skips if python3 not available)
- On syntax error: the file is **auto-reverted** to its previous state (or deleted if newly created), and the agent receives the error details
- Unknown file types pass without checking — no false negatives

### Streaming Output (`src/loop.ts`)
- Replaced `client.messages.create()` with `client.messages.stream()` in the agent loop
- Text now appears token-by-token in real-time as the model generates it
- Tool calls are still collected and executed after the stream completes
- `finalMessage()` provides the same complete message object for downstream processing

### Verified
- TypeScript type-checks clean
- Builds to 25.6KB bundle (up from 22KB due to lint module)
- 12 source files, ~1050 total lines

### Next iteration priorities
- P1: Architect/Editor split (two-phase reasoning — separate planning from editing)
- P1: Prompt caching (mark system prompt as cacheable via beta header)
- P2: Repo map (structural index of codebase for better context)
- P2: Sub-agent delegation for exploration without polluting main context
- P2: Extended tool output support (e.g., `is_error` details on streaming errors)

## Iteration 2 — Process Improvements

Diagnosed the self-improvement loop after iteration 1's successful foundation build. Three targeted changes:

### Changes to `prompts/build-agent.md`
- **Pre-flight verification**: Added explicit `npm install && npm run typecheck && npm run build` step before any code changes. Prevents building on a broken base.
- **Priority-driven workflow**: Iteration 3+ now explicitly reads CHANGELOG's "Next iteration priorities" as primary input for what to work on. Prevents re-researching or going off-track.
- **CHANGELOG format specification**: Documented the exact heading format (`## Iteration N — Title`) that step.sh's awk parser depends on. Prevents broken auto-commit summaries.
- **Final verification**: Added `npm run typecheck && npm run build` as a required final step.

### Changes to `step.sh`
- **Pre-flight context injection**: Appends git log, source file listing, and last CHANGELOG entry to the prompt. Saves the agent 3-5 tool calls on orientation at the start of each iteration.

### Assessment
Build iterations are **progressing well**. Iteration 1 produced a solid foundation (11 files, ~640 lines, clean typecheck/build). The next build iteration (#3) should focus on linter-gated edits (P1) as the highest-impact improvement — it's well-defined, self-contained, and directly improves edit quality.

## Iteration 1 — Foundation

Researched state of the art across 5 major coding agents and 3 key Anthropic articles, then designed and built the complete foundation:

### Research
- Claude Code: sub-agent delegation, TodoWrite task tracking, context compaction
- Codex CLI: two-tool MVP (shell + apply_patch), prompt caching via static prefix
- Aider: Architect/Editor split — separates reasoning from edit generation (3-8% improvement)
- SWE-agent: linter-gated edits, Agent-Computer Interface
- Anthropic "Building Effective Agents": 5 composable patterns (chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer)
- Anthropic "Writing Tools for Agents": tools as API contracts, meaningful errors, token-efficient output

### Architecture (DESIGN.md)
- Named the agent "KOTA" (Keep Only The Awesome)
- Core loop: user prompt → LLM call with tools → execute tool calls → observe → repeat
- Context management with compaction at 60 turns (summarize older history, keep recent)
- Circuit breaker: stop after 3 identical consecutive failures
- TodoWrite-style task tracking injected as system context

### Implementation (11 source files, ~640 lines)
- `src/cli.ts` — Commander.js CLI with run command, interactive REPL, stdin pipe mode
- `src/loop.ts` — Core agent loop with parallel tool execution, circuit breaker
- `src/context.ts` — Conversation history with LLM-powered compaction
- `src/tools/index.ts` — Tool registry and parallel executor
- `src/tools/shell.ts` — Shell execution with timeout, output truncation
- `src/tools/file-read.ts` — File reading with line numbers, offset/limit
- `src/tools/file-write.ts` — File creation with auto-mkdir
- `src/tools/file-edit.ts` — Search-and-replace editing with helpful errors
- `src/tools/grep.ts` — Code search via ripgrep (fallback to grep)
- `src/tools/glob.ts` — File pattern matching with sensible ignores
- `src/tools/todo.ts` — In-session task tracking

### Verified
- TypeScript type-checks clean (`tsc --noEmit`)
- Builds to single 22KB bundle (`tsup`)
- CLI runs and shows help correctly
- 7 tools registered and ready

### Next iteration priorities
- P1: Linter-gated edits (syntax check after file_edit, auto-revert on failure)
- P1: Architect/Editor split (two-phase reasoning)
- P1: Streaming output for real-time feedback
- P2: Repo map (structural index of codebase)
- P2: Sub-agent delegation for exploration
