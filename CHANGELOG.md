# KOTA Changelog

## Iteration 598 — Divergent-convergent brainstorming to break feature concentration

Restructured builder brainstorming into explicit diverge/converge phases with named categories, addressing persistent 8/10 feature concentration despite 4 iterations of warnings.

**Intervention verdicts:**
- Iter 596 DESIGN.md signal: **EFFECTIVE** — builder condensed 1287→884 (-31%)
- Iter 596 DESIGN.md signal: **SIDE EFFECT** — bulk condensation consumed 30/90
  calls, drove rework to 76%. Updated BUILDER_LESSONS for incremental approach.
- Iter 594 frontier question: **NOT STICKY** — worked once (595) but builder
  reverted to features in 597, rationalizing ToolTelemetry as "architecture."

**What changed:**
- `prompts/build-agent.md` — Brainstorm section restructured: Phase 1 (diverge)
  requires candidates across three named categories (new capability, deepen
  existing, architecture). Phase 2 (converge) evaluates. Removed stale examples
  (in prompt for 4 iters, didn't affect concentration). Net -12 lines.
- `BUILDER_LESSONS.md` — DESIGN.md size lesson updated with iter 597 data:
  condense only sections you're modifying, not bulk cleanup.
- `prompts/improvement-thesis.md` — New research (CreativeDC, CHI 2025 Artificial
  Hivemind, AlphaEvolve dual sampling), updated verdicts and pattern watch.

**Research:** CreativeDC (arXiv:2512.23601) — divergent-convergent ideation
prevents mode-collapse. CHI 2025 — RLHF models converge to average responses.
AlphaEvolve — parent+inspiration dual sampling across feature bins.

### Candidates considered
- Diverge/converge brainstorming — CHOSEN. Structural process change.
- EXIF-style scout pass before ideation — promising but higher complexity
- AlphaEvolve-style work-type bins in trend output — needs iteration history DB
- Strengthen concentration warning language — proven ineffective (4 attempts)
- Parse-log.py rework attribution fix — low impact, DESIGN.md was the cause

### Expected effects
- Builder generates candidates in all three categories before selecting
- Feature concentration decreases from 8/10 toward more balanced distribution
- No cost or complexity increase (prompt is actually shorter)

## Iteration 597 — Tool execution telemetry + DESIGN.md condensation

Added ToolTelemetry — session-scoped instrumentation tracking per-tool timing, success/failure rates, and error patterns. Integrated into the tool runner so every tool call is automatically timed. Compact summary surfaces in dynamic system state (`<tool-metrics>` tag) for agent self-awareness. `tool_metric` transport events for operator visibility.

Also condensed DESIGN.md from 1287 → 884 lines (-31%), well under the 1100-line target. Compressed 13 stable tool/module sections to 1-3 line summaries without losing architectural information.

### What changed
- `src/tool-telemetry.ts` — ToolTelemetry class with record/stats/summary + singleton management
- `src/tool-runner.ts` — timing wrapper around tool execution, records to telemetry
- `src/transport.ts` — new `tool_metric` event type
- `src/loop.ts` — telemetry summary in dynamic state, reset on session close
- `src/tool-telemetry.test.ts` — 20 tests (unit + integration through executeToolCalls)
- `DESIGN.md` — condensed 13 sections, added telemetry section (1287 → 884 lines)

### Candidates considered
- DESIGN.md condensation only — needed but not capability-expanding
- Provider swap validation tests — hardening but narrow scope
- Per-tool execution timeout — tools already handle their own timeouts
- Composition primitive nesting tests — 3411 tests already cover basics
- Module lifecycle improvements — no current pain point

### Verification
typecheck ✓, build ✓, 3431 tests pass (+20 new), lint ✓, load ✓, runtime SKIP (no key)

### Future directions
- Surface telemetry in agent's tool selection heuristics (adaptive tool routing)
- Add p95/p99 latency tracking for performance regression detection
- Tool performance history across sessions (persistent telemetry)

## Iteration 596 — DESIGN.md growth signal + test delta fix in trend output

Added DESIGN.md line count health check to parse-log.py trend output, surfacing document growth as a concrete data signal. Fixed test delta extraction regex to handle "N tests pass (+M new)" format (iter 595 showed "?" instead of "+9").

Iter 594 frontier framing verdict: EFFECTIVE — builder chose E2E hardening in iter 595.

DESIGN.md at 1287 lines (target: 1100, +17% over). Growing 3-6 lines/iter. Per proven pattern "data > instructions" (iters 590-594), the builder responds to trend output signals. Adding line count + over-target warning follows the same approach that fixed domain/work-type concentration.

### Candidates considered
- Surface specific stale modules in trend — useful but more complex, deferred
- Modernize depth coverage metric (100+ iters stale) — lower urgency
- Improve frontier question examples — already working

### Expected effects
- Builder notices DESIGN.md is 17% over limit and condenses during next update
- Test delta for iter 595 correctly shows +9 (trend data quality restored)

## Iteration 595 — E2E tests for module infrastructure: proving 20+ iterations of module work compose end-to-end

Added 9 E2E tests exercising the full module pipeline through AgentSession.send() — module loader, tool registration, tool execution, working memory→system prompt injection, event bus lifecycle, and multi-module composition. Hardening work addressing the owner's request for E2E testing of the event-driven system.

### What changed
- `src/module-e2e.test.ts` — 9 tests across 5 scenarios: module tool registration, working memory in system prompt, event bus integration, multi-module composition, prompt section injection
- Proves module tools appear in API calls alongside core tools
- Proves working memory entries propagate into the dynamic system prompt across turns
- Proves event bus lifecycle events fire with module connections active
- Proves module + core tools compose in multi-step workflows

### Candidates considered
- Expand provider system (TaskProvider) — architecture, but lower urgency than validating existing infra
- Config schema validation — useful but narrower impact
- Module dependency resolution — premature without proving current system works E2E
- Structured error propagation through composition — deferred

### Verification
typecheck ✓ | build ✓ | 3411 tests pass (+9) | lint ✓ | load ✓ | runtime SKIP (no API key)

### Future directions
- E2E tests for knowledge store CRUD through the agent loop (needs temp .kota/data setup)
- E2E tests for module factory → runtime module creation → tool execution
- E2E tests for provider swapping (register alternate provider, verify tool behavior changes)

## Iteration 594 — Work-type concentration signal + capability frontier framing in builder prompt

Added work-type diversity tracking (feature vs architecture) to trend output, closing the last major data gap in builder steering. Builder prompt reframed from domain-avoidance to frontier expansion.

**Intervention verdicts:**
- Iter 592 domain tracking: **PARTIALLY EFFECTIVE**. Builder chose modules in 593 (broke tools streak). But 10-iter: 6 modules + 4 tools = 100% in 2 domains, 8/10 feature work. Builder ping-pongs between familiar domains.

**Changes:**
- `parse-log.py`: Work pattern line now warns when feature work ≥70% of recent iterations (like Domains line warns for domain concentration)
- `prompts/build-agent.md`: Added reference to Work pattern line. Replaced domain-only avoidance with "capability frontier" framing: "What can this agent almost-but-not-quite do?" — surfaces architecture/composition/hardening naturally
- Prompt: 114→113 lines (slightly shorter)

**Candidates considered:**
1. Work-type warning + frontier framing — CHOSEN. Addresses obvious data gap + reframes evaluation positively
2. Capability frontier scenarios file — too prescriptive, risks mechanical procedure anti-pattern
3. UCT-style work type rotation — too mechanical
4. Metacognitive capability portfolio tracking — high complexity for unclear payoff
5. Define end-to-end scenario tests — good but builder-domain work

**Research:** CURATE (ICML 2025) — pick easiest unsolved task at competence boundary → naturally diversifies work types. Metacognitive Learning (ICML 2025, arXiv 2506.05109) — track capability portfolio, not just task completion.

**Expected:** Builder sees "feature work: 4/5 iters CONCENTRATED" + frontier question → chooses architecture/composition/hardening in iter 595.

## Iteration 593 — Working memory module: agent-controlled scratchpad visible in system prompt every turn

Built a working memory module inspired by Letta/MemGPT's memory blocks. The agent gets named entries that appear in `<working-memory>` tags in the dynamic system prompt each turn — no re-reading needed. Enables research accumulation, multi-step plan tracking, and cross-turn state during long conversations.

### What changed
- `src/working-memory.ts` — Singleton store (Map-based, session-scoped). Limits: 20 entries, 500 chars/value, 4000 chars total
- `src/modules/working-memory.ts` — Module providing `working_memory` tool (write/read/list/remove/clear)
- Dynamic prompt integration via `getWorkingMemoryState()` in loop.ts (same pattern as todos/verify tracker)
- 24 new tests covering store operations, size limits, tool actions, and prompt rendering

### Candidates considered
- Module dependency resolution — incremental improvement, not new capability
- Durable workflow engine — high complexity, deferred
- Knowledge store query/filter — approximated by existing tools
- HTTP client tool — tools domain saturated (4/5 recent iters)

### Verification
typecheck ✓ | build ✓ | 3402 tests pass (+24) | lint ✓ | load ✓ | runtime SKIP (no API key)

### Future directions
- Persistent working memory (opt-in save to module storage across sessions)
- Size-aware auto-summarization when approaching limits
- Integration with observation masking to auto-promote masked content into working memory

## Iteration 592 — Domain-level concentration tracking closes subsystem-granularity loophole

Added domain grouping (tools, modules, architecture, other) on top of subsystem classification in parse-log.py trend. Iter 590's subsystem tracking was only partially effective: builder broke the tools/orch streak by shifting to tools/routing (iter 591) but stayed in the tools domain (4/5 recent). The fine-grained subsystem labels let the builder appear to diversify while concentrating. Domain-level frequency now shown in trend + builder prompt updated to reference it. Research-backed: Self-Play Information Gain (arXiv:2603.02218) — without explicit diversity tracking, systems drift to repetitive work; Verbalized Sampling (arXiv:2510.01171) — explicit variation requests counteract narrowing.

Other candidates: information-gain reframing of eval criterion (abstract, harder to operationalize), verbalized diversity injection in brainstorming (complementary — can add later), DESIGN.md compression (maintenance, lower impact), BUILDER_LESSONS update for batch registration (builder already handled it).

Expected effects: builder sees "tools domain: 5/10 iters (nearing saturation)" alongside subsystem detail. Shifting between tools/* subsystems no longer hides concentration. Next builder iteration should choose modules or architecture domain.

## Iteration 591 — Refined progressive disclosure: moved 9 specialized tools from always-on core to context-sensitive groups

Reduced default tool set from 22 to 13 core tools by moving specialized tools to auto-detected groups. Research shows LLMs make better tool selections with fewer options exposed (70% faster decisions per tool-calling optimization studies).

### What changed
- New `gui` group: computer_use, screenshot, view_image, clipboard — auto-enabled for visual/screen keywords
- New `orchestration` group: batch, pipe, map — auto-enabled for parallel/sequential composition keywords
- Moved `notify` → management group, `sqlite` → code group (with sql/sqlite auto-detection)
- Updated task-router: research/data_analysis/automation tasks auto-enable orchestration group
- System prompt updated to list all 6 groups; tool categories reorganized

### Candidates considered
- Durable workflow engine — persistent multi-step processes. Complex to scope; deferred
- Composition integration tests — testing, not new capability. Lower user-facing impact
- Memory blocks / structured context (Letta-inspired) — significant refactor needed
- Trajectory compression — improve observation masking with summaries. Deferred

### Verification
typecheck ✓ | build ✓ | 3378 tests pass (+10) | lint ✓ | load ✓ | runtime SKIP (no API key)

### Future directions
- Adaptive tool sets that adjust mid-conversation based on tool usage patterns (not just initial prompt)
- Measure token savings and tool selection accuracy with real conversations
- Consider moving `files_overview` to an `analysis` group if usage data confirms low frequency

## Iteration 590 — Added subsystem concentration detection to trend output, closing the data gap that made diminishing-returns guidance ineffective

Iter 588's composition-over-addition criterion was INEFFECTIVE: builder still added tool #32 (map) in iter 589, making 3 consecutive tools/orchestration iterations. Root cause: the trend showed feature/architecture but the eval criterion told the builder to classify by subsystem — a data gap.

Added `_classify_subsystem()` to parse-log.py that maps CHANGELOG titles to subsystems (tools/orch, tools/io, modules/manifest, modules/ctx, etc.). Trend now shows subsystem per iteration + trailing streak warnings ("tools/orch × 3 STREAK"). Simplified builder prompt to reference subsystem data directly. Strengthened composition criterion (removed "may" hedge). Research-backed: RAGEN's "Echo Trap" (reward variance cliff) and ICML 2025 intrinsic metacognition — detecting concentration is the first step to breaking it.

Other candidates: strengthen criterion wording (secondary — words without data failed in 588), system prompt headroom in trend (builder discovers mid-session anyway), DESIGN.md growth enforcement (monitoring), test quality/mutation (less urgent). Expected: builder sees tools/orch streak, avoids 4th consecutive, diversifies.

## Iteration 589 — Built `map` tool for parallel homogeneous tool application

Built `map` tool — applies any tool to every item in a list via direct `executeTool` calls (no LLM overhead). Completes the composition primitive trio: `batch` (parallel heterogeneous, sub-agents), `pipe` (sequential chain), `map` (parallel homogeneous, direct). Max 50 items, concurrency 5-20, partial failure handling, per-item result truncation.

### What changed
- `src/tools/map.ts` — tool implementation with concurrency control and result budgeting
- Registered in tools/index.ts, tool-groups.ts (core), system-prompt.ts
- 12 new tests covering validation, multi-file reads, grep fan-out, partial failures, order preservation, truncation

### Candidates considered
- Composition integration tests for batch+pipe — pure testing, no new capability
- `retry` control flow tool — useful but LLM already retries naturally
- `transform` data tool — approximated by code_exec
- `calendar` tool — new domain but requires OS-specific API research

### Verification
typecheck ✓ | build ✓ | 3368 tests pass (+12) | lint ✓ | load ✓ | runtime SKIP (no API key)

### Future directions
- Compose map inside pipe steps (e.g. `pipe → map → pipe`)
- Add `reduce` or `aggregate` to complement map for data pipeline patterns
- End-to-end composition test proving batch+pipe+map in a realistic workflow

## Iteration 588 — Added composition-awareness to builder eval criterion and anti-paralysis to improver

Added composition-over-addition principle to builder eval criterion, informed by ToolComp (Scale AI 2025) and ToolTree (ICLR 2026) research on multi-tool composition testing.

### Intervention verdicts (from iter 586)
- **fix_cycles metric fix (3x inflation)**: **EFFECTIVE**. Iter 587 shows 0
  fix cycles in trend, matching session detail exactly.

### Diagnosis
The builder performs well operationally (iter 587: 62 calls, $3.20, 0 fix
cycles). Research rate jumped to 4/5 (was 3/10). But at 31 tools + batch +
pipe + scripts + event handlers, no iteration has verified these compose
correctly end-to-end. ToolComp and ToolTree research confirm composition
testing is a distinct discipline that unit tests don't cover.

### What changed
- **Builder eval criterion**: Added 3-line composition principle after the
  diminishing-returns clause. Frames composition verification as high-value
  work at 30+ capabilities.
- **Improver prompt**: Added anti-paralysis decision-making guidance.
- **BUILDER_LESSONS**: Updated DESIGN.md size (1254→1276 lines).
- **Thesis**: Updated evidence (iter 587), promoted research/decision-quality
  to resolved, added ToolComp/ToolTree to research library, new pattern
  observations (addition bias, analysis paralysis).

### Candidates considered
1. **Composition-awareness in eval criterion** — CHOSEN. Research-backed,
   addresses the "addition bias" pattern.
2. **Verify rerun metric fix** — Test 6.4× conflates incremental testing
   (good) with rework (bad). Lower impact since builder isn't reacting to it.
3. **DESIGN.md condensation automation** — 1276 > 1100 target. Lesson exists
   but isn't followed. Deferred; monitoring.
4. **Remove stale depth coverage metric** — Outdated process concept. Low
   impact. Deferred.
5. **Process-level evaluation in parse-log.py** — Inspired by ToolTree. High
   complexity for uncertain benefit. Deferred.

### Expected effects
- Builder iter 589 considers composition/integration work alongside new features
- Improver iters commit faster with anti-paralysis guidance
- DESIGN.md growth is tracked but not yet structurally addressed

## Iteration 587 — Built pipe tool: inline sequential tool composition with data flow

Built `pipe` tool — sequential complement to `batch` (parallel). Chains 2-10 tool
invocations in a single call with data flow between steps ($prev, $steps[N], field
access, {{template}} interpolation). Reuses module-factory's resolveStepInput and
evaluateCondition for consistent semantics. 17 new tests.

### What changed
- New core tool `pipe` in `src/tools/pipe.ts` (~95 lines)
- Registered in index, tool-groups (CORE), system prompt
- Supports conditional `if` on steps, stops on first error
- Data flow uses same $prev/$steps[N]/{{template}} as module scripts

### Candidates considered
- git tool (structured git ops) — ergonomic, not new capability; git works via shell
- diff tool (file comparison) — same; diff/patch available via shell
- data transform tool — too large scope; code_exec covers it
- template/scaffold tool — too "coding assistant" for general-purpose agent

### Verification
typecheck ✓ | build ✓ | 3356 tests pass (143 files, +17 new) | lint ✓ | load ✓ | runtime SKIP (no key)

### Future directions
- DAG executor combining pipe (sequential) + batch (parallel) with join semantics
- Extract step-resolve utilities into shared module if more consumers emerge
- Pipe result aggregation mode (return all step outputs, not just last)

## Iteration 586 — Fixed 3x-inflated fix_cycles metric; added ITR research for system prompt scaling

Fixed the trend's fix_cycles metric which was 3x inflated (33 reported vs 11 actual over 10 iters), giving a false "chronic rework" signal. Applied GVU "strengthen the verifier" principle.

### Intervention verdict (from iter 584)
- **Concrete worked examples**: **PARTIALLY EFFECTIVE**. Builder chose batch tool (tools/orchestration), explicitly rejected module-adjacent option citing "4+ consecutive module iters." Diversity improved but still defaults to "add new thing."

### What changed
- `parse-log.py`: Aligned trend fix_cycles algorithm with session-detail algorithm. Old: counted any impl→verify cycle (included normal multi-file development). New: counts only edit→test→re-edit patterns (actual rework). Net: 33→11 fix cycles over 10 iters (1.1/iter avg vs 3.3/iter).
- `prompts/improvement-thesis.md`: Updated hypothesis, evidence, intervention history, research library (added ITR, CompactPrompt, TRACE), strategic priorities. System prompt scaling identified as near-term structural constraint.
- `BUILDER_LESSONS.md`: Updated stale tool/test counts.

### Candidates considered
1. **Fix fix_cycles metric inflation** — CHOSEN. GVU "strengthen verifier": the improver's evaluation signal was 3x wrong. Fixing it is the highest-leverage verifier improvement.
2. System prompt scaling (ITR research) — Added to thesis as strategic direction. Builder work, not improver.
3. Improve improver prompt with GVU verifier principle — Already embedded in thesis analysis framework.
4. Add "capability delta" assessment to parse-log.py — New metric, but thesis warns "adding more metrics is diminishing returns." Deferred.
5. BUILDER_LESSONS system prompt workflow fix — Minor: 7 calls on char budget is small waste.

### Expected effects
- Improver sees accurate rework signal (1.1/iter, not 3.3/iter), preventing false "chronic rework" diagnosis
- ITR research in thesis may influence future builder choices toward prompt scaling architecture

## Iteration 585 — Batch tool for parallel sub-agent orchestration (scatter-gather)

Built `batch` tool — scatter-gather pattern for parallel sub-agent execution. One tool call fans out N independent tasks to concurrent sub-agents, collects results with partial-failure handling.

### What changed
- New `src/tools/batch.ts`: accepts `tasks` array + `mode` + `max_concurrent`, reuses `runDelegate`, concurrency-limited (default 3, max 5, max 10 tasks), per-task result budget scales with count
- Registered as core tool (always available, moderate risk)
- System prompt updated: Coordination line adds batch, Delegation section references it for parallel research
- 15 new tests covering validation, parallel execution, concurrency limits, partial failures, result ordering, truncation

### Candidates considered
1. **Batch parallel delegation** — CHOSEN. Scatter-gather is a fundamental orchestration primitive (confirmed by OpenAI Agents SDK, Google ADK, Azure patterns). Single tool call vs N separate delegates.
2. Provider hot-swap / discovery CLI — still module/provider system; 4+ consecutive module iters.
3. Agent introspection tool — useful for self-improvement but internal, not user-facing.
4. Structured workflow engine — manifest scripts + conditional steps already cover sequential; batch covers parallel.
5. Environment probe tool — simple but not transformative; shell already covers this.

### Verification
typecheck ✓ | build ✓ | 3339 tests pass (+15) | lint ✓ | load ✓ | runtime SKIP (no key)

### Future directions
- Shared context parameter (background info sent to all sub-agents once)
- Result synthesis mode (LLM-powered merge of parallel findings)
- Progress streaming (partial results as sub-agents complete)

## Iteration 584 — Add concrete worked examples to builder eval criterion

Added 3 condensed examples of strong past choices (iters 523, 565, 569) to the builder's evaluation criterion, grounding abstract guidance in concrete precedent. Research-backed: self-generated examples improve task quality 73→93% (Sarukkai et al. NeurIPS 2025).

### Intervention verdicts (from iter 582)
- **DESIGN.md read efficiency**: **EFFECTIVE**. 1 read (was 8), 55k ctx (was 108k), $3.72 (was $8.12).
- **Subsystem concentration**: **PARTIALLY EFFECTIVE**. Still module-adjacent but architecture-classified, owner-aligned, and candidates included non-module options.

### What changed
- `prompts/build-agent.md`: Compressed orient section (-4 lines), added 3 worked examples after diminishing-returns paragraph (+5 lines). Net: +1 line (104→105).
- `prompts/improvement-thesis.md`: Updated verdicts, evidence, research library (added 6 new papers from web research), resolved DESIGN.md issues.

### Candidates considered
- **Concrete worked examples in eval criterion** — CHOSEN. Strongest research backing (73→93%), directly addresses brainstorming quality, low risk (+5 lines).
- Trajectory quality scoring in parse-log.py — improves diagnostics but doesn't directly help the builder. Deferred.
- Mutation testing feedback loop (Meta ACH) — high value but complex to operationalize. Noted for future.
- Capability profile for data-driven work selection — medium impact. The examples approach is simpler and more direct.
- BUILDER_LESSONS maintenance — no stale entries found, nothing to update.

### Expected effects
- Builder brainstorms more diverse candidates (grounded by precedent, not just abstract rules)
- No cost/context regression (net +1 line is negligible)

## Iteration 583 — SQLite memory provider validates plug-n-play provider architecture

Built the first alternative memory backend — SQLite-backed, using the sqlite3 CLI (zero new deps). Validates the provider system (iter 563) and directly addresses the owner's "swap one memory for another" request.

### What changed
- `src/sqlite-memory.ts` — `SQLiteMemoryProvider` implementing `MemoryProvider` with SQL LIKE search, tag/date filtering, WAL mode, no 100-memory cap
- `src/modules/sqlite-memory.ts` — Module registering the provider; activate via `{ "providers": { "memory": "sqlite-memory" } }`
- 25 new tests covering all CRUD ops, search, persistence, special characters, and interface conformance

### Candidates considered
- **SQLite memory provider** — CHOSEN. Validates stale provider architecture, addresses owner's modularization request, zero new deps
- Environment probing at startup — small delta (shell already discovers environment)
- Conversation export tool — moderate impact but high effort
- Module templates — convenience, not capability
- Approval gates for autonomous actions — touches saturated module manifest area

### Verification
typecheck ✓, build ✓, 3324 tests pass (+25), lint ✓, load ✓, runtime SKIP (no API key)

### Future directions
- Alternative knowledge provider (e.g., SQLite-backed KnowledgeProvider)
- FTS5 full-text search extension for richer semantic matching
- Provider health checks and migration tooling between backends

## Iteration 582 — Fix DESIGN.md read bloat and sharpen subsystem diversity criterion

Two targeted fixes for iter 581's $8.12 cost regression (2x avg) and continued module concentration despite iter 580's intervention.

### Intervention verdicts (from iter 580)
- **Broadened diminishing-returns ("any subsystem")**: **PARTIALLY EFFECTIVE**.
  Builder acknowledged concentration ("Time to work on a different subsystem")
  but chose module logging anyway — "modules" is broad enough that the builder
  finds novel-sounding work within it indefinitely. Need finer classification.

### What changed
- **build-agent.md §1 Orient**: "Read DESIGN.md" → `grep '^##' DESIGN.md`.
  Iters 575-579 grepped headers (44-63k ctx, $2.47-$3.80). Iter 581 read
  DESIGN.md 8 times during orient (108k ctx, $8.12). Codify the efficient
  pattern.
- **build-agent.md §2 eval criterion**: Added explicit system classification
  guidance ("modules includes manifest steps, scripts, logging, factory,
  providers") so the builder can't treat "module logging" as different from
  "module scripts." 3+ same-system iterations = deeply saturated.
- **BUILDER_LESSONS.md**: Added DESIGN.md reading lesson with concrete data
  from iters 575-581 showing 2-3x cost difference.

### Expected effects
- Context/turn: 108k → 50-65k range (matching 575-579 pattern)
- Cost: $8.12 → $2.50-$4.00 range
- Subsystem: builder classifies "modules" as saturated (5/6 recent iters),
  opens a new capability front

### Candidates considered
- DESIGN.md read efficiency — CHOSEN (highest cost impact, proven pattern)
- Subsystem diversity strengthening — CHOSEN (580's intervention incomplete)
- Research rate improvement — deferred (2/10 rate slowly improving, lower priority)
- DESIGN.md compression — can't modify directly (builder domain)

## Iteration 581 — Module persistent logging: queryable audit trail for autonomous operations

Added persistent, queryable log storage for modules — all module operations (event handlers, scripts, lifecycle) now leave an audit trail the agent can query via `module_factory(action:"logs")`.

### What changed
- `src/module-log.ts` — `ModuleLogStore` class with JSONL storage per module, query/tail/filter API, auto-pruning at 1000 entries
- `src/module-loader.ts` — `ctx.log.{info,warn,error,debug}` now persists to log store in addition to console; accepts optional `data` parameter for structured metadata
- `src/module-factory.ts` — step handlers and scripts auto-log start/complete/error/skip for each execution
- `src/tools/module-factory.ts` — new `logs` action with module, level, keyword, and limit filters
- Initialized in `loop.ts`, `daemon.ts`, `server.ts` alongside other stores

### Candidates considered
- Module persistent logging — CHOSEN. Explicitly requested in NOTES ("tools, scripts, logs"), opens observability of autonomous operations
- For-each iteration in steps — powerful but more manifest enhancement (concentrated area)
- Cron expressions for scheduler — marginal delta over existing `parseRepeat`
- Git operations tool — shell+guardrails already covers adequately
- File watcher tool — background process + shell can approximate; cross-platform complexity

### Verification
typecheck ✓ | build ✓ | 3299 tests (3269→3299, +30) ✓ | lint ✓ | load ✓ | runtime SKIP (no key)

### Future directions
- Module log viewer CLI command (`kota logs <module>`)
- Log-based alerting: event handler fires when error count exceeds threshold
- Log rotation and archival for long-running daemon mode

## Iteration 580 — Broaden diminishing-returns criterion to counter subsystem concentration

Generalized the builder's diminishing-returns check from "tools" to "any subsystem," countering a 4-iteration concentration on module manifest enhancements (571, 575, 577, 579) that the old tool-specific clause didn't trigger on.

### Intervention verdicts (from iter 578)
- **System-prompt char budget lesson**: **EFFECTIVE**. Iter 579: 2 calls/0
  cycles for system-prompt (was 13 calls/4 cycles in iter 577).
- **Research-as-evaluation (iter 576)**: **PARTIALLY EFFECTIVE**. 2/10 iters
  used research (up from 1/8). Iter 579 did 12 web searches.

### What changed
- **build-agent.md**: Diminishing-returns clause generalized from "26+ tools"
  to "any subsystem" with trend-awareness. Brainstorming step now says "draw
  from different parts of the codebase — don't anchor on recent work."
- **improvement-thesis.md**: Added Agent Drift paper (2601.04170), updated
  verdicts, evidence, and priorities.

### Expected effects
Builder recognizes when a subsystem (like manifest steps) has reached natural
completion and shifts to a different domain. Not a rotation scheme — the
builder still chooses freely, but the eval criterion now applies to all
repeated work, not just tool additions.

## Iteration 579 — Conditional steps: guard-style `if` field for script/event-handler branching

Added `if` field to ManifestStepDef — steps can be conditionally skipped based on previous outputs, enabling branching logic in scripts and event handlers without code.

### What changed
- `ManifestStepDef.if` — optional guard condition string evaluated via `evaluateCondition()`
- `evaluateCondition()` — expression evaluator supporting bare truthiness, comparisons (==, !=, >, <, >=, <=), and all existing references ($prev, $steps[N], $payload with .field access)
- `runModuleScript` / `runStepHandler` — skip steps when `if` evaluates falsy; skipped steps produce empty output, don't update $prev
- Validation for `if` field in both event handler and script step validators
- System prompt, DESIGN.md updated with conditional step docs

### Candidates considered
- Conditional steps (guard-style `if`) — CHOSEN. Most common pattern across workflow engines (GitHub Actions, Argo). Flat step list, no nesting/convergence issues.
- For-each iteration over arrays — high impact but more complex; better as follow-up
- Step timeout/retry — resilience feature, lower capability gain
- Switch/match multi-way branching — overkill for flat step lists; `if` guards cover most cases
- Module templates — reduces creation friction but doesn't enable new workflows

### Verification
typecheck ✓ | build ✓ | 3269 tests (3246→3269, +23) ✓ | lint ✓ | load ✓ | runtime SKIP (no key)

### Future directions
- For-each iteration in steps (loop over arrays from step results)
- Logical operators in conditions (&&, ||, !) for compound guards
- Step timeout/retry configuration

## Iteration 578 — Fix system-prompt rework and outdated DESIGN.md read restriction

Eliminated two sources of builder inefficiency: system-prompt char budget trim loops (20% of iter 577) and a factually wrong DESIGN.md read restriction that was silently ignored every iteration.

### What changed
- **BUILDER_LESSONS.md**: System-prompt test entry now explains ≤200 char
  headroom and the pre-check strategy (run tests first, trim aggressively
  upfront). Cites iter 577's 13-call trim loop as anti-example.
- **build-agent.md**: Removed "do NOT read DESIGN.md in full" instruction.
  The file (1260 lines) fits within read limits; builder ignored it in 4/4
  recent iters with no errors. Replaced with neutral "Read DESIGN.md for
  architecture context."
- **improvement-thesis.md**: Updated verdicts (576 research = too early,
  574 DESIGN.md reads = ineffective/removed), evidence, priorities.

### Candidates considered
- System-prompt char budget lesson — CHOSEN. 3/4 recent feature iters affected.
- DESIGN.md read instruction fix — CHOSEN. Removes factually wrong noise.
- Keep/discard mechanism (Karpathy autoresearch style) — interesting but needs
  scalar metric we don't have; deferred to research library.
- Research-as-evaluation verification — too early (1 builder iter since change).

### Expected effects
- System-prompt calls per affected iter: 13→≤4 (builder knows headroom upfront)
- Prompt noise: -3 lines of wrong instruction removed
- Verify: next 2-3 builder iters that touch system-prompt.ts

## Iteration 577 — Step Output References and Template Interpolation for Scripts

Added data flow between script/event-handler steps: `$steps[N]` references any
previous step's output (not just `$prev`), dot-path field access extracts JSON
fields (`$prev.name`, `$steps[0].url`, `$payload.id`), and `{{ref}}` template
syntax enables inline string interpolation. All 26+ existing tools become
composable in real data pipelines without code.

### What changed
- `resolveStepInput` — new resolution engine with `resolveRef`, `getFieldByPath`
- `runStepHandler` / `runModuleScript` — track all step outputs for `$steps[N]`
- System prompt, DESIGN.md updated
- 26 new tests (3220 → 3246)

### Candidates considered
- Conditional steps (if/else branching) — useful but lower impact per iteration
- Parallel step groups — complexity vs. value not justified yet
- Module persistent state — `ctx.storage` already covers this
- Agent self-introspection tool — 27th tool has diminishing returns

### Verification
typecheck ✓ | build ✓ | 3246 tests ✓ | lint ✓ | load ✓ | runtime SKIP (no key)

### Future directions
- Conditional steps (`if` field on steps for branching based on output values)
- Array iteration in steps (for-each over JSON array results)
- Step timeout/retry configuration

## Iteration 576 — Integrate Research Into Evaluation to Break Persistent 1/8 Research Rate

Folded separate "Research targeted unknowns" step into the evaluation criterion, making web research part of good decision-making rather than a skippable phase gate.

### Intervention verdicts (from iter 574)

- **DESIGN.md targeted reads**: PARTIALLY EFFECTIVE. Builder used `grep "^### "`
  for the index (call 5) but still read DESIGN.md in full (call 6). No read
  errors, but DESIGN.md grew to 1254 lines (was 1229) — condensation guidance
  is not being followed.
- **BUILDER_LESSONS DESIGN.md entry**: NOT EFFECTIVE for growth control. Builder
  added 25 lines without condensing any stable sections.

### Diagnosis

Research usage: 1/8 builder iterations over the last 16 iters. The separate
§3 "Research targeted unknowns" step with "Skip for narrow bug fixes" made
research an opt-in phase gate the builder consistently opted out of. Proven
pattern: eval criteria change behavior (iter 548), lessons/steps don't change
strategic decisions (iter 540).

### What changed

**`prompts/build-agent.md` (105→103 lines)**:
- Removed §3 (Research) as a separate step
- Added research into §2 (Decide): "For promising candidates, search the web
  for prior art, APIs, and pitfalls — existing implementations often reveal
  better approaches or hidden complexity that changes the ranking."
- Renumbered remaining steps (6→5 total)

### Candidates considered

1. **Research-as-evaluation** — CHOSEN. Addresses most persistent gap via
   proven mechanism (eval criteria > lessons for strategic behavior).
2. **Vitest mock pattern lesson** — Specific mock issues in iter 575 (3 fix
   cycles from test failures). But builder already reads test files; issue is
   inherent mock complexity, not missing knowledge.
3. **System prompt budget pre-check** — Would prevent recurring budget-exceed
   rework. Narrower impact than #1.
4. **DESIGN.md growth enforcement** — Growth continues (1254 lines vs 1100
   target). But adding more guidance about the same thing won't help — the
   builder has the guidance and ignores it.
5. **Code knowledge graph** (from web research) — Pre-index codebase via AST
   for precision context. High effort, uncertain payoff at current scale.

### Expected effects

- Research rate increases from 1/8 to 2-4/8 over next 8 builder iters
- Builder prompt slightly smaller (105→103 lines)
- No regression in other metrics (research is integrated, not mandated)

### Verification

- Research: web search for agent evaluation, test-aware generation, context mgmt
- Builder prompt: syntax and flow verified, reads cleanly at 103 lines

## Iteration 575 — Module Scripts: Named On-Demand Tool-Call Sequences

Added `scripts` field to module manifests — named, reusable tool-call sequences
invokable on demand via `module_factory(action:"run", name, script, args?)`.

**What changed**:
- `ManifestScriptDef` type + `scripts` field on `ModuleManifest`
- Manifest validation for scripts (name format, step structure)
- `runModuleScript()` — awaitable step execution returning final result
- `module_factory` tool: "run" action + "info" shows scripts
- System prompt updated, DESIGN.md documented

**Candidates considered**:
- TaskProvider interface — limited real-world demand for swapping task backends
- Step conditionals — incremental, small scope
- Git tool — shell covers this, diminishing returns on tool #29
- Data format conversion — code-exec handles this

**Verification**: typecheck, build, 3200+ tests, lint — all pass.

**Future directions**:
- Script-to-schedule binding (run a script on a cron)
- Script parameters with typed schema validation
- Inter-module script composition (one module calls another's script)

## Iteration 574 — Fix DESIGN.md Read Overflow Degrading Builder Orientation

DESIGN.md at 25781 tokens exceeds the 25000-token read limit, causing 5 failed/retried reads in iter 573 and wasting ~100k tokens of context on a single file.

**Diagnosis**: DESIGN.md grew to 1229 lines (83KB) as the builder adds a section
every iteration. In iter 573, the builder read DESIGN.md 5 times (calls 3, 8,
10, 12, 49) — 4 of those in the first 14 calls during orientation. The token
limit error forced retries with partial reads, burning context.

**What changed**:
- Builder prompt orient step: replaced "Read DESIGN.md" with targeted approach
  (`grep "^### " DESIGN.md` for index, first ~100 lines for overview, specific
  sections via offset/limit during implementation)
- Builder prompt implement step: added DESIGN.md size management guidance
  (condense stable sections, stay under ~1100 lines / 25000 tokens)
- BUILDER_LESSONS.md: added DESIGN.md Size section with read strategies

**Intervention verdicts (iter 572)**:
- Work-type classification fix: **EFFECTIVE**. Trend shows accurate "3 arch, 3
  feature" for last 6 iters. All classifications confirmed correct.

**Candidates considered**:
1. **Fix DESIGN.md read overflow** — CHOSEN. Concrete error affecting every
   future builder iteration. 5 retried reads = ~100k wasted tokens.
2. Sharpen eval criterion toward module self-containment per owner's vision —
   strategic but hard to measure, and current eval already pushes architecture.
3. Encourage web research (1/6 iters) via eval criterion — lessons failed
   before (iter 540), eval change worth trying but lower priority than a read
   error affecting every session.
4. Add parse-log.py individual test count (currently tracks test files) —
   cosmetic signal improvement, low impact.

**Expected effects**:
- Builder reads DESIGN.md 1-2 times instead of 4-5
- ~50-100k tokens saved per session on DESIGN.md re-reads
- Builder eventually condenses DESIGN.md to stay under read limit

## Iteration 573 — Add view_image Tool for Local Image Analysis

Built view_image tool enabling the agent to read local image files (PNG, JPEG, GIF, WebP) and return them as image content blocks for visual analysis — a new input modality complementing screenshot and read_document.

### What changed
- `src/tools/view-image.ts`: File validation (format, size, existence), safe resize via temp copy (never modifies original), image content block return
- Registered as core tool (always available), risk: safe
- System prompt updated with `view_image` reference, trimmed adjacent descriptions to stay under char budget

### Candidates considered
1. **view_image tool** — CHOSEN. No existing tool can present local images to the LLM. Complete capability gap.
2. Live event handler activation for runtime modules — architecture closing iter 571 gap, deferred
3. Template interpolation in step inputs ($payload.url) — incremental on iter 571
4. Web content extraction — web_fetch + code_exec approximates this
5. Conditional steps (if/unless) — incremental on iter 571

### Verification
typecheck ✅ | build ✅ | lint ✅ | 3199 tests (+26) ✅ | load ✅ | runtime SKIP (no key)

### Future directions
- SVG support (convert to PNG via rsvg-convert or Inkscape before returning)
- Multi-image batch (analyze several images in one call)
- Image annotation overlay (draw bounding boxes on coordinates returned by analysis)

## Iteration 572 — Fix Work-Type Classification in Trend Analysis

Fixed false "5/5 feature dominant" signal by expanding architecture keywords and loading archived CHANGELOG titles, giving both builder and improver accurate work-pattern data.

### Iter 570 verdicts
- **CHANGELOG verbosity cap**: EFFECTIVE. Iter 571 entry: 26 lines (was ~70 avg). 0 read errors.
- **`tail -80` reads**: EFFECTIVE. No CHANGELOG errors in iter 571.

### Changes
1. **parse-log.py**: Added 9 architecture keywords (provider, registry, self-register, calltool, tool invocation/composition, composab, step-based). Title loader now reads CHANGELOG.archive.md too.
2. **improvement-thesis.md**: Updated with iter 571 evidence, verdicts, corrected work pattern (3 arch, 2 feature), new pattern watch entries.

### Candidates considered
1. Fix work-type classification — CHOSEN (concrete false signal affecting both agents)
2. Contextualize re-edit metric (distinguish incremental building from rework) — deferred, fix_cycles is the reliable signal
3. Research encouragement via eval criterion — deferred, lessons-based approach already failed
4. Pre-flight self-critique (ReVeal) — deferred, fix cycles already at 0-1

### Expected effects
- Trend shows accurate architecture/feature mix, preventing false "pattern lock" signals
- Archived iterations contribute titles for classification (was losing context after archiving)

## Iteration 571 — Step-Based Event Handlers for Tool Composition

Added `steps` field to manifest event handlers — agent-created modules can now chain sequential tool calls on events without writing code, making all 26+ existing tools composable from autonomous workflows.

### What changed
- `ManifestEventHandler` gains optional `steps` field (mutually exclusive with `code`)
- Each step: `{tool, input?}` with `$prev`/`$payload` substitution for piping data between steps
- Validation: step structure, code/steps exclusivity, step tool+input checks
- `runStepHandler` + `resolveStepInput` in module-factory.ts

### Candidates considered
- HistoryProvider — incremental on iter 563, small delta
- Introspect tool — low delta over existing listTools
- Data pipeline tool — code_exec covers this
- Module lifecycle CLI — doesn't enable new agent capabilities

### Verification
typecheck ✅ | build ✅ | lint ✅ | 3173 tests (+14) ✅ | load ✅ | runtime SKIP (no key)

### Future directions
- Wire runtime-created modules (module_factory tool) to ModuleLoader for live event handler activation
- Template interpolation in step inputs (e.g., `$payload.url` field access)
- Conditional steps (if/unless based on previous result)

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

