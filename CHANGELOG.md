# KOTA Changelog

## Iteration 77 — Delegate Streaming and Web Search Resilience

### Changes

**Delegate streaming feedback** (`src/tools/delegate.ts`)

Sub-agent text output now streams to stderr in real-time. Previously, the user
saw only progress lines (`[kota] delegate(explore) turn 2/10 — web_search`)
during delegation. Now the sub-agent's reasoning is visible as it generates,
making long delegations transparent and interruptible. Changed from
`messages.create()` to `messages.stream()` with text delta handler. The
streaming approach matches the main loop's pattern in `streaming.ts`.

**Web search rate limit detection** (`src/tools/web-search.ts`)

DuckDuckGo occasionally returns CAPTCHA challenges instead of results.
Previously this appeared as "No results found" — misleading and unactionable.
Now the agent gets an explicit error: "Search rate-limited by DuckDuckGo
(CAPTCHA challenge). Wait a moment and retry, or use web_fetch with a direct
URL." Detects `captcha`, `please try again`, and `automated requests` patterns,
but only when no actual search results are present (avoids false positives on
result pages that mention CAPTCHAs).

### Verification

- `npm run typecheck` — clean
- `npm run build` — clean
- `npm test` — 343 tests pass (was 332, +11 new: 6 for rate limit detection,
  5 for search result parser)
- `node dist/cli.js --help` — CLI loads correctly

### Future directions

- Consider a second search provider (Brave Search API free tier) as fallback
  when DDG is rate-limited, rather than just reporting the error
- delegate.ts is now ~347 lines — if more features are added, extract tool-set
  definitions into a separate module
- Delegate streaming could be enhanced with tool-name annotations between text
  blocks for richer inline progress

## Iteration 76 — Context Injection to Eliminate Orientation Overhead

### Diagnosis

**Verifying iteration 74's effects on iteration 75:**

1. **"Assess-then-audit" prompt restructuring**: FAILED. Iter 74 predicted
   orientation overhead would drop from 24 calls/53% to 10-12 calls/<35%.
   Actual: 39 calls/58% — WORSE. Cost $2.26 (predicted ≤$1.70), 68 turns
   (predicted ≤40).
2. **Why it failed**: Reordering prompt sections (assess before audit) doesn't
   reduce the number of commands the builder must execute. The builder still
   needs to run `git log`, `cat NOTES.md`, `cat CHANGELOG.md`, `cat AUDIT.md`,
   `ls src/` as tool calls. The overhead is structural, not behavioral.
3. **Product stagnation**: src_lines flat at ~6036-6120 over 4 builder
   iterations. Tests flat at 327-332. The builder has been polishing, not
   building, since iter 69.

### Root cause

step.sh was simplified (commit a2e55a1) to "let agents gather their own
context." This forces both agents to spend 10+ tool calls on routine queries
(git log, cat NOTES.md, CHANGELOG, AUDIT, ls src/) before they can start
working. These queries are predictable and always needed — they should be
injected into the prompt at zero tool-call cost.

### Changes

**`step.sh`** — Added `generate_context()` function (~22 lines) that produces
a context block appended to the prompt. For the builder: git log, NOTES.md,
last CHANGELOG entry, AUDIT.md, `ls src/`, and a growth trend computed from
the last 4 builder iterations in metrics.csv. For the improver: same basics
plus the latest builder and improver session summaries and recent metrics rows.

**`prompts/build-agent.md`** — Shortened "Orient Yourself" from 13 lines to 8.
Now references injected context instead of listing commands. Updated step 1 of
"How to Work" to start from the injected data and explicitly note the growth
trend.

**`prompts/improve-process.md`** — Same treatment. "Orient Yourself" shortened
from 12 to 8 lines. Steps 1-2 of "How to Work" now reference the injected
summaries instead of instructing manual reads.

### Expected effects

- Builder orientation overhead drops from 39 calls/58% to <15 calls/<30%.
  The builder no longer needs to run git log, cat NOTES.md, cat CHANGELOG,
  cat AUDIT.md, ls src/ — all are pre-injected.
- Builder cost drops from ~$2.26 to ~$1.50-1.80 (fewer orientation turns).
- Improver orientation overhead drops similarly (no longer needs to read
  session summaries, CHANGELOG, metrics manually).
- Growth trend visibility in injected context may break the polish loop by
  making stagnation visible before the builder commits to a direction.

### How the next improver (iter 78) verifies

1. Check iter 77's session summary for "Orientation overhead" — should be
   <15 calls and <30%.
2. Check that the builder's first Read/Bash calls are for source files or
   DESIGN.md (focused audit), NOT for git log, NOTES.md, CHANGELOG, etc.
3. Check metrics: cost should be ≤$1.80, turns ≤45.
4. Check whether src_lines or tests grew (growth trend making stagnation
   visible).

### Future directions

- If context injection works, consider also injecting DESIGN.md (saves
  another 1-2 Read calls for the builder).
- The growth trend data in the injected context could be enhanced with a
  human-readable assessment ("STAGNANT: no growth in 4 iterations" vs
  "GROWING: +200 lines in last 4 iterations") to make the signal stronger.

## Iteration 75 — Domain-Aware System Prompt

The system prompt now guides KOTA to behave as a general-purpose agent, not a
coding tool with extra features. Previously, ~60% of the system prompt was
tool-by-tool documentation redundant with the tool definitions themselves, and
there was no guidance on how to approach non-coding tasks. Now the prompt
includes domain-specific workflow patterns for five task types (code, research,
analysis, writing, planning) and a dedicated delegation strategy section.

### What changed

**System prompt overhaul** (`src/system-prompt.ts`):
- Added domain-aware approach guidance: each task type (code, research,
  analysis, writing, planning) gets a specific strategy with actionable
  steps. Research tasks now explicitly call for cross-referencing and
  citing sources. Analysis tasks direct toward code_exec for iterative
  exploration. Planning tasks guide toward option generation and trade-off
  evaluation.
- Expanded delegation section: explains when to use explore vs execute,
  how to run parallel delegations, and how to write specific task
  descriptions. Previously just 4 lines of "use explore for X, execute
  for Y."
- Condensed tool documentation: grouped tools by function (Files, Search,
  Execution, Web, Coordination) instead of listing each tool individually.
  The tool definitions already explain parameters — the system prompt now
  focuses on when and how to compose them.
- Added context management hints in the Efficiency section: use
  offset/limit as context fills, delegate instead of reading directly.

**Tool definition trimming** (10 tool files):
- Removed implementation details the agent doesn't need ("via ripgrep if
  available," "using DuckDuckGo," "Returns numbered lines like 'cat -n'").
- Compressed multi-line action descriptions (process tool: 5 lines → 2).
- Removed routing hints now covered by the system prompt (http_request's
  "prefer web_fetch for pages" → handled in system prompt's tool grouping).
- **Net savings: ~522 tokens per turn** (442 from tool definitions + 80
  from shorter system prompt), which compounds over every turn in every
  session.

### Why this matters

The system prompt is the highest-leverage file in the agent. It's sent
with every API call and determines how the agent approaches every task.
The previous prompt was 49 lines of mostly tool documentation — adequate
for coding but providing zero guidance for research, analysis, writing, or
planning tasks. A user asking "research X and write a report" would get a
coding assistant that happened to have web_search. Now they get an agent
that knows to search broadly, cross-reference sources, cite URLs, and
synthesize findings.

The token savings (522/turn) also directly improve the agent's effective
context budget. Over a 20-turn session, that's ~10K tokens reclaimed for
actual work.

### Verified
- TypeScript: `npm run typecheck` — clean
- Build: `npm run build` — 147.5KB bundle
- Tests: `npm test` — 332/332 passing
- CLI: `node dist/cli.js --help` — loads correctly

### Future directions
- Test the system prompt's effect on real tasks (research, analysis,
  planning) once ANTHROPIC_API_KEY is available in the build environment.
- Consider progressive tool disclosure: only show tool definitions
  relevant to the current task type, reducing noise for simple tasks.
- Delegation streaming (AUDIT item): stream sub-agent reasoning to the
  user during long delegations.

## Iteration 74 — Reduce Builder Orientation Overhead

### Diagnosis

**Verifying iteration 72's effects on iteration 73:**
1. **Worktree recovery**: WORKED. Two `recover:` commits appeared before iter 73. Iter 71's trapped work (delegate cost tracking, code_exec hints, 5 tests) was merged into main.
2. **"No worktrees" guardrail**: WORKED. Iter 73 worked directly in main. `git worktree list` shows only the main worktree. No worktree-related issues.
3. **Metrics growth**: src_lines 6036→6120 (+84), tests 327→332 (+5). Modest but real growth.
4. **Builder efficiency improved**: Cost $2.73→$1.77 (35% drop), turns 64→46 (28% drop). Likely from eliminating worktree setup overhead.

**Key finding: The builder spent 53% of its tool calls on orientation.**

Analyzing iter 73's session: 24 of 45 tool calls (53%) occurred before the first Edit. The builder read 8 orientation files (NOTES.md, git log, CHANGELOG, AUDIT.md, DESIGN.md, src listings, metrics) then read 11+ source files for a broad audit — before it even decided what to work on. This is the builder's biggest efficiency bottleneck.

Root cause: the workflow said "Audit first, then assess and decide." So the builder reads nearly every source file to generate audit candidates, then picks from them. But it only needs 1-3 modules for the work it actually does.

### Changes

**1. Builder prompt — Restructured workflow** (`prompts/build-agent.md`)

Reordered the "How to Work" steps from:
```
Orient (read everything) → Audit (read many modules) → Assess → Decide → Build
```
To:
```
Orient (minimal: git log, CHANGELOG, AUDIT.md) → Assess (user perspective) → Decide direction → Focused audit (read only relevant modules) → Build
```

The builder now decides its direction BEFORE reading source code, then reads only the 1-3 modules relevant to its chosen improvement. This should cut orientation from ~24 calls to ~10-12.

**2. Session summary — Orientation overhead metric** (`scripts/summarize-session.py`)

Added tracking of "first Edit/Write call number" to session summaries. Output now includes:
```
- **Orientation overhead**: 24 calls before first Edit/Write (53% of total)
```
This gives future improvers a concrete, measurable metric for builder efficiency.

**3. Improver prompt — Efficiency check guidance** (`prompts/improve-process.md`)

Added reference to the orientation overhead metric in the efficiency check step, with a threshold (>40%) to flag high overhead.

### Verification for next improver
- Check iter 75's session summary for "Orientation overhead" line. Target: <15 calls before first Edit/Write (down from 24)
- Check iter 75's cost. Target: ≤$1.70 (baseline: $1.77 in iter 73)
- Verify the builder still produces meaningful work (not sacrificing quality for speed)
- If overhead is still >40%, the builder may be ignoring the workflow change — check if it's reading source files before deciding direction

### Future directions (treat skeptically)
- If the workflow reorder works, consider injecting a one-line "last iteration summary" into the prompt to eliminate even more orientation calls
- The e2e smoke test still doesn't run (ANTHROPIC_API_KEY not set) — this is the owner's action item per NOTES.md

## Iteration 73 — Sub-Agent Robustness

Sub-agent delegation is now hardened against three failure modes that previously caused silent degradation on complex tasks.

### What changed

1. **Tool result truncation**: Sub-agent tool results are now truncated at 30K chars using the same head+tail strategy as the main loop. Previously, a single large `file_read` could consume most of the sub-agent's context window, leaving no room for reasoning. This prevents context blowout without losing critical information.

2. **Prompt caching**: The sub-agent system prompt is now passed as a `TextBlockParam[]` with `cache_control: { type: "ephemeral" }`. For a 15-turn execute delegation, this reduces system prompt cost from 15x to ~1.1x (one cache creation + 14 cache reads at 0.1x).

3. **Failure tracking with circuit breaker**: Sub-agents now detect when they repeat the same failing operation 3 times and break out of the loop early with a diagnostic message. Previously, a stuck sub-agent would burn all 10-15 turns on identical failures.

4. **Context overflow handling**: If the API rejects a sub-agent call because the prompt is too long, the error is caught and reported as an actionable message ("task may be too complex for a single delegation — try breaking it into smaller sub-tasks") instead of propagating as a cryptic tool error.

### What was removed

- Deprecated `setDelegateModel()` function (dead code, replaced by `setDelegateConfig()` in iter 69)

### Verified

- TypeScript type-checks clean
- 332 tests pass (20 test files)
- `node dist/cli.js --help` loads successfully
- Bundle: 149KB

### Audit updates

- **Fixed**: "No prompt caching for sub-agents" (iter 71)
- **New**: delegate.ts at 338 lines (LOW), context pruning triggers one turn late (LOW)
- **Carried forward**: Tool count growing (LOW), no streaming feedback for sub-agents (LOW)

### Future directions

- Stream sub-agent reasoning to stderr for transparency during long delegations (switch from `create()` to `stream()`)
- Proactive context pruning based on message size estimation (before API call, not after)
- PDF reading capability for research workflows

## Iteration 71 — Delegate Visibility and Code Exec Guidance

Delegate sub-agents now report their API costs to the main session's cost tracker and print per-turn progress to stderr, fixing a class of invisible-cost and zero-feedback issues that affected every delegation call. The `code_exec` tool now detects missing package errors (Python `ModuleNotFoundError`, Node.js `Cannot find module`) and suggests the install command.

### Why these improvements

Both fixes make existing tools more reliable rather than adding new capabilities. Delegation is a core architectural feature — every use of `delegate` previously burned API tokens with no cost visibility and showed nothing to the user during 30-60s of sub-agent work. For `code_exec`, import errors are the most common failure when starting data analysis workflows, and the agent had no guidance on how to recover.

### What changed

- **`src/tools/delegate.ts`**: Added `CostTracker` to `DelegateConfig`. Each sub-agent API call now feeds into the main session's cost tracker, so the cumulative `$X.XXXX` display includes delegation costs. Progress messages print to stderr on each sub-agent turn (`[kota] delegate(explore) turn 2/10 — file_read, grep`). Bumped sub-agent `max_tokens` from 4096 to 8192 — complex implementation tasks needed more output budget.
- **`src/loop.ts`**: Passes `CostTracker` instance through `setDelegateConfig` so delegate has access to cost tracking.
- **`src/tools/code-exec.ts`**: New `detectPackageHint()` function detects `ModuleNotFoundError` (Python) and `Cannot find module` (Node.js) in output, appending install suggestions like `Tip: Install the missing package with shell: pip install pandas`.
- **`src/tools/code-exec.test.ts`**: 5 new tests for package hint detection.

### Verified

- TypeScript type-checks clean
- Builds to 147.75KB bundle
- All 332 tests pass (including 5 new package hint tests)
- CLI runs and shows help correctly

### Audit findings (new and carried forward)

- See AUDIT.md for current state.

### Future directions

- Add prompt caching to delegate API calls (sub-agents pay full price for system prompt on every turn)
- Stream delegate text output to stderr for real-time feedback on sub-agent reasoning
- Progressive tool disclosure to reduce token cost of tool definitions as tool count grows

## Iteration 70 — Holistic Assessment Step

### Diagnosis

**Verifying iteration 68's effects on iteration 69:**

1. **AUDIT.md creation**: WORKED. The builder read AUDIT.md, used its findings
   as candidates, fixed 2 entries (delegate context, system-prompt cwd), and
   added 2 new entries (code_exec package discovery, tool count). The mechanism
   is fully operational.

2. **Builder prompt AUDIT.md integration**: WORKED. The builder's session
   summary explicitly shows "Audit findings" sections for both fixed and new
   items. The audit directly informed decision-making.

3. **Quality focus sustaining**: WORKED. Iteration 69 is the second consecutive
   quality-focused builder iteration (after 67). The builder explicitly chose
   to fix audit findings over building new features.

**Efficiency check**: Builder cost $1.97 (iter 67) → $2.44 (iter 69) = 24%
increase. Turns 44 → 64 = 45% increase. Iter 69 produced a smaller change
(~80 lines vs ~170 lines in iter 67). The extra turns came from 34 Bash calls
(vs 21) and 7 TodoWrite calls (vs 0). Not alarming but worth monitoring — the
audit step adds orient overhead.

**Systemic gap identified**: The builder's workflow evaluates at the code level
(audit individual modules for bugs/issues) but never at the system level. In 35
builder iterations, no iteration has evaluated: "Does the system prompt make
sense to users?" "Do tools compose well for realistic multi-step workflows?"
"What's the error UX like across a full session?" The code-level audit catches
real bugs, but system-level issues — the kind that make the difference between
a "working" agent and a "good" agent — are invisible to it.

### Changes

**1. Builder prompt — Added step 3 "Assess the whole"** (+7 lines)

New step between Audit (step 2) and Research (step 4). Asks the builder to
think like a user: "If someone ran this agent on a real task right now, what's
the first thing that would break or frustrate them?" Explicitly calls out
system prompt clarity, tool composition in realistic workflows, error recovery,
and output quality.

**Why**: The code audit catches individual module issues. This step catches
cross-cutting concerns that no single module "owns" — system prompt quality,
tool interactions, error UX across a session. These are the issues that
determine whether the agent is genuinely good to use, not just clean code.

**Verification method**: Check iteration 71's session summary. The builder
should show an "Assess the whole" or holistic evaluation section in its
decisions, distinct from the code-level audit. If the builder surfaces a
system-level issue (system prompt, tool composition, error UX) that it would
not have found through code auditing alone, the intervention worked.

**2. Builder prompt — Sharpened step 8 "Reflect"** (reworded)

Changed from "does this improvement make the agent more capable across domains?"
to "Would this change be noticeable to someone using the agent, or only visible
in the codebase?" This is a sharper question that forces the builder to evaluate
user-facing impact, not just code quality.

**Verification method**: Check iteration 71's CHANGELOG reflection. Does it
reference user-facing impact rather than just code cleanliness?

### Future directions (treat skeptically)

- If the holistic assessment consistently surfaces system-level issues that the
  code audit misses, consider making it a structured checklist (system prompt ✓,
  tool composition ✓, error UX ✓) rather than an open-ended question
- Builder turn efficiency: if turns stay above 60 for two more iterations,
  consider adding orient-phase guidance to reduce time spent reading files
- The e2e smoke test (NOTES.md) still can't run without ANTHROPIC_API_KEY —
  this remains the biggest validation gap

## Iteration 69 — Sub-Agent Context & Working Directory

Sub-agents now receive project context — working directory path, project type,
and `.kota.md` conventions — instead of working blind with minimal system
prompts. The main agent's Anthropic client is reused for delegation calls,
eliminating redundant client instantiation.

### Why this improvement

Two open audit findings (from iteration 67) identified that delegation
effectiveness was degraded because sub-agents had no orientation context:
- No working directory path — sub-agents couldn't resolve relative paths
  or know where they were in the filesystem
- No project context — sub-agents didn't know the project type, frameworks,
  or conventions from `.kota.md` files

Every delegation call (both `explore` and `execute` modes) was affected. For a
general-purpose agent that uses delegation as a core orchestration pattern,
this is a class of failures, not a single bug.

### What changed

- **`src/tools/delegate.ts`**: Replaced `setDelegateModel(model)` with
  `setDelegateConfig({ model, client, cwd, projectContext })`. New
  `buildSubAgentPrompt()` function enriches the base system prompt with
  working directory and project context. Sub-agents reuse the main session's
  Anthropic client instead of creating a new one per call.
- **`src/loop.ts`**: Session constructor now passes client, cwd, and project
  context to the delegate config.
- **`src/init.ts`**: `buildSessionWarmup()` now includes the explicit working
  directory path. `detectProject()` exported for reuse.

### Verified

- TypeScript type-checks clean
- 327 tests pass (6 new for `buildSubAgentPrompt`)
- Builds to 146KB bundle
- CLI `--help` runs correctly

### Audit findings

**Fixed**: delegate.ts sub-agent context (iter 67), system-prompt.ts working
directory (iter 67).

**New**: code_exec.ts lacks package discovery guidance (MINOR), tool count
at 17 approaching noise threshold (LOW).

### Future directions

- Package availability check in code_exec (guide agent to `pip install`
  before importing unavailable packages)
- Tool grouping or progressive disclosure if tool count grows further
- Pass relevant memory entries to sub-agents for cross-session context

## Iteration 68 — Audit Findings Carry-Forward

### Diagnosis

**Verifying iteration 66's effects on iteration 67:**

1. **"What to Work On" reframing**: WORKED. The builder picked a quality fix
   (web_fetch content extraction) for the first time in 5+ builder iterations.
   It explicitly framed the choice as "a quality fix, not a new feature."

2. **"Audit" step**: WORKED. Builder's session shows a clear "Audit Summary"
   with 3 concrete findings (web-fetch CRITICAL, delegate MODERATE,
   system-prompt MINOR). The audit directly informed the decision.

3. **Improver efficiency check + verifiability**: APPLIES TO ME (iter 68).
   Done — see this entry.

**Efficiency check**: Builder cost $3.35 (iter 65) → $1.97 (iter 67) = 41%
drop. Duration 786s → 451s = 43% drop. The quality-focused iteration was
cheaper than the feature-bloat iterations. Healthy trend.

**Systemic gap identified**: The builder's audit found 3 issues but only fixed
1. The other 2 (delegate context, system-prompt cwd) were recorded in the
CHANGELOG but have no mechanism to persist across iterations. Next builder
will audit different files and never revisit these findings. Over time,
quality issues accumulate silently.

### Changes

**1. Created `AUDIT.md`** — persistent file for unfixed quality findings

Seeded with iter 67's 2 unfixed findings (delegate context, system-prompt cwd).
Format: heading with module name, iteration, severity; body with the issue
description. Entries are removed when fixed, added during audits.

**Verification method**: Check iteration 69's session summary. The builder
should (a) read AUDIT.md during orient, (b) include prior findings in its
candidate list, and (c) update AUDIT.md (remove fixed entries, add new ones).

**2. Updated builder prompt** — integrated AUDIT.md into workflow

- Orient step: added `cat AUDIT.md` to the command list
- Audit step: added "Read AUDIT.md for unfixed findings from prior iterations"
- Record step: added "Update AUDIT.md: remove entries you fixed; add new
  unfixed findings from your audit"

**Verification method**: Read the builder prompt and confirm the 3 integration
points exist. Check iter 69's session for evidence the builder read AUDIT.md.

**3. Updated improver prompt** — added AUDIT.md to orient section

Added `cat AUDIT.md` with a note to check whether the builder is maintaining
it. This lets future improvers monitor whether the carry-forward mechanism is
working.

**Verification method**: Read the improver prompt and confirm AUDIT.md is
listed.

### Future directions (treat skeptically)

- If AUDIT.md grows large (>20 entries), the builder may need guidance on
  prioritization or a mechanism to age out stale findings
- Consider adding "untested modules" count to step.sh metrics to give the
  builder/improver a concrete test coverage signal
- If the builder consistently maintains AUDIT.md, consider similar mechanisms
  for other types of cross-iteration state (e.g., architectural decisions
  that didn't make it into DESIGN.md)

## Iteration 67 — Better Web Content Extraction

KOTA's `web_fetch` tool now returns clean, structured Markdown instead of noisy flat text. The new `html-extract` module removes boilerplate (navigation, headers, footers, sidebars, scripts, iframes) and converts semantic HTML to Markdown: headings become `#` syntax, code blocks become fenced blocks with language detection, lists become `- ` items, links become `[text](url)`, and emphasis becomes `**bold**`/`*italic*`.

### Why this improvement

This is a quality fix, not a new feature. `web_fetch` already existed but returned low-quality output — it stripped ALL HTML tags uniformly, destroying structure and including navigation noise. For a general-purpose research agent, web content quality directly affects every research, analysis, and documentation task. The old extractor wasted ~80% of the token budget on boilerplate and made code snippets, headings, and lists indistinguishable from body text.

### What changed

- **New module**: `src/html-extract.ts` (~170 lines) — pipeline-based HTML-to-Markdown converter
  - Phase 1: Remove boilerplate blocks (script, style, noscript, nav, header, footer, aside, menu, svg, iframe)
  - Phase 2: Convert semantic elements (code blocks, headings, lists, links, blockquotes, emphasis)
  - Phase 3: Strip remaining tags, decode entities, normalize whitespace
  - Code blocks use a placeholder system to prevent decoded `<`/`>` entities from being stripped as tags
- **Updated**: `src/tools/web-fetch.ts` — replaced the 35-line `stripHtml` function with `extractContent` import
- **New tests**: `src/html-extract.test.ts` — 27 tests covering boilerplate removal, code blocks (with language detection, entity decoding, nested tags), headings, lists, links, emphasis, blockquotes, whitespace normalization, and a realistic full-page extraction test

### Audit findings (informed this decision)

| Module | Issue | Severity |
|--------|-------|----------|
| `web-fetch.ts` | Crude HTML stripping destroys all structure, includes boilerplate noise | CRITICAL — picked for this iteration |
| `delegate.ts` | Sub-agents get minimal system prompt (no cwd, no project context) | MODERATE |
| `system-prompt.ts` | No working directory path in system prompt | MINOR |

### Verified

- TypeScript: clean
- Tests: 321 passed (294 existing + 27 new)
- Build: 146KB bundle
- CLI: starts correctly

### Future directions

- Enrich delegate sub-agent system prompts with project context and cwd
- Add working directory to main system prompt
- Consider using `<main>` / `<article>` elements to further narrow content extraction

## Iteration 66 — Shift Builder from Feature Accumulation to Quality

### Diagnosis

**Verifying iteration 64's effects on iteration 65:**

1. **E2E smoke test**: NOT WORKING. `ANTHROPIC_API_KEY` is not set in the shell
   environment (length=0). Claude Code uses stored credentials, but KOTA needs
   the env var directly. The test code is correct but depends on an unavailable
   env var. `smoke_haiku` is still `-` for iteration 65.

2. **Quality candidate requirement**: PARTIALLY WORKED. The builder DID list a
   quality candidate (B: "Refactor tool output quality") as required. But it
   chose the feature (A: REPL) anyway. The structural incentive to pick features
   over quality remained unchanged — "Aim high, pick ambitious" codes as "new."

**Systemic pattern**: 5 consecutive feature-addition iterations (57, 59, 61, 63,
65). No consolidation iteration has occurred. 18 tools, 43 files, 5820 lines,
146KB bundle. Builder cost jumped 50% in iter 65 ($2.24→$3.35), duration +69%.

**Root cause**: The builder prompt's incentive structure favors novelty. "Aim
high" = "build something new." The quality candidate requirement was a band-aid
— it ensured consideration but gave the builder no mechanism to *discover*
quality problems, and no framework for valuing quality fixes over new features.

### Changes

**1. Builder prompt — "What to Work On" reframing** (`prompts/build-agent.md`)

Replaced "Aim high. Pick one ambitious improvement" with framing that defines
impact as real-task performance, not feature count. Added explicit diminishing-
returns guidance: "Adding capability N+1 has diminishing returns when
capabilities 1–N are undertested, poorly integrated, or produce confusing
errors."

**Verification method**: Check iteration 67's decision analysis. The builder
should either (a) pick a quality improvement, or (b) explicitly justify why a
new feature has higher impact than fixing audit findings. Either outcome shows
the reframing worked.

**2. Builder prompt — "Audit" step** (`prompts/build-agent.md`, How to Work)

Added step 2: "Pick 2-3 existing tools or modules. Read their source code.
Note concrete issues." This forces the builder to look at existing code quality
before deciding what to build. The "Decide" step (now step 4) requires
evidence-based justification and explicitly notes "Adds a capability" is weaker
than "fixes a class of failures."

**Verification method**: Check iteration 67's session summary for an "Audit"
section where the builder reads existing tool source and notes issues.

**3. Improver prompt — efficiency check + verifiability** (`prompts/improve-process.md`)

Added step 4: "Check efficiency" — review metrics.csv for cost/duration trends.
Added step 8: "Verify your changes are verifiable" — for each change, write how
the next improver will check whether it worked. This closes the loop on the
effect-verification step (added iter 62) by making it easier to verify.

**Verification method**: Check iteration 68's CHANGELOG for an efficiency
analysis section and per-change verification methods.

**4. NOTES.md** — Added note for operator to set `ANTHROPIC_API_KEY` in the
shell environment to enable the e2e smoke test.

### Future directions (treat skeptically)

- If the audit step works but the builder still picks features, consider making
  quality iterations mandatory (e.g., every 3rd builder iteration must be quality)
- Create a lightweight eval suite that tests agent behavior without API calls
  (mock-based integration tests for tool selection and orchestration)
- Pre-inject codebase metrics (tool count, line count) into the builder prompt
  via step.sh to make maturity signals more salient

## Iteration 65 — Interactive Code Execution (REPL)

KOTA now has persistent REPL sessions for Python and Node.js. The `code_exec` tool lets the agent execute code incrementally — variables, imports, and state persist across calls within a session. This is the capability that separates a general-purpose agent from a coding-only tool: iterative data analysis, math, prototyping, and computation are now first-class workflows.

### Why this improvement

Every major general-purpose agent (ChatGPT Code Interpreter, Claude Computer Use, Manus) has interactive code execution. KOTA's shell tool is one-shot — each call starts a fresh process with no state. For data work, you'd have to write a full script to file and run it, losing the iterative exploration loop. A persistent REPL enables:
- Data analysis: load CSV, explore columns, compute stats, generate charts step-by-step
- Math/computation: build up calculations, run simulations incrementally
- Prototyping: test code snippets without creating files
- Automation: iteratively build up complex data transformations

### What changed

**New tool: `code_exec`** (`src/tools/code-exec.ts`, ~190 lines)
- Sentinel-based protocol: code lines sent via stdin, execution triggered by a marker, output captured until done marker
- Python wrapper uses AST-based last-expression extraction (like IPython) — `import math\nmath.sqrt(144)` displays `12.0`
- Node.js wrapper uses `vm.runInContext` with a persistent context for state accumulation
- Per-execution timeout (default 30s) with auto-restart on timeout
- Race-condition-safe process lifecycle (old process exit events can't corrupt new session state)
- Available to both main agent and delegated sub-agents (execute mode)

**New utility: `src/runtime-check.ts`** (~10 lines) — `which()` for checking runtime availability.

**Integration:**
- Registered in `tools/index.ts` (17 → 18 tools)
- Added to delegate execute mode tools
- System prompt updated with usage guidance
- Sessions cleaned up on agent shutdown alongside background processes

### Verified
- TypeScript type-checks clean
- Builds to 142.62KB bundle
- 294 tests pass (18 new: expression eval, statement exec, state persistence, imports, multi-line code, error handling/recovery, timeout, reset, both Python and Node.js)
- CLI smoke test passes

### Future directions
- REPL for more languages (Ruby, shell, R) as the wrapper protocol is language-agnostic
- Async/await support in the Node.js REPL (currently only sync code persists state)
- Jupyter notebook integration as an alternative to the built-in REPL
- Data visualization: pipe matplotlib/chart output as images back to the agent via the vision system

## Iteration 64 — E2E Smoke Test and Quality Candidate Requirement

### Diagnosis

**Verifying iteration 62's effects on iteration 63:**

1. **DESIGN.md size constraint (≤250 lines)**: Worked. DESIGN.md went from 552 → 127
   lines. The builder trimmed aggressively and kept only architecture/design content.
2. **Session summary quality (increased truncation limits)**: Worked. Iteration 63's
   summary has full candidate analysis with reasoning and complete implementation
   details — no truncation.
3. **Effect verification step (improver prompt)**: Worked. This is iteration 64 — the
   first improver since the step was added — and it's now being used systematically.

All three changes landed cleanly.

**The systemic gap**: 63 iterations and the `smoke_haiku` column in metrics.csv has
**never been populated**. The agent has never been tested end-to-end. We verify
compilation, unit tests, and `--help`, but never verify the agent can actually
complete a task. This is the classic "all tests pass but the product doesn't work"
gap — we test the engine but never drive the car.

**The builder bias**: Last 4 builder iterations (57, 59, 61, 63) all added new
capabilities. The builder evaluates "value/cost ratio" and new features always win
because they're tangible and easy to scope. Quality improvements (refactoring,
integration tests, robustness) are consistently passed over despite having
potentially higher impact on actual agent quality.

### Changes

1. **E2E smoke test** (`step.sh`, +20 lines): After each builder iteration's
   unit tests pass, run the actual agent against a trivial task — create a temp
   directory with a known file, ask the agent (haiku model, 256 max tokens) to
   read it and report the content, check if the expected answer appears. Populates
   the `smoke_haiku` column that's been empty for 63 iterations. Gracefully skips
   if `ANTHROPIC_API_KEY` is not set. Cost: ~$0.005 per run, ~30s.

2. **Quality candidate requirement** (`prompts/build-agent.md`, 2 lines changed):
   The builder's "Decide" step now requires at least one candidate that improves
   existing functionality (refactoring, integration testing, robustness, tool
   quality) rather than adding something new. This ensures quality improvements
   are always on the table, without dictating which candidate the builder picks.

### Expected effects

- `smoke_haiku` column starts getting populated (PASS/FAIL/SKIP instead of `-`)
- When ANTHROPIC_API_KEY is available, integration bugs will be caught before commit
- Builder iteration 65 will include at least one quality-focused candidate in its
  evaluation, potentially leading to an iteration that improves robustness rather
  than adding the 19th tool

### Future directions (treat skeptically)

- If the e2e test consistently passes, add a second test case that exercises tool
  chaining (e.g., "create a file, then read it back")
- Consider adding a NOTES.md entry asking the loop operator to set ANTHROPIC_API_KEY
  so the e2e test actually runs
- If the quality candidate requirement works, track what fraction of iterations
  choose quality vs. new features over the next 10 iterations

## Iteration 63 — Background Process Management

KOTA can now run background processes — dev servers, test watchers, builds, or any long-running command — while continuing to work on other tasks. Before this change, the `shell` tool blocked until command completion: running `npm run dev` would hang for 120 seconds then timeout. Now the agent can start a server, check its output, test against it, and stop it when done.

### Why this improvement

Every prior iteration since #47 improved code-editing infrastructure (whitespace matching, error context, tool retry, pruning, multimodal, HTTP). These are valuable but they don't remove the fundamental limitation: KOTA's execution model is **synchronous-only**. The agent cannot start a process and do other work while it runs.

For a general-purpose agent, async execution is essential:
- Start a dev server, then test against it
- Run a build in the background while editing other files
- Start a test watcher and iterate on failing tests
- Launch services for integration testing

The `process` tool is the first architectural change to KOTA's execution model since iteration 1.

### What changed

**New tool: `process`** (`src/tools/process.ts`, ~230 lines)
- **start**: Spawn a command in the background. Returns process ID and initial output (waits 500ms for startup messages).
- **output**: Get recent stdout/stderr from a running process. Circular buffer of 500 lines prevents unbounded memory growth.
- **signal**: Send SIGTERM/SIGINT/SIGKILL to a process.
- **list**: Show all managed processes with status, uptime, and last output line.
- Max 5 concurrent processes. Same dangerous-command detection as shell. All processes auto-terminated on session close.

**Integration:**
- Registered in tool index (`src/tools/index.ts`)
- Documented in system prompt (`src/system-prompt.ts`) — explains when to use `process` vs `shell`
- Available in delegate execute mode (`src/tools/delegate.ts`) — sub-agents can manage background processes
- Session cleanup (`src/loop.ts`) — `cleanupProcesses()` called on session close

**DESIGN.md trimmed** from 552 → 127 lines per iteration 62's directive. Removed:
- File Structure listing (62 lines) — redundant with `ls src/`
- "What Makes KOTA Better" marketing section (38 lines)
- Verbose per-tool descriptions that restate what the code does
- Kept: architecture diagram, design decisions with rationale, patterns

### Verified
- TypeScript type-checks clean
- Builds to 134.75KB bundle
- 276 tests pass (17 new process tool tests)
- `node dist/cli.js --help` smoke test passes

### Future directions
- Process output streaming to stderr (like shell tool) for user visibility
- Process health checks — auto-restart processes that crash
- Named processes instead of auto-generated IDs (e.g., `process start --name devserver`)
- Port-aware server detection — detect when a server is listening and ready

## Iteration 62 — DESIGN.md Size Discipline, Summary Quality, Effect Verification

### Diagnosis

**Checking iteration 60's effects on iteration 61:**
- Session summaries: Working. Iteration 61 has a `.summary.md` generated by `step.sh`.
  BUT: truncation at 500 chars loses critical context — Decision 1 lost the candidate
  analysis, Final Output lost half the implementation details. The summary showed
  *what* was decided but not *why*, defeating the purpose.
- DESIGN.md inventory instruction: Partially effective. Builder stopped updating
  file/test/line counts. BUT it still appended to "What Makes KOTA Better" (now 36
  items, 46 lines) and maintained the File Structure listing (66 lines). DESIGN.md
  grew to 552 lines — a massive per-iteration context cost that's 5× the builder
  prompt itself.

**The systemic issue**: DESIGN.md has become an ever-growing documentation dump.
112 of its 552 lines are pure inventory (file structure + feature marketing). The
architecture sections are useful but verbose. The builder reads all 552 lines at
orientation every iteration. This is the single largest context tax in the process.

### Changes

1. **Builder prompt** (`prompts/build-agent.md`): Added explicit DESIGN.md size
   constraint — ≤250 lines. Builder must check line count before adding content
   and trim inventory/marketing sections first. Specifies what to keep (architecture
   decisions, design rationale, patterns) and what to cut (file structure listings,
   feature bullet lists, per-tool descriptions that restate the code).

2. **Session summarizer** (`scripts/summarize-session.py`): Increased truncation
   limits — decision text from 500→1500 chars, final output from 500→2000 chars,
   first text from 300→500 chars. Regenerated iteration 61 summary: now captures
   full candidate analysis with reasoning, complete implementation details.

3. **Improver prompt** (`prompts/improve-process.md`): Added step 3 "Verify prior
   effects" — explicitly check whether the previous improver's CHANGELOG-stated
   changes produced their intended effects. This creates cross-iteration
   accountability and prevents repeating interventions that don't land.

### Expected effects

- Builder iteration 63 should trim DESIGN.md from 552 to ≤250 lines, freeing
  context budget and reducing orientation time
- Future session summaries will preserve full decision reasoning (3× more text)
- Future improver iterations will systematically verify their predecessors' work

### Future directions (treat skeptically)

- Add a real integration smoke test that runs the agent on a simple task (needs
  API key availability check)
- Consider whether the builder should alternate between "add feature" and
  "consolidate/refactor" iterations after N consecutive additions
- Evaluate whether the builder prompt's "How to Work" section is too prescriptive
  or if the builder would make equally good decisions with less guidance

## Iteration 61 — Vision / Image Support (Multimodal Input)

KOTA is now multimodal — `file_read` handles images (PNG, JPEG, GIF, WebP) natively. When the agent reads an image file, it receives the actual image via Claude's vision API, enabling screenshot analysis, diagram reading, chart interpretation, UI review, and photo analysis.

### Why this improvement

KOTA was text-only. Every competitor (Claude Code, Cursor, GPT-4) supports vision. For a general-purpose agent, images are a fundamental input modality — users debug with screenshots, review UI designs, analyze charts, read diagrams. Without vision, the agent could only describe files by name, not see them.

This is a clear binary capability gap (can't → can) that makes KOTA genuinely multimodal rather than just a text processing tool with web access.

### What changed

**Rich tool results** (`src/tools/index.ts`):
- New `ToolResultBlock` type: union of `{ type: "text"; text: string }` and `{ type: "image"; source: { type: "base64"; media_type: string; data: string } }`
- `ToolResult` gains optional `blocks?: ToolResultBlock[]` — when present, sent as rich content to Claude's API instead of plain text

**Image reading** (`src/tools/file-read.ts`, ~40 new lines):
- Detects image files by extension (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`)
- Reads as base64, returns image content block + text description
- Size limit: 20MB (Claude API max). Empty files rejected.
- SVGs and other non-image extensions read as text (unchanged)

**Pipeline updates** (6 files touched):
- `tool-runner.ts`: Preserves `blocks` through the pipeline, skips text truncation for rich content
- `context.ts`: `addToolResults` sends `blocks` as API-compatible content via type assertion
- `message-pruning.ts`: Image-bearing results are always pruned (replaced with text summary) — images consume ~1000+ vision tokens
- `compaction.ts`: Image blocks rendered as `[image]` in conversation text for summarization
- `system-prompt.ts`: Updated to mention image support in tool strategy

**Tests** (`src/tools/file-read.test.ts`, 15 new tests):
- PNG, JPEG, WebP, GIF reading with correct media types
- Block structure validation (image block + text block)
- Empty file rejection, size description, offset/limit ignored for images
- SVG treated as text, non-image extensions unaffected

### Verified
- TypeScript typechecks clean
- Builds to 127KB bundle (up from 124KB)
- All 259 tests pass (244 existing + 15 new)
- `node dist/cli.js --help` runs correctly

### Future directions (treat skeptically)
- PDF reading via pdf-parse or similar (another non-text format gap)
- Image generation / diagram creation (output side of vision)
- Clipboard/screenshot capture tool (not just files)
- Video frame extraction for video analysis

## Iteration 60 — Session Summaries and DESIGN.md Overhead Reduction

Two systemic bottlenecks identified from analyzing iterations 58-59:

**Problem 1: The improver wastes ~60% of its tool budget parsing session logs.**
Iteration 58 used 87 tool calls, 54 of which were Bash (mostly Python one-liners
trying to extract data from JSONL files). This is the #1 inefficiency in the
improver's workflow.

**Problem 2: The builder spends ~30% of its effort maintaining DESIGN.md inventory.**
Iteration 59 used 18 Edit calls; ~10 were updating file counts, test counts,
capability numbers, and file structure listings in DESIGN.md — metadata that's
already tracked in metrics.csv and discoverable via `ls src/`.

### Changes

1. **`scripts/summarize-session.py`** (new, ~160 lines): Parses `.session.jsonl`
   files and produces readable `.summary.md` digests. Extracts: cost, turns,
   duration, tool usage breakdown, files modified, key decisions, errors, and
   final output. Designed to be the primary input for both builder and improver
   orientation.

2. **`step.sh`** (+4 lines): Auto-runs `summarize-session.py` after each
   iteration, saving output to `logs/NNN-task-TIMESTAMP.summary.md`.

3. **`prompts/build-agent.md`**: Points to `.summary.md` for orientation.
   Instructs builder to update DESIGN.md for architecture/design only, NOT
   inventory metadata (file counts, test counts, line counts, file listings).

4. **`prompts/improve-process.md`**: Directs improver to use `.summary.md`
   files as primary evidence source, with raw `.session.jsonl` as fallback.
   Documents the `summarize-session.py` tool for regenerating summaries.

### Expected effects

- Improver should need ~30 fewer tool calls (from ~87 to ~55) by reading
  summaries instead of raw JSONL
- Builder should save ~8 Edit calls per iteration by skipping DESIGN.md
  inventory updates
- Both agents start with better context, faster

### Future directions

- Add a quality evaluation framework: not just "does it compile" but "does
  the agent handle diverse tasks well?" — would require API access for
  integration testing
- Consider whether DESIGN.md should be split into DESIGN.md (architecture)
  and auto-generated INVENTORY.md (counts, file listings)

## Iteration 59 — HTTP Request Tool (API Interaction)

KOTA can now interact with APIs and web services, not just read web pages. The new `http_request` tool supports all HTTP methods, custom headers, and request bodies — enabling REST API interaction, webhook automation, service testing, and data retrieval from authenticated endpoints.

### Why this improvement

The last ~10 iterations focused on code-editing reliability (error diagnostics, whitespace matching, auto-retry, verification nudges). These are important, but they only improve KOTA as a coding tool. For a general-purpose agent, the ability to interact with APIs is fundamental — it unlocks service automation, data retrieval, endpoint testing, and integration workflows. Before this change, KOTA could search the web and read pages, but couldn't POST data, send auth headers, or interact with any REST API. The shell `curl` workaround is verbose and hard for the LLM to parse reliably.

### What changed

**New tool: `http_request`** (`src/tools/http-request.ts`, ~155 lines)
- All HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Custom headers as key-value pairs (authentication, content-type, etc.)
- Request body for POST/PUT/PATCH (agent formats JSON/form data)
- Structured response: status line + selected headers + body
- JSON auto-detection and pretty-printing (via content-type or content shape)
- Binary response rejection with helpful info (content-type, size, suggests curl)
- 4xx/5xx marked as `is_error` for agent error handling
- Configurable timeout (default 30s, max 120s) and response length (default 20K chars)

**Integration:**
- Registered in tool index (`src/tools/index.ts`) — available in main agent loop
- Added to delegate explore tools (`src/tools/delegate.ts`) — sub-agents can do API research
- Added to tool-retry policies (`src/tool-retry.ts`) — transient failures auto-retry
- System prompt updated with usage guidance (`src/system-prompt.ts`)

**Tests:** 22 new tests (`src/tools/http-request.test.ts`) covering input validation, all methods, response formatting, JSON handling, truncation, binary detection, error signaling, and header passthrough.

### Verified
- TypeScript typechecks clean
- Builds to 124KB bundle (up from 118KB)
- All 244 tests pass (222 existing + 22 new)
- `node dist/cli.js --help` runs correctly

### Future directions (treat skeptically)
- Python subprocess tool for data analysis / computation tasks
- Parallel task orchestration (the LLM can already issue parallel delegate calls via Promise.all, but explicit orchestration patterns could help)
- Conversation export / report generation for research deliverables

## Iteration 58 — Automated Metrics Collection and Builder Prompt Calibration

First improver iteration since #54 (which broke step.sh with a timeout wrapper).
Three sessions spanned iteration 57, one of which was a ghost session (0 output,
45 min wasted). The builder produced two good features (MCP client, delegate
execute mode) across the surviving sessions.

### Diagnosis

**Builder (iteration 57)**: Productive but operationally rough. Three sessions
were needed due to a ghost session and an interruption. Re-orientation overhead
was ~20 tool calls per restart. The features built (MCP client, write-capable
delegation) are strong architectural additions. 222 tests pass. However, all
57 iterations of features have focused exclusively on coding-agent infrastructure
(file editing, shell execution, error handling, tool retry, etc.). The prompt
says "general-purpose agent" but the evaluation loop only measures code-tool
quality. You evaluate what you measure.

**Improver (iteration 54)**: Caused real harm. The `timeout` wrapper caused
`claude` to get suspended (SIGTSTP/SIGTTIN), leading to silent failures across
multiple iterations until the boss manually fixed it. Lesson: test infrastructure
changes against the actual runtime environment before deploying.

### Changes

**1. Automated post-build metrics in `step.sh`** — After build-agent iterations
finish, step.sh now runs quick shell commands to populate src_files, src_lines,
bundle_bytes, test_files, tests_passed, and smoke_help. These were all `-` in
recent metrics.csv rows because the old step.sh only extracted cost/turns from
the session log. Now every build iteration produces a complete metrics row. Tests
are re-run via `npm test` and the count is parsed from vitest output (with ANSI
code stripping).

**2. Builder prompt: removed dead Haiku smoke test** — The `echo "Say hello" |
node dist/cli.js run --model claude-haiku-4-5-20251001` step consistently failed
because ANTHROPIC_API_KEY isn't available in the harness environment. The builder
wasted tool calls attempting it each iteration. Replaced with a simpler 3-level
verification (static, unit, load). The step.sh metrics collection now handles
smoke testing and test counting independently.

**3. Builder prompt: added capability reflection step** — Added step 6 between
verify and record that asks the builder to reflect on whether its feature makes
the agent more capable across domains or just refines coding infrastructure.
This is a soft nudge, not a mandate — both types of features are valid, but
the builder should be aware of the pattern.

### Expected effects

- metrics.csv will have complete data for all future build iterations
- The builder will stop wasting time on a broken smoke test
- The builder may start considering non-coding-tool features (uncertain — this
  is a weak intervention, but it costs nothing)

### Lessons from iteration 54's failure

My timeout wrapper broke the loop for multiple iterations. The root cause was
that `timeout` sends SIGTERM after a delay, but `claude` was getting SIGTSTP
first (because the terminal tried to read stdin). The fix (piping `/dev/null`
to stdin) was obvious in retrospect. I should have tested the change by
actually running step.sh once before committing. Infrastructure changes to the
harness need a higher bar than prompt changes.

### Future directions

- **Eval harness**: Run 2-3 simple tasks through the built agent after each
  iteration to measure actual capability, not just build health. Blocked on
  API key availability in the harness environment.
- **Session continuity**: When step.sh restarts the same iteration, inject a
  summary of prior sessions to avoid re-orientation. The boss removed context
  injection but this is a different case (same-iteration resume, not cross-
  iteration context).
- **Commit message cleanup**: step.sh pastes the first 5 lines of CHANGELOG
  as the commit message, which produces very long commit messages. Could
  extract just the heading.

## Iteration 57 — Write-Capable Sub-Agent Delegation

KOTA's `delegate` tool now has two modes: `explore` (default, read-only — unchanged) and `execute` (new — can modify files and run shell commands). This transforms the agent from a serial worker into a parallel orchestrator: the main agent can dispatch implementation subtasks to sub-agents that independently edit files, run builds/tests, and report what they changed.

### Why this improvement

The existing delegate tool is read-only — the agent can research in parallel but must do all implementation work sequentially in its own context. For complex tasks requiring changes across multiple files, this means every edit, test, and fix burns main-context tokens. With write-capable delegation, the main agent can say "fix the type errors in src/auth.ts" or "add the missing test cases" as delegated tasks. The sub-agent handles the implementation independently, reports which files it modified, and the main agent continues with a clean context.

This is the key architectural difference between a chatbot (does everything in one thread) and an orchestrator (decomposes and delegates work).

### What changed

- **`src/tools/delegate.ts`** (~240 lines, up from ~130): Added `mode` parameter. Execute mode provides `file_edit`, `file_write`, `multi_edit`, and `shell` (60s timeout cap) in addition to all explore-mode tools. Tracks modified files via `extractModifiedFiles()` and appends them to the result. Separate system prompts for each mode. Execute mode gets 15 turns (vs 10 for explore).
- **`src/tools/delegate.test.ts`** (~65 lines, new): 8 tests for `extractModifiedFiles` — covers file_edit, file_write, multi_edit (with both `path` and `file_path` fields), empty inputs, and read-only tools returning empty.
- **`src/system-prompt.ts`** (~46 lines): Added delegation guidance section. Broadened agent identity from "coding agent" to "general-purpose AI agent" covering research, analysis, writing, planning, data work, and automation.
- **`src/cli.ts`**: Updated description to "A general-purpose AI agent."
- **`DESIGN.md`**: Updated Sub-Agent Delegation section with two-mode architecture, file structure, line counts, and feature descriptions.

### Verified

- TypeScript type-checks clean
- Builds to 118.3KB bundle
- 15 test files, 222 tests pass
- CLI `--help` works correctly
- Runtime smoke test: agent initializes, registers tools, connects to API

### Future directions

- Multi-modal input (accept images via CLI, send as image content blocks — unlocks visual reasoning)
- Parallel delegation (dispatch multiple execute sub-agents concurrently via `Promise.all`)
- Delegation result streaming (stream sub-agent progress to stderr)
- Tool confirmation in execute mode (let the main agent approve/reject sub-agent tool calls)

## Manual fix — Remove timeout wrapper from step.sh

The `timeout` wrapper added in iteration 54 caused claude to get suspended
(SIGTSTP/SIGTTIN) when running in a terminal. A suspended process can't be
killed by `timeout`'s SIGTERM, so the loop would block for the full 45 minutes
doing nothing, then fail. Combined with `2>/dev/null` hiding all errors and
loop.sh advancing on failure instead of halting, this caused iterations 55–78
to silently burn through with zero output.

Fixes:
- Removed `timeout` and `MAX_STEP_SECONDS` — claude has its own max-turns
  limit; an external timer adds complexity and causes process-state bugs.
- Pipe `/dev/null` to stdin so claude never gets suspended trying to read
  the terminal.
- Stderr goes to `.stderr.log` instead of `/dev/null`.
- loop.sh halts on failure instead of advancing.
- Hardened `set -euo pipefail`-fragile pipelines with `|| true`.

## Iteration 54 — Session Timeout Guard

19th consecutive successful autonomous build (iterations 17–53). Process is
healthy. One infrastructure safety improvement.

### Diagnosis

**Builder (iteration 53)**: Strong. Built error context enrichment — a logical
completion of the shell diagnostics pipeline (iter 45). When errors reference
specific files, the surrounding source code is now pre-fetched automatically.
140 lines of new code, 22 new tests, clean integration (2 lines in shell.ts).
Cost: $2.45, 43 turns.

1. **Choice**: Good. Identified the remaining gap in the error-fix cycle (agent
   sees the error but still needs to read the file) and closed it.
2. **Research**: None needed — regex-based file:line parsing is standard.
3. **Verification**: All 4 levels. 196 tests across 12 files. CLI --help PASS.
4. **CHANGELOG**: Thorough — patterns, safety bounds, changes, next directions.
5. **Pattern**: The builder's last 5 features form a coherent error-handling
   pipeline. No weaknesses. The builder is self-directed and producing
   consistently high-quality work.

### Infrastructure improvement

The `claude -p` invocation in `step.sh` had no timeout. If the API hangs
(network partition, outage, stuck session), the loop blocks indefinitely with
no way to recover without manual intervention.

Fix: wrapped the `claude -p` call with `timeout $MAX_STEP_SECONDS` (default
2700s / 45 minutes, configurable via `MAX_STEP_SECONDS` env var). The longest
observed session is 639s (~10.6 min), so 45 minutes is 4× headroom — won't
interfere with normal builds. On timeout, exit code 124 is detected and logged
as `[step] claude TIMED OUT after 2700s (45m)` instead of the generic exit
status message.

### Self-reflection

The process is mature. 19 consecutive successes. The builder is autonomous,
costs are stable, features are well-scoped. The improver's role has
appropriately shifted from prompt engineering to infrastructure safety. This
change protects against an edge case (API hang) that hasn't occurred yet but
would require manual intervention when it does — a genuine gap in the harness.

## Iteration 53 — Error Context Enrichment

When a shell command fails with errors that reference specific files and line
numbers, KOTA now automatically pre-fetches the surrounding source code and
appends it to the error output. This saves the agent 1 turn per error cycle —
it can diagnose and fix without a separate `file_read`.

### Why this improvement

The agent's error-fix cycle is: see error → read referenced file → fix. The
middle step costs a full API turn (~$0.05-0.10 and 5-15 seconds). For a task
with 3-5 errors (common during test/build/lint), that's 3-5 wasted turns.

The shell-diagnostics module (iter 45) already extracts the *diagnostic lines*
from long output. But the agent still had to manually read the *source code*
those diagnostics reference. This improvement completes the pipeline: extract
the diagnostic, then pre-fetch the code it points to.

### How it works

After `smartErrorTruncate` processes the error output, `enrichWithSourceContext`
parses the result for file:line references and reads ±5 lines from each:

```
src/foo.ts(42,10): error TS2345: Argument not assignable
  ...
--- Referenced source ---
src/foo.ts:42:
  37: function doThing() {
  38:   const x = getValue();
  39:   if (!x) return;
  40:   const result = compute(x);
  41:   // process
> 42:   return result.unknownProp;
  43: }
```

**Supported patterns:**
- TypeScript: `file.ts(42,10): error` and `file.ts:42:10 - error`
- ESLint/Biome: `file.ts:42:10: error/warning`
- Node.js stack traces: `at fn (file.ts:42:10)` and `at file.ts:42:10`
- Python: `File "file.py", line 42`

**Safety bounds:**
- Max 5 file references per error
- ±5 lines context per reference
- Nearby references to same file (within 10 lines) are deduplicated
- Skips `node_modules/`, `dist/`, `.git/`, `coverage/`, URLs
- Only reads files that exist on disk

### Changes

- **New: `src/error-context.ts`** (~140 lines):
  - `extractFileReferences()`: Multi-pattern regex parser with deduplication
  - `readContextLines()`: Reads ±N lines with `>` marker on target
  - `enrichWithSourceContext()`: Combines extraction + reading + formatting

- **New: `src/error-context.test.ts`** (~225 lines, 22 tests):
  - `extractFileReferences`: TypeScript paren/colon, ESLint, Node.js stacks,
    Python, dedup, node_modules skip, dist skip, nonexistent skip, max limit,
    multi-file, URL skip, scoped packages
  - `readContextLines`: marker placement, start of file, end of file, missing
  - `enrichWithSourceContext`: context appending, no-ref passthrough,
    deduplication, multi-file

- **Modified: `src/tools/shell.ts`** (+2 lines):
  - Failed commands now call `enrichWithSourceContext(truncated)` after
    `smartErrorTruncate`

### Verification

- **Static**: `npm run typecheck && npm run build` — clean
- **Unit**: 196 tests across 13 files — all pass
- **Load**: `node dist/cli.js --help` — starts correctly
- **Runtime**: `echo "Say hello" | node dist/cli.js run` — exercises agent loop
  (auth error expected without API key, confirms no import/startup failures)

### Possible next directions

- Auto-suggest fixes based on common error patterns (e.g., "missing import" →
  suggest the import statement)
- Track which errors the agent has already seen to avoid re-reporting
- Extend enrichment to timeout errors (partial output may still have references)

## Iteration 52 — Atomic Metrics Commit

18th consecutive successful autonomous build (iterations 17–51). Process is
healthy. One infrastructure fix.

### Diagnosis

**Builder (iteration 51)**: Strong. Built two-phase context pruning — a
substantial feature (145-line module, 20 tests) that addresses a real gap in
the context lifecycle. Also proactively resolved the `loop.ts` file size
warning (299→271 lines) by extracting `system-prompt.ts`. Cost steady at $2.30,
34 turns.

1. **Choice**: Good. Selective pruning before full compaction is a well-reasoned
   design — the builder identified the gap between "full context" and "compacted
   summary" and filled it with an intermediate step.
2. **Research**: None needed — pruning heuristics are straightforward engineering.
3. **Verification**: All 4 levels. 174 tests across 11 files.
4. **CHANGELOG**: Thorough, with clear before/after scenarios.
5. **Pattern**: The builder continues to produce well-scoped, well-tested
   features. No weaknesses to address.

### Infrastructure fix

`step.sh` appended the metrics CSV row AFTER the auto-commit. This meant
every iteration left `metrics.csv` modified but uncommitted — the worktree
status always showed `M metrics.csv` as noise in the builder/improver's
injected context.

Fix: moved source metric calculation and CSV append to BEFORE the auto-commit.
The metrics row is now included in the commit. The logging section reuses the
pre-calculated variables. The worktree stays clean between iterations.

### Self-reflection

The improver has been making small, useful infrastructure tweaks for 8+
iterations. The process is mature — the builder is autonomous, costs are stable,
features are well-scoped. The diminishing returns principle applies. This
iteration's change is small but fixes a genuine long-standing annoyance rather
than adding yet another metric or warning.

## Iteration 51 — Selective Message Pruning

KOTA now has a two-phase context lifecycle: selective pruning at 50% context
usage, then full LLM-based compaction at 75%. This extends the agent's
effective working memory for complex tasks.

### Why this improvement

The existing compaction system is all-or-nothing. When context hits 75%, ALL
old messages get summarized via an LLM call, losing detailed tool results
forever. For complex tasks with many file reads, grep searches, and web
lookups, this means the agent loses specific information it might need shortly
after — forcing re-reads that waste turns and tokens.

The gap: between "full context" and "compacted summary" there was no
intermediate step. Now there is.

### How it works

When context budget exceeds 50%, the pruning pass scans messages older than
the most recent 20 for large (>1500 char) read-only tool results:
- `file_read`, `grep`, `glob`, `repo_map`, `web_fetch`, `web_search`,
  `delegate`

Each eligible result is replaced with a compact summary:
```
[Previously read: src/auth.ts — 150 lines. Re-read if needed.]
[Previous grep for "handleLogin" — ~12 lines. Re-grep if needed.]
[Previously fetched: https://docs.example.com. Re-fetch if needed.]
```

The agent knows what was there and can re-run the tool if needed. The
conversation structure stays intact — tool_use/tool_result pairs remain
valid. Only the content changes.

What pruning does NOT touch:
- Error results (diagnostic context is always preserved)
- Write/edit results (the agent needs to know what it changed)
- Shell output (builds, tests, commands — always preserved)
- Recent messages (within the last 20)
- Small results (<1500 chars — not worth the disruption)

### Changes

- **New: `src/message-pruning.ts`** (~145 lines):
  - `buildToolCallMap()`: Correlates tool_result IDs to tool names by scanning
    assistant messages for tool_use blocks
  - `generateSummary()`: Per-tool compact summaries with relevant metadata
    (path, pattern, URL, task)
  - `pruneMessages()`: Main function — identifies eligible results, replaces
    content, returns stats (count + chars saved)
  - Configurable via options: `keepRecent` (default 20), `minLength`
    (default 1500) for testability

- **New: `src/message-pruning.test.ts`** (~265 lines, 20 tests):
  - `buildToolCallMap`: extraction from assistant messages, skips user/string
  - `generateSummary`: per-tool summaries (file_read, grep, glob, web_fetch,
    web_search, delegate, repo_map), long pattern truncation
  - `pruneMessages`: threshold behavior, file_read pruning, error preservation,
    non-pruneable tool preservation, small result skip, recent message
    protection, multi-result stats, idempotency, batched tool results,
    mixed pruneable/non-pruneable in same message

- **New: `src/system-prompt.ts`** (~35 lines):
  - Extracted the `SYSTEM_PROMPT` constant from `loop.ts` to resolve the
    3-iteration-old file size warning (was 299 lines, now 271)

- **Modified: `src/context.ts`** (+13 lines):
  - New `maybePrune()` method: checks budget > 50%, delegates to
    `pruneMessages()`

- **Modified: `src/loop.ts`** (-28 lines net):
  - Calls `context.maybePrune()` before each turn's compaction check
  - Logs pruning stats when results are pruned
  - System prompt extracted to `system-prompt.ts` (271 lines, down from 299)

### Verification

- **Static**: `npm run typecheck && npm run build` — clean
- **Unit**: 174 tests pass (154 existing + 20 new) across 11 test files
- **Load**: `node dist/cli.js --help` — starts correctly
- **Runtime**: No API key available in environment; CLI handles gracefully

### What this means in practice

Before: An agent working on a 30-file refactoring hits 75% context after ~25
turns. Full compaction triggers, and the agent loses all file contents it read.
It spends 3-5 turns re-reading files it needs.

After: At 50%, pruning replaces old file_read/grep/glob results with one-line
summaries. This recovers enough tokens to push compaction back by 5-10 turns.
When compaction finally triggers, fewer details are lost because old results
were already trimmed. The agent gets more useful working turns.

### Next directions

- Track pruning metrics (how many tokens saved, how much compaction was
  delayed) to validate the improvement empirically
- Consider priority-based pruning: prune web_fetch/web_search first (least
  likely to be re-needed), then grep/glob, then file_read last
- Adaptive threshold: lower the 50% trigger if the agent's task looks
  long-running (many todos, many files to modify)

## Iteration 50 — Metrics Header Simplification

17th consecutive successful autonomous build (iterations 17–49). Process is
healthy. One infrastructure simplification.

### Diagnosis

**Builder (iteration 49)**: Strong. Built automatic tool retry — a practical,
well-scoped feature (90-line module, 19 tests, 8 lines of integration) that
addresses real turn waste from transient failures. Properly scoped to the main
loop only. Cost dropped from $2.66 to $2.01 and turns from 49 to 35.

1. **Choice**: Good. Transient retries save real turns; identified a concrete
   cost pattern and built a clean solution.
2. **Research**: None needed — retry with backoff is well-understood.
3. **Verification**: All 4 levels. 154 tests across 10 files.
4. **CHANGELOG**: Thorough with before/after examples.
5. **Pattern**: No weaknesses. Fully autonomous for 17 consecutive builds.

**Metrics trend** (last 6 build iterations):
- Duration: 338→435→534→465→491→440s (stable ~450s)
- Tests: 68→75→99→121→135→154 (monotonic increase)
- Coverage: 5/30→6/31→7/32→8/33→9/33→10/34 (29%)
- Source: 3997→4169→4556→4962→5182→5447 lines
- Bundle: 84.6K→87.9K→92.4K→97.2K→99.1K→101.2K
- Cost/turns: $2.66/49→$2.01/35 (improving efficiency)

**File size note**: `src/loop.ts` still at 299 lines (unchanged for 3
iterations). `src/tools/file-edit.ts` at 274 lines. The step.sh warnings are
visible and the builder should handle splitting autonomously.

### Self-reflection

My last 4 iterations were all "add a metric" improvements (test coverage →
file size warning → session metrics → output tokens). Each was marginally
useful but the pattern shows a comfort zone: metrics are safe, non-controversial,
and always arguably useful. The marginal value is decreasing. This iteration I
chose restraint — one small infrastructure fix instead of another metric.

### Change

Simplified the metrics CSV header migration in `step.sh`. The old approach used
cascading if-elif branches (one per column addition) that needed manual
extension for each new column. A bug existed: if two columns were added in one
iteration, only one elif branch would execute.

Replaced with an idempotent approach: define the expected header once, overwrite
line 1 if it doesn't match. Future column additions only need to update the
`EXPECTED_HEADER` variable — no new migration branch needed.

## Iteration 49 — Automatic Tool Retry

When a tool call fails with a transient error (shell timeout, network reset,
HTTP 429/5xx), KOTA now automatically retries once with adjusted parameters
instead of reporting the error to the LLM. This saves 1-2 turns per transient
failure — the agent gets the result in the same turn without having to diagnose
the failure and manually retry.

### Why this improvement

Transient failures are a common turn-waster. The typical sequence: a build
command times out at the default 120s limit, the error goes back to the LLM,
the LLM decides to retry with a longer timeout (1 turn), the retry succeeds
(1 turn). Two turns spent on a problem the tool runner could handle
automatically. Same pattern for web fetches hitting a transient 502 or network
reset — the agent wastes a turn re-issuing the same request.

### Changes

- **New: `src/tool-retry.ts`** (~90 lines):
  - Per-tool retry policies with error pattern matching and input adjustment
  - **Shell**: Retries on timeout patterns with 2× the timeout (capped at 300s).
    Only retries when the doubled timeout fits within the cap — if the agent
    already set a long timeout, it won't be doubled further.
  - **Web fetch/search**: Retries on transient network errors (ECONNRESET,
    ETIMEDOUT, ECONNREFUSED, socket hang up) and transient HTTP codes
    (429, 500, 502, 503, 504) after a 1.5s delay.
  - No retry for permanent errors: 404, file not found, syntax errors, auth
    failures, input validation errors.
  - `maybeRetry()` function: takes the tool name, input, failed result, and a
    runner function. Returns the retry result or null if no retry applies.
  - On retry success: appends "(Succeeded on auto-retry: reason)" to the result.
  - On double failure: appends both errors so the agent has full context.

- **New: `src/tool-retry.test.ts`** (~135 lines, 19 tests):
  - Shell policy: timeout detection (multiple message formats), timeout cap
    enforcement, non-timeout rejection, input doubling, custom timeout doubling
  - Web fetch policy: transient network errors, transient HTTP codes, permanent
    error rejection (404, 403, validation errors)
  - Web search policy: same pattern coverage
  - `maybeRetry` integration: no-policy tools return null, non-matching errors
    return null, successful retry, double failure with combined message,
    web retry with delay (using fake timers), input passthrough for web tools

- **Modified: `src/tool-runner.ts`** (+8 lines):
  - After tool execution, if the result is an error, passes it through
    `maybeRetry`. If retry succeeds, the retried result replaces the original.
  - Retry is scoped to the main loop only — delegate sub-agents use
    `executeTool` directly without retry, preserving their bounded behavior.

### What the agent sees

Before (shell timeout):
```
output...\n\n(killed: timeout after 120000ms)
```
Agent spends 1-2 turns deciding to retry with a longer timeout.

After (auto-retry):
```
[kota] Auto-retrying shell (timeout → 240s)...
$ npm test
... all tests pass ...

(Succeeded on auto-retry: timeout → 240s)
```
The agent gets the result immediately. Zero turns wasted.

### Verification

- **Static**: `npm run typecheck && npm run build` — clean
- **Unit**: 154 tests across 10 files — all pass (19 new tests)
- **Load**: `node dist/cli.js --help` — starts without errors
- **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001` — auth error expected (no key), but no import/startup crashes
- **Bundle**: 98.8KB (slight decrease from 99.1KB — build variance)

### Possible next directions

- **Package manager rewriting**: When the agent runs `npm test` but the project
  uses pnpm, auto-rewrite the command. The verify-tracker already detects the
  package manager.
- **Split `loop.ts`**: At 299 lines, one line from the limit. System prompt
  could move to a dedicated module to free space.
- **File read deduplication**: Track recent reads and annotate duplicates to
  save tokens during compaction.
- **Tool usage analytics**: Track per-tool success rates and latency to identify
  bottlenecks and inform system prompt improvements.

## Iteration 48 — Output Token Tracking

16th consecutive successful autonomous build (iterations 17–47). Process is
healthy. One observability improvement added.

### Diagnosis

**Builder (iteration 47)**: Strong. Built whitespace-tolerant file edit — a
high-leverage improvement targeting the #1 `file_edit` failure mode. Also added
efficiency guidance to the system prompt. 135 tests (+14 new), all checks pass.
CHANGELOG is thorough with before/after examples.

1. **Choice**: Good. Identified the most common edit failure mode and auto-fixed
   it. Practical, well-scoped, high leverage.
2. **Research**: None needed — string matching patterns are well-known.
3. **Verification**: All 4 levels. 135 tests across 9 files.
4. **CHANGELOG**: Detailed with concrete before/after examples.
5. **Pattern**: No weaknesses. Fully autonomous.

**Metrics trend** (last 5 build iterations):
- Duration: 338→435→534→465→491s (stable ~470s)
- Tests: 68→75→99→121→135 (steady growth)
- Coverage: 5/30→6/31→7/32→8/33→9/33 (27%)
- Source: 3997→4169→4556→4962→5182 lines
- Bundle: 84.6K→87.9K→92.4K→97.2K→99.1K
- Cost/turns: $2.66/49 (first data point, no trend yet)

**File size note**: `src/loop.ts` is at 299 lines (1 line from limit).
`src/tools/file-edit.ts` at 274 lines. The step.sh warnings are visible and
the builder should handle splitting autonomously.

### Change

**step.sh** — Added `output_tokens` extraction from JSON output and appended as
a new column in metrics CSV. The JSON output from `claude -p` includes
`usage.output_tokens` which measures how much work the builder writes per
iteration. Combined with `num_turns`, this reveals tokens-per-turn efficiency:
are iterations getting more verbose as the codebase grows, or is the builder
staying efficient?

Header migration handles existing CSV files that lack the new column.

### Expected effect

The improver gains a new signal: output tokens per iteration. Over time this
enables tracking whether the builder is becoming more or less efficient as the
codebase grows. For iter 47, the JSON shows 22,093 output tokens across 49
turns (~450 tokens/turn). Future iterations can be compared against this
baseline.

## Iteration 47 — Whitespace-Tolerant File Edit

When the agent's `file_edit` fails because of indentation or whitespace
differences (tabs vs spaces, wrong indent level, trailing spaces), KOTA now
automatically detects and corrects the mismatch instead of returning an error.
This eliminates the most common `file_edit` failure mode: the agent knows the
right content but gets the whitespace wrong, then wastes 1-2 turns re-reading
the file and retrying.

### Why this improvement

Whitespace mismatches are the #1 cause of `file_edit` failures. The typical
sequence: agent reads a file, constructs an edit, but gets the indentation
slightly wrong (tabs instead of spaces, 2-space instead of 4-space indent,
trailing whitespace). The exact match fails, the agent re-reads the file (1
turn), then retries the edit with corrected whitespace (1 turn). Two turns
wasted on a problem the tool could solve automatically.

### Changes

- **Modified: `src/tools/file-edit.ts`** (197 → 274 lines, +77):
  - `normalizeWhitespace(s)`: Trims each line, collapses consecutive blank
    lines, trims the whole string. Produces a canonical form for comparison.
  - `tryWhitespaceMatch(content, oldStr)`: Tries whitespace-normalized matching
    with a sliding window over file lines. Returns the exact file region if an
    unambiguous match is found, null otherwise.
    - Safety: requires at least 10 non-whitespace characters (prevents trivial
      matches like `}`). Returns null on ambiguous matches (>1 region matches).
    - Variable window sizes (normLineCount to normLineCount+4) to handle blank
      lines that appear in one version but not the other.
  - In `runFileEdit`: after exact match fails (count === 0), tries
    `tryWhitespaceMatch` before falling through to the existing fuzzy error.
    On success: applies the edit, runs lint gate, prints diff, returns success
    message noting the whitespace correction.

- **New: `src/tools/file-edit.test.ts`** (~137 lines, 14 tests):
  - `normalizeWhitespace`: trim+collapse, tabs/mixed whitespace, empty input,
    single line
  - `tryWhitespaceMatch`: tabs vs spaces, different indent levels, trailing
    whitespace, non-matching content, ambiguous matches (multiple regions),
    too-short search strings, single-line mismatch, multi-line with extra blank
    lines, file shorter than search, exact region preservation

- **Modified: `src/loop.ts`** (+5 lines):
  - Added "Efficiency" section to system prompt with tool batching guidance:
    batch independent reads/greps, start with repo_map, use delegate for
    exploration. This is a zero-cost improvement — pure text guidance that
    helps the agent use fewer turns.

### What the agent sees

Before (whitespace mismatch):
```
Error: old_string not found in src/config.ts.

Closest match (92% similar) near line 15:
>>>   15:     const timeout = 5000;
>>>   16:     const retries = 3;

Check for whitespace/indentation differences...
```
Agent then re-reads the file, retries the edit. 2 turns wasted.

After (same mismatch):
```
Applied with whitespace correction at line 15 in src/config.ts.
(Indentation/whitespace in old_string didn't match exactly, but content matched.)
```
Edit applied. 0 turns wasted.

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 135 tests pass across 9 files (121 existing + 14 new)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error expected (no API key), loop starts correctly

### Possible next directions

- Turn efficiency metrics: track tool calls per turn, detect when the agent is
  being inefficient and inject guidance
- Git diff tool: show uncommitted changes for reviewing session work
- Session summary on exit: print what files were modified, commands run, errors
  encountered

## Iteration 46 — Structured Session Metrics

15th consecutive successful autonomous build (iterations 17–45). Process is
healthy. One observability improvement added.

### Diagnosis

**Builder (iteration 45)**: Strong. Built shell error diagnostics — a practical
feature (165-line module, 22 tests) that directly improves the agent's feedback
loop. Duration actually decreased (534s → 465s) despite significant code
addition. 121 tests pass across 8 files. All verification levels clean.
CHANGELOG is detailed with before/after examples.

1. **Choice**: Good. Identified that naive output truncation loses diagnostic
   info, built format-specific extractors. Practical, well-scoped.
2. **Research**: None needed — output parsing patterns are well-known.
3. **Verification**: All 4 levels. 121 tests (22 new).
4. **CHANGELOG**: Thorough and honest with concrete examples.
5. **Pattern**: No weaknesses. Fully autonomous.

**Metrics trend** (last 4 build iterations):
- Duration: 338s → 435s → 534s → 465s (efficiency improved)
- Tests: 68 → 75 → 99 → 121 (strong growth, +22 this iter)
- Coverage: 5/30 → 6/31 → 7/32 → 8/33 (17% → 19% → 22% → 24%)
- Source: 3997 → 4169 → 4556 → 4962 lines
- Bundle: 84.6K → 87.9K → 92.4K → 97.2K

**Self-reflection**: The output logs have been thin — only 28 lines for iter 45
(just the final summary text). No visibility into cost, turn count, or tool
usage. This limits diagnostic capability for the improver.

### Change

**step.sh** — Switched from `--output-format text` (default) to
`--output-format json`. The JSON output from `claude -p` includes structured
fields like `cost_usd`, `num_turns`, and `session_id` alongside the result
text. A single `node` invocation extracts the text result (for the backward-
compatible `.output.txt` log) and session metrics.

New data captured:
- **`cost_usd`**: API cost per iteration → track economics
- **`num_turns`**: conversation turns → measure efficiency (fewer turns = better
  tool use and planning)
- **`session_id`**: enables `claude -r <id>` to resume/inspect a session
- **JSON log file**: full structured output saved as `.json` alongside
  `.output.txt` and `.prompt.md`

Metrics CSV updated with `cost_usd` and `num_turns` columns. Header migration
handles both the old format (no test columns) and the intermediate format (test
columns but no cost columns).

### Expected effect

The improver gets quantitative signals about builder efficiency: cost per
iteration and turns per iteration. Combined with duration and diff size, this
enables real analysis of whether the builder is getting more efficient as the
codebase grows. The JSON log also preserves the full structured response for
future analysis tools.

## Iteration 45 — Shell Error Diagnostics

When shell commands fail with long output, KOTA now extracts the most
diagnostic-relevant lines instead of using naive head+tail truncation. This
directly improves the agent's ability to diagnose and fix test failures, build
errors, and lint issues on the first try.

### Why this improvement

Shell commands are the agent's primary verification tool. When `npm test` or
`tsc --noEmit` fails, the output can be thousands of lines — mostly passing
tests or build progress, with the actual errors buried in the middle. The
existing truncation (first 10K + last 5K chars) often cuts exactly the lines
the agent needs to see. The result: the agent guesses what went wrong, makes a
bad fix, fails again, and wastes turns. Better error extraction means fewer
wasted turns and faster issue resolution.

### Changes

- **New module: `src/shell-diagnostics.ts`** (~165 lines):
  - `smartErrorTruncate(output, limit)`: Main entry point. Short output (<8K)
    returned as-is. Long output gets format-specific error extraction with
    fallback to head+tail.
  - `extractTscErrors`: Detects TypeScript compiler output in both
    `file(line,col)` and `file:line:col` formats. Deduplicates errors, caps at
    40.
  - `extractTestFailures`: Detects vitest/jest/mocha patterns — `FAIL`
    markers, `×`/`✗`/`●` bullets, assertion errors, `Expected`/`Received`
    blocks. Captures failure regions with 10 lines of context each. Also grabs
    summary lines (`Tests: N failed | M passed`).
  - `extractLintErrors`: Detects ESLint `file:line:col: error` format and
    Biome `×` markers. Prioritizes errors over warnings.
  - `extractGenericErrors`: Matches `Error:`, `FAILED`, `fatal:`, `panic:`,
    `command not found`, `Permission denied` with 1+3 lines of context.

- **New tests: `src/shell-diagnostics.test.ts`** (~175 lines, 22 tests):
  - `smartErrorTruncate`: short passthrough, tsc extraction from padded
    output, head+tail fallback, under-limit passthrough
  - `extractTscErrors`: parenthesized format, colon format, deduplication,
    non-tsc rejection
  - `extractTestFailures`: vitest-style, jest-style, summary capture, non-test
    rejection
  - `extractLintErrors`: eslint format, biome markers, error/warning priority,
    clean rejection
  - `extractGenericErrors`: Error lines with context, multiple regions,
    command not found, Permission denied, FAILED, clean rejection

- **Modified: `src/tools/shell.ts`** (+2 lines):
  - Failed commands now use `smartErrorTruncate` instead of `truncateOutput`
  - Successful commands still use the original truncation (no behavior change)

### What the agent sees

Before (long test output, 15K+ chars):
```
... first 10K of passing tests ...
... [truncated] ...
... last 5K (maybe summary, maybe not) ...
```

After (same output):
```
[Extracted 3 diagnostic(s) from 15234 chars]

Test failures:

 × src/foo.test.ts > should handle edge case
   AssertionError: expected 42 to be 43
     - Expected: 43
     + Received: 42

--- Output tail ---
Tests  1 failed | 50 passed
```

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 121 tests pass across 8 files (99 existing + 22 new)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error expected (no API key), loop starts correctly

### Possible next directions

- Add extractors for more formats (cargo, go test, pytest) as needed
- Adaptive extraction threshold based on context budget (extract more
  aggressively when budget is tight)

## Iteration 44 — Early File Size Warning

14th consecutive successful autonomous build (iterations 17–43). Process is
healthy. One infrastructure improvement added.

### Diagnosis

**Builder (iteration 43)**: Strong. Built the verification nudge system — a
substantial feature (155-line module, 24 tests) that addresses a real agent
failure mode. 99 tests pass across 7 files. All verification levels clean.
CHANGELOG is detailed and honest.

1. **Choice**: Good. Identified the #1 agent failure mode (skipping
   verification) and built a systemic fix rather than just adding a prompt hint.
2. **Research**: None needed — well-known pattern.
3. **Verification**: All 4 levels. 99 tests (24 new).
4. **CHANGELOG**: Thorough and accurate.
5. **Pattern**: No weaknesses. Fully autonomous.

**Metrics trend** (last 3 build iterations):
- Duration: 338s → 435s → 534s (increasing, but codebase also grew 14%)
- Tests: 68 → 75 → 99 (strong growth)
- Coverage: 5/28 → 6/31 → 7/32 (17% → 19% → 21%, slow but steady)
- Source: 3997 → 4169 → 4556 lines
- Bundle: 84.6K → 87.9K → 92.4K

**Self-reflection**: Recent improve-process iterations (36–42) have all been
small infrastructure improvements. This is appropriate for a healthy, mature
process. No prompt changes needed.

### Change

**step.sh** — Added "approaching limit" file size warnings. The existing check
only flags files OVER 300 lines; this now also flags files between 240–300
lines with a `[step] NOTE:` message. Currently loop.ts is at ~295 lines — the
builder will see this warning and know to plan for splitting before hitting the
hard limit. Single `find ... wc` pass serves both checks (no extra I/O).

### Expected effect

The builder gets advance notice about files approaching the 300-line limit,
allowing it to plan refactoring proactively rather than being forced to split
mid-feature when a file exceeds the limit.

## Iteration 43 — Verification Nudge System

KOTA now tracks which files have been edited but not verified, and nudges the
agent to run tests/builds before continuing. This addresses the #1 agent
failure mode: making changes without verifying they work.

### Why this improvement

The system prompt says "verify they work" after making changes, but LLMs
routinely skip verification to move faster. The result: edits that pass syntax
checks (linter gate) but fail type checks or tests, leading to cascading errors
that waste many turns to diagnose. Every major agent framework struggles with
this. Instead of relying on the model's discipline, KOTA now makes unverified
edits visible in the system prompt — the agent literally sees "Unverified
edits: src/foo.ts" every turn until it runs a verification command.

### Changes

- **New module: `src/verify-tracker.ts`** (~130 lines):
  - `detectVerifyCommands(cwd)`: Reads package.json (scripts), Makefile
    (targets), Cargo.toml, and pyproject.toml to discover available
    verification commands. Auto-detects package manager (pnpm/yarn/npm) from
    lock files.
  - `isVerifyCommand(cmd)`: Recognizes 13 patterns of verification commands
    across npm/pnpm/yarn, cargo, pytest, go, make, tsc, vitest, jest, biome,
    and eslint.
  - `VerifyTracker` class: Tracks edited files and verification status.
    - `recordEdit(path)`: marks a file as modified
    - `checkShellCommand(cmd)`: clears unverified files if command is verify
    - `tick()`: advances turn counter for escalation
    - `getState()`: returns dynamic prompt text showing unverified files,
      available commands, and escalating nudges

- **New tests: `src/verify-tracker.test.ts`** (~165 lines, 24 tests):
  - VerifyTracker: empty state, edit tracking, deduplication, verification
    clearing, non-verify pass-through, command display, turn-based escalation,
    reset on verify, file limit
  - isVerifyCommand: npm/pnpm/yarn, cargo, python, go, make, standalone
    tools, rejection of non-verify commands
  - detectVerifyCommands: nonexistent path, real project detection

- **`src/loop.ts`** (~295 lines, +30):
  - Creates VerifyTracker at session start with auto-detected commands
  - After tool execution, scans tool blocks: records file edits, checks shell
    commands for verification
  - Appends tracker state to dynamic system prompt block (uncached, so no
    prompt caching disruption)

### What the agent sees

After editing `src/foo.ts` without running tests:
```
[Unverified edits: src/foo.ts]
[Verify with: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`]
```

After 3 turns without verification:
```
[Consider verifying before making more changes]
```

After running `npm test`:
→ state clears, nudge disappears.

### Verification

1. **Static**: `npm run typecheck && npm run build` — clean
2. **Unit**: `npm test` — 99 tests pass across 7 files (75 existing + 24 new)
3. **Load**: `node dist/cli.js --help` — works
4. **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
   — auth error expected (no API key), loop starts correctly

### Possible next directions

- Auto-run a fast verification command (like `tsc --noEmit`) after edits
  instead of just nudging — with a timeout guard for slow test suites
- Make verify tracker state persist across compaction (currently resets)
- Add `diff.ts` and `lint.ts` test coverage
- Consider a `batch_read` tool for reading multiple files in one call

## Iteration 42 — Test Coverage Metric

13th consecutive successful autonomous build (iterations 17–41). Process is
healthy. One observability improvement added.

### Diagnosis

**Builder (iteration 41)**: Strong. Three coherent improvements: `ask_user`
tool for interactive collaboration, grep context lines, and web tools for
delegated sub-agents. 75 tests pass (7 new). All verification levels.
Honest CHANGELOG. 13th consecutive autonomous success.

1. **Choice**: Good. Identified real capability gaps independently.
2. **Research**: None needed — well-known patterns.
3. **Verification**: All 4 levels. 75 tests across 6 files.
4. **CHANGELOG**: Detailed and accurate.
5. **Pattern**: No weaknesses. Fully autonomous.

**Self-reflection**: My iter 40 fix (NO_COLOR=1) was correct and minimal.
Process has been stable. No prompt changes needed.

### Change

**step.sh** — Added test coverage ratio to smoke test output. After reporting
test file count and pass count, step.sh now also reports
`Test coverage: 6/31 source files (19%)`. This gives the improver a clear
trend signal for test coverage without manual calculation. The ratio excludes
test files from the denominator so it accurately reflects which production
source files have corresponding tests.

### Expected effect

The improver can now track test coverage trends across iterations directly from
the metrics output, making it easier to identify when the coverage ratio is
stagnating or improving.

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
