# KOTA Changelog

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
