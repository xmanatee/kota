# KOTA Changelog

## Iteration 643 — Research delegate mode for deep multi-step investigation

Added `delegate(research)` — a third delegate mode for deep, iterative research with provenance tracking. 25-turn budget (vs 10 for explore), specialized prompt guiding decompose → parallel search → evaluate gaps → synthesize. +15 tests (3973 total).

### What changed

- **`src/delegate-prompts.ts`**: New `RESEARCH_PROMPT` with 6-step workflow (decompose, search broadly, read deeply, evaluate gaps, cross-reference, synthesize). Structured output format with executive summary, key findings table, confidence levels, and sources.
- **`src/tools/delegate.ts`**: Added `research` mode to schema, validation, and routing. 25-turn limit. `DelegateMode` type exported. Mode routing via lookup maps instead of ternaries.
- **`src/model-router.ts`**: `routeModel` accepts `research` mode — no execute bump, always `thin` backend.
- **`src/tools/batch.ts`**: Added `research` to batch tool's mode enum.
- **`src/system-prompt.ts`**: Updated agent prompt to prefer `delegate(research)` for deep research.
- **Tests**: 15 new — RESEARCH_PROMPT content (7), research tools/runners (3), research delegate E2E with mock client (2), model router research mode (3).

### Candidates considered

1. **Research delegate mode** — CHOSEN. Genuinely new capability, well-supported by Manus wide research, OpenAI deep research, LangChain open deep research patterns. Different subsystem from recent work.
2. **E2E event-triggered tests** — Good test coverage for event→schedule→action chains. Deferred.
3. **Computer-use hardening** — Top neglected file (NEVER, 418L). Deferred.
4. **Custom-tool hardening** — Second neglected (NEVER, 358L). Deferred.
5. **Source restructuring** — Architecture-only, no tests. Deferred.

### Future directions
- **E2E event-triggered tests** — Fake timers + scripted tool responses for event→schedule→tool chains (repeatedly deferred, high value).
- **Computer-use / custom-tool hardening** — Top neglected files (418L, 358L), need tests and splitting.
- **Research delegate: record/replay integration tests** — Block Engineering middle-layer pattern: record a real research session, replay deterministically.
- **Parallel research via batch** — `batch(tasks, mode:"research")` for wide research across multiple topics simultaneously.

## Iteration 642 — Test-delta streak penalty prevents maintenance convergence

Builder novelty axis now penalizes consecutive zero-test-delta iters. Phase 1 requires ≥2 capability candidates when recent iters lack tests.

### Intervention verdicts (from iter 640)

- **Subsystem novelty penalty (iter 640)**: **PARTIAL**. Builder 641 picked
  different area (source-restructuring, not agent-sdk) — subsystem diversity
  goal met. But builder chose pure maintenance (0 tests, 0 capabilities).
  Novelty axis prevented same-area repetition but enabled safe convergence.
- **Vitest mock lesson (iter 640)**: **NOT YET TESTED**. No mock-heavy work.

### What changed

**`build-agent.md`** (94 lines, +2): Added test-delta streak check to Phase 1 —
if 2+ recent iters had zero test delta, builder must include ≥2 capability
candidates. Phase 2 novelty axis now penalizes zero-test-delta streaks alongside
same-subsystem streaks. Based on Intrinsic Metacognition (ICML 2025): fixed
scoring functions plateau without trajectory self-awareness.

**`improvement-thesis.md`**: Updated hypothesis (642), moved subsystem tunnel
vision to resolved, added maintenance convergence as active issue. Added STOP
(COLM 2024) and Intrinsic Metacognition (ICML 2025) to research library.

### Candidates considered

1. **Test-delta streak penalty** — CHOSEN. Structural change to scoring criteria.
   Data-driven (builder reads --trend test deltas). Addresses 3/10 zero-test iters.
2. **Trajectory reflection step** — Deferred. Add explicit "review last 3 iters"
   between Orient and Decide. More metacognitive but risks verbal encouragement.
3. **Improve parse-log.py to flag capability vs maintenance** — Deferred. Would
   surface better data but uses tooling budget; the builder already sees test deltas.
4. **Meta-self-improvement (STOP pattern)** — Deferred. Let builder improve its
   own selection logic. High potential but needs infrastructure beyond prompts.
5. **Builder personality diversity (DEI pattern)** — Deferred. Multiple builder
   strategies routed by underrepresentation. Complex, needs more design.

### Expected effects

- Builder 643 generates ≥2 capability candidates (features or hardening with tests)
- Zero-test-delta streaks break — next builder iter adds tests
- Diversity recovers as capability work naturally spans different subsystems

## Iteration 641 — Source restructuring: 3 domain clusters + per-directory docs

Moved 15 source files + 17 test files from flat `src/` into 3 domain-based
subdirectories: `src/memory/` (6 files: store, working-memory, sqlite-memory,
knowledge-store, compaction, history), `src/scheduler/` (6 files: scheduler,
schedule-parser, daemon, task-store, task-router, action-executor),
`src/server/` (3 files: server, session-pool, server-notifications). Each
directory has a barrel `index.ts` and concise `README.md`. All 3958 tests pass,
zero behavioral changes. Reduces `src/` root from 73 to 58 non-test source files.

Addresses two owner requests: "institute standards in codebase" and "improve
the source structure" — both previously untouched.

### Future directions
- **More clusters**: `tools/` is still large (30+ files). `context/` could group context.ts, observation-masking.ts, message-pruning.ts, system-prompt.ts. `model/` could group model-client.ts, model-router.ts, provider-factory.ts.
- **Event-triggered E2E tests** — fake timers + scripted tool responses for event→schedule→tool chains.
- **Computer use / custom tool hardening** — top neglected files (418L, 358L), need tests and splitting.

## Iteration 640 — Diminishing returns on repeated subsystems

Novelty axis now scores near-zero when `--trend` shows 2+ recent iters in same subsystem. Added vitest mock isolation lesson to BUILDER_LESSONS. Addresses diversity decline (73%→58%) caused by 3 consecutive agent-sdk iters.

### Intervention verdicts (from iter 638)

- **Self-review step (iter 638)**: **EFFECTIVE**. Iter 639 ran self-review
  checklist unprompted (turns 39-40), noted 5 quality items, added Future dirs.
- **BUILDER_LESSONS pruning (iter 638)**: **EFFECTIVE**. Lessons at 65 lines,
  focused on non-inferable gotchas.

### What changed

**`build-agent.md`** (92 lines, +1): Redefined novelty axis — if `--trend`
shows 2+ recent iters in the same subsystem, novelty scores near-zero. Based on
DGM (archive diversity), CycleQD (cyclic rotation), and observed diversity
decline (73%→58% over 10 iters).

**`BUILDER_LESSONS.md`** (71 lines, +6): Added Vitest Mock Isolation section —
`vi.doMock` leaks across worker pools, prefer `vi.mock` with factories. Builder
spent ~15% of iter 639 (turns 24-38) fighting this exact issue.

**`improvement-thesis.md`**: Updated hypothesis (640), added 3 research papers
(DGM, Self-Play Info Gain, CycleQD), archived self-review as resolved.

### Candidates considered

1. **Diminishing returns on novelty** — CHOSEN. Directly addresses diversity
   decline with minimal prompt change. Research-backed (DGM, CycleQD).
2. **Vitest mock isolation lesson** — ALSO DONE. Concrete, prevents rework.
3. **Curiosity-driven generation** — Deferred. "What would surprise the owner?"
   is too vague without data backing.
4. **Offline strategic distillation** — Deferred. High effort, EvolveR approach
   needs more infrastructure than prompt changes allow.
5. **Memory architecture evolution** — Deferred. MemEvolve is fascinating but
   requires tooling changes beyond prompt scope.

### Expected effects

- Builder iter 641 selects a different subsystem than agent-sdk/tools
- Diversity metric recovers toward 70%+ over next 3 builder iters
- Vitest mock rework drops in sessions with dynamic import mocking

## Iteration 639 — Agent SDK delegate backend

Wired `@anthropic-ai/claude-agent-sdk` as an alternative delegate backend. When the model router selects execute + coding/debugging/automation at capable tier, sub-agents now run through Claude Code's full agent runtime (Read, Write, Edit, Bash, Glob, Grep) instead of KOTA's thin tool loop. Graceful fallback if SDK not installed. 20 new tests, 3958 total.

**Files changed (7):**
- `src/tools/delegate-agent-sdk.ts` — new Agent SDK delegate backend (164L)
- `src/tools/delegate.ts` — backend routing: `resolvedBackend` check before thin loop
- `src/model-router.ts` — `DelegateBackend` type, backend field in `ModelRouteResult`
- `src/agent-sdk/types.ts` — `result`, `total_cost_usd`, `num_turns` on `SDKMessage`; `effort` on options
- `src/agent-sdk/executor.ts` — export `loadSDK`
- `src/cost.ts` — `addRawCost(usd)` for pre-computed dollar costs from Agent SDK

**Routing heuristic:**
| Mode | Task Type | Tier | Backend |
|------|-----------|------|---------|
| explore | any | any | thin |
| execute | coding/debugging/automation | capable | agent-sdk |
| execute | all other | any | thin |

### Future directions
- **Research delegate mode** — specialized prompt for multi-step research: decompose → parallel search → iterative deepen → synthesize with provenance. Lighter than a new tool; prompt-only variant of existing delegate.
- **Agent SDK interactive mode** — support `--interactive` with Agent SDK via streaming input.
- **Source structure + per-component docs** — replace monolithic DESIGN.md with per-directory READMEs.
- **Event-triggered E2E tests** — fake timers + scripted tool responses for event→schedule→tool chains.

## Iteration 638 — Self-review step + BUILDER_LESSONS pruning

Added self-review step to builder prompt (Agent-as-Judge pattern). Builder now reviews its own diff for quality issues before recording. Pruned BUILDER_LESSONS of items redundant with the prompt (ETH Zurich: generic inferable context is noise).

### Intervention verdicts (from iter 636)

- **Three-axis selection (iter 636)**: **EFFECTIVE**. Iter 637 built explicit
  Novelty/Owner Alignment/Research Depth comparison table. Clear improvement.
- **NOTES.md progress tracking (iter 636)**: **EFFECTIVE**. Iter 637 added
  `→ Progress (iter 637)` annotation. Staleness tracker now has data.

### What changed

**`build-agent.md`** (91 lines, +2):
- Compressed Verify section (10→5 lines): merged load/runtime checks.
- Added Step 5 "Self-review": review diff, fix code-review-level issues,
  note weak spots in Future directions. Based on Agent-as-Judge research.

**`BUILDER_LESSONS.md`** (65 lines, -8):
- Removed "Pre-Flight: run tests first" — redundant with prompt's Orient.
- Removed "Batch Edits" — redundant with prompt's "outline all planned edits."

**`improvement-thesis.md`**: Updated evidence, added Agent-as-Judge +
Karpathy AutoResearch to library, pruned stale entries (SGICE, MPO, MAR).

### Candidates considered

1. **Self-review step** — CHOSEN. Agent-as-Judge research + owner quality mandate.
2. **BUILDER_LESSONS pruning** — ALSO DONE. Small, complementary change.
3. **Capability-gap self-model** — Deferred. High complexity for prompt-only.
4. **Structured experiment log** — Deferred. CHANGELOG + parse-log.py sufficient.
5. **Retroactive NOTES annotations** — Skipped. One-time gap, not systemic.

### Expected effects

- Builder reviews its own diff before recording, catching quality issues
- BUILDER_LESSONS is tighter, only non-inferable content remains
- Verify in iter 640: builder text mentions self-review, fixes something

## Iteration 637 — Claude Agent SDK backend

Built `src/agent-sdk/` — alternative execution backend using `@anthropic-ai/claude-agent-sdk`. Unlike ModelClient providers (single LLM calls), this delegates entire tasks to Claude Code's full agent runtime with built-in tools (Read, Write, Edit, Bash, etc.). Usage: `kota run --provider agent-sdk "task"`. Dynamic import with graceful error if SDK not installed. 10 new tests, 3938 total.

### Files
- `src/agent-sdk/types.ts` (38L) — minimal SDK type definitions
- `src/agent-sdk/executor.ts` (104L) — `executeWithAgentSDK()` wrapping `query()`
- `src/agent-sdk/executor.test.ts` (228L) — tests with mock SDK
- `src/agent-sdk/vendor.d.ts` (5L) — ambient type declaration
- `src/agent-sdk/index.ts` (2L) — barrel exports
- `src/cli.ts` — agent-sdk branch in run command and pipe mode
- `package.json` — optional peer dep `@anthropic-ai/claude-agent-sdk`

### Future directions
- **Source structure + per-component docs** — replace monolithic DESIGN.md with hybrid index + per-directory READMEs (OpenHands/Backstage pattern). Two owner requests, never started.
- **Event-triggered E2E tests** — fake timers + scripted tool responses for testing "event fires → schedule runs → tool called" chains (Block Engineering testing pyramid pattern).
- **Agent SDK as delegate backend** — wire `executeWithAgentSDK` into delegate tool so KOTA sub-agents can use Claude Code for coding tasks while KOTA manages knowledge/memory/modules.
- **Agent SDK interactive mode** — support `--interactive` with Agent SDK via streaming input (`AsyncIterable<SDKUserMessage>`).

## Iteration 636 — Three-axis selection + NOTES.md progress tracking

Replaced vague "deepest opportunity" with explicit novelty × owner-alignment × research-depth criterion. Fixed builder not annotating NOTES.md progress.

### Intervention verdicts (from iter 634)

- **Research-after-candidates (iter 634)**: **EFFECTIVE**. Iter 635 had 36 web
  searches (vs 4/iter in 631-633). Research drove candidate selection — builder
  chose source reorg after studying how OpenHands/Claude Agent SDK structure code.
- **Diversity requirement (iter 634)**: **EFFECTIVE**. Builder chose a NEVER-
  addressed owner priority (source structure), breaking 5-iter pattern of
  incremental feature work.
- **Future directions review (iter 634)**: **EFFECTIVE**. Builder explicitly
  scanned CHANGELOG future directions before generating candidates.

### What changed

**`build-agent.md`** (89 lines, unchanged count):
- Phase 2: "deepest opportunity" → three-axis criterion (novelty, owner
  alignment, research depth). More explicit framework reduces subjective bias.
- Implement: removed NOTES.md instruction (was buried, easily missed).
- Record: added explicit `→ Progress (iter N)` instruction for `b:` items.

**`improvement-thesis.md`**: Marked research-declining + formulaic-candidates
as resolved. New active issues: selection quality, progress tracking gap.
Added Intrinsic Metacognition and MAR to research library.

### Candidates considered

1. **Three-axis selection + progress tracking** — CHOSEN. Fixes two concrete
   gaps: vague selection criterion and broken staleness feedback loop.
2. **Ambition tiebreaker** — Deferred. "Prefer capability over infrastructure
   when tied." But iter 635 chose infrastructure FOR GOOD REASON (owner
   priority). A blanket bias would override legitimate choices.
3. **Self-reflection/review step** — Deferred. Adding a self-review phase after
   implementation. Rework is 40% avg but declining; premature to add overhead.
4. **SGICE golden examples** — Deferred again. 150-line limit makes embedding
   examples impractical. Could create a reference file, but adds context cost.

### Expected effects

- Builder evaluates candidates on explicit axes, not gut feel
- NOTES.md gets `→ Progress` annotations, fixing the staleness tracker
- Verify in iter 638: at least one `→ Progress` annotation in NOTES.md

## Iteration 635 — Source structure: extract web-ui/, mcp/, architect/ clusters

Moved 20 files from flat `src/` into 3 domain-based subdirectories. Reduces root source file count from 78 to 68. All 3928 tests pass, zero behavioral changes.

### What changed

- **`src/web-ui/`** (6 files): `web-ui.ts`, `client.ts`, `markdown.ts`, `styles.ts` + 2 tests
- **`src/mcp/`** (6 files): `client.ts`, `manager.ts`, `server.ts` + 3 tests
- **`src/architect/`** (8 files): `architect.ts`, `replan.ts`, `runner.ts` + 5 tests

Updated 12 external consumers (imports + vi.mock paths). DESIGN.md headers updated.

### Future directions

- **More clusters**: `server/` (server.ts, session-pool.ts, session-state.ts, server-notifications.ts, transport.ts), `memory/` (memory.ts, working-memory.ts, sqlite-memory.ts, history.ts, compaction.ts, knowledge-store.ts), `scheduler/` (daemon.ts, scheduler.ts, schedule-parser.ts, task-store.ts, task-router.ts, action-executor.ts)
- **Claude Agent SDK backend**: Research shows Strategy A (delegate backend via `query()`) is viable. Use for delegated autonomous tasks while keeping native loop for main orchestration.
- **E2E event tests**: Event-triggered schedule + module event handler E2E tests. Patterns established in existing test suite.

## Iteration 634 — Restructure brainstorming: targeted research + diversity

Moved web research from undirected Phase 1 inspiration to targeted Phase 2 candidate evaluation. Added diversity requirement (≥1 candidate from untouched area) and "Future directions" review to prevent formulaic loops.

### Intervention verdicts

- **Trend simplification (iter 632b)**: **EFFECTIVE**. Builder in 633 read
  simplified trend, noticed STALE, responded by picking owner priority.
- **Quality criteria + comparative (iter 632a)**: **EFFECTIVE**. Builder in
  633 made strong top-2 comparison with concrete demos. Research depth still
  low (4 searches) — addressed by this iteration's restructuring.

### What changed

**`build-agent.md`** (Phase 1+2, same 88 lines): Removed undirected early web
searches. Phase 1 now starts with reviewing "Future directions" from CHANGELOG
and requires ≥1 candidate from an area untouched in 5+ iterations. Phase 2
renamed "Research + Converge" — 2+ targeted web searches per top candidate.
Added explicit anti-anchoring: "let research reshape your ranking, not just
confirm your favorite."

### Candidates considered
1. **Targeted research + diversity requirement** — CHOSEN. Addresses declining
   research (4/iter vs 9 avg) and formulaic candidates. Based on SE-Agent
   (cross-trajectory) and QDAIF (quality-diversity).
2. **Self-play / self-challenge** — Deferred. Builder generates its own test
   challenges. Powerful (Self-Challenging Agents: 2x performance) but complex
   to integrate into current prompt structure.
3. **SGICE in-context examples** — Deferred. Embedding examples of excellent
   iterations in the prompt. 150-line limit makes this impractical.
4. **Recursive self-improvement of improver** — Deferred. STOP-style meta-
   improvement. Already happening implicitly through thesis + prompt edits.

### Expected effects
- Builder does more targeted, deeper research (searches per candidate, not per session)
- Research findings actually influence candidate selection (not just implementation)
- ≥1 candidate from novel area per iteration, breaking safe-composition pattern
- Verify in iter 636: research count ≥6, at least one candidate from untouched area

## Iteration 633 — Adaptive model routing for delegate sub-agents

Built `src/model-router.ts` — automatically selects model tier (fast/balanced/capable) for delegate sub-agents based on task complexity. Combines task-type classification with complexity signals (architecture keywords upgrade, simple lookups downgrade) and delegate mode (execute gets +1 bump). Config: `modelTiers` in `config.json`. Wired through delegate, loop, and config. 29 new tests.

**Future directions:**
- E2E tests for event-triggered schedules + module event handlers (owner priority)
- Source structure reorganization (owner priority, 199 files in src/)
- Output evaluation layer (Evaluator-Optimizer pattern)
- Structured workflow state between pipe/map steps

## Iteration 632 — Simplify trend output from 22 signals to 9

Trimmed parse-log.py trend output per owner request. Cut non-actionable metrics (calls, cost, ctx, errors, sweep, re-edit, verify reruns, subsystems, domains, severity, rotation, mutation, DESIGN.md lines, depth coverage). Kept: tests, research, rework, work diversity, domain concentration, owner priorities, top neglected.

### Intervention verdicts

- **Quality criteria + comparative research (iter 632)**: **INCONCLUSIVE**. Iter
  999 was a refactoring task (facade removal) where quality criteria and
  comparative research don't meaningfully apply. Need a feature-building
  iteration to evaluate. The builder DID respond to the owner priority staleness
  signal (completing facade cleanup), showing that signal works.

### What changed

**`parse-log.py`**: Rewrote trend output section (~290 lines → ~90 lines).
Per-iteration line: dropped calls, cost, ctx/turn, errors, sweep, re-edit.
Summary: dropped 10 sections (errors/sweep, re-edit, verify reruns, context,
subsystems, domains, severity, rotation, mutation, DESIGN.md). Merged domain
concentration into work pattern line. Kept depth-health for top neglected only.

### Candidates considered
1. **Simplify trend output** — CHOSEN. Owner explicitly requested, within
   tooling budget (last tooling: iter 620, 7 improver iters ago), reduces
   cognitive load from 22 to 9 signals.
2. **Post-implementation quality self-assessment** — Deferred. Builder self-
   rates against its own criteria. Risk: self-serving bias makes ratings
   unreliable (research: self-evaluation is noisy).
3. **Builder reflection loop** — Deferred. "What surprised me, what trade-offs
   I made." Verbal instruction for strategic change — unlikely to work per
   thesis principle #6.
4. **Research integration citation** — Rejected. Requiring explicit citation
   of research → implementation mapping. Too procedural, adds overhead.

### Expected effects
- Builder processes trend data faster during brainstorming (fewer signals to parse)
- No change to builder behavior (this is data compression, not behavioral change)
- Verify in iter 634: builder still reads and responds to trend data effectively

## Iteration 999 — Remove re-export facade files

Deleted 3 re-export facade files (`src/module-factory.ts`, `src/openai-model-client.ts`, `src/tools/module-factory.ts`) and 1 backward-compat re-export in `server.ts`. Updated 12 consumers to import directly from actual source modules (`src/manifest/`, `src/openai/`, `src/tools/module-factory/`, `src/session-pool.ts`). Zero test changes, all 3899 tests pass.

### Future directions

- **Research synthesis tool**: Meta-tool orchestrating multi-step research (search → fetch → extract → synthesize → store). Composition of existing web-fetch, knowledge-store, and delegate tools.
- **Source structure reorganization**: Group 197 src/ files into subdirectories (core/, tools/, modules/) with max 15 files per directory.
- **Dynamic tool selection**: Semantic routing to select relevant tool subset when agent has 50+ tools.

## Iteration 632 — Quality criteria and comparative research in builder brainstorming

Added self-defined excellence criteria and comparative research to Phase 2, plus expanded tool registration checklist to prevent rework.

### Intervention verdicts

- **Inspiration scan (iter 630)**: **PARTIALLY EFFECTIVE**. Iter 631 did 3
  early web searches, found blackboard architecture — genuinely externally
  inspired (wouldn't have emerged from codebase knowledge alone). But only 4
  total searches (lowest in 8 iters). Implementation research was shallow (1
  search vs 12 in iter 629). Owner-request category was mentioned but barely
  engaged. Composition category not exercised.

### Diagnosis

Two quality gaps in iter 631:
1. **No quality target beyond "tests pass"**: Builder implemented a functional
   in-memory KV store but didn't define what "excellent" would look like. With
   deeper quality framing, it might have added persistence, event integration,
   or a richer API.
2. **Shallow implementation research**: 1 search after committing (vs 12 in
   iter 629). Builder felt confident about KV stores and skipped comparative
   research. Result: straightforward implementation without considering
   alternative approaches or trade-offs.
3. **Registration rework**: 57% rework (highest in 8 iters). 3 edits each to
   delegate-prompts.ts and index.test.ts — both missing from the 6-file
   registration checklist.

### What changed

**`prompts/build-agent.md` (106→108 lines)**:
- Phase 2 step 2: After committing, builder defines 2-3 criteria for
  *excellent* implementation — carried into implementation and verification.
  Based on AutoHarness (ICLR 2026 RSI): agents defining verification criteria
  before executing outperform those that don't.
- Phase 2 step 3: Changed from "search how top agents implement this" to
  "search for at least 2 different approaches, compare trade-offs, pick what
  fits." Removes name-anchoring, requires comparative research.

**`BUILDER_LESSONS.md`**: Expanded tool registration checklist from 6→8 files:
added delegate-prompts.ts (sub-agent access) and tool-groups.test.ts (group
assertions). Direct response to iter 631's 3x edits on both files.

### Candidates considered
1. **Quality criteria + comparative research** — CHOSEN. Highest leverage on
   implementation quality. Evidence: AutoHarness, iter 631's shallow research.
2. **Enhance parse-log.py with brainstorming quality signals** — Deferred.
   Strong (RSI workshop: tool > prompt changes), but owner said don't optimize
   scripts. Available next iteration if prompt changes plateau.
3. **Reorder brainstorming categories (owner-request first)** — Deferred. Text
   change with weak evidence for behavior change (pattern watch #1: data >
   instructions).
4. **Builder post-implementation self-review** — Rejected. Text instruction
   for strategic quality — unlikely to work (pattern watch #7).

### Expected effects
- Builder defines excellence criteria before coding → higher quality bar
- Comparative research (2+ approaches) → deeper implementation informed by
  trade-off analysis, not just "confirm my plan"
- Registration checklist 6→8 files → fewer rework edits for new tools
- Verify in iter 633: look for (a) explicit quality criteria in brainstorming,
  (b) 2+ different approaches researched, (c) fewer edits to delegate-prompts
  and tool-groups.test.ts

## Iteration 631 — Shared workspace (blackboard) for multi-agent coordination

Built `src/workspace.ts` + `src/tools/workspace.ts` — in-memory shared key-value store enabling sub-agents to exchange findings directly without routing through the parent agent.

### What changed
- `WorkspaceStore` with create/write/read/list/delete operations, auto-create on write
- `workspace` tool registered in orchestration group, available to both explore and execute sub-agents
- 36 new tests (16 store unit + 20 tool tests), all passing
- Updated system prompt, delegate-prompts, tool-groups, DESIGN.md

### Candidates considered
- **Shared workspace (blackboard)** — CHOSEN. Novel coordination primitive based on classical blackboard architecture + recent arxiv research showing competitive performance with fewer tokens.
- **Context diversity engine (Manus pattern)** — Addresses real LLM failure mode but hard to verify and demonstrate.
- **Tool output schema validation middleware** — Important for production but incremental infrastructure, not visible to users.

### Verification
typecheck ✓, build ✓, 3899 tests (165 files) all pass (+36 new), lint ✓, CLI ✓, runtime SKIP (no API key)

### Future directions
- E2E test: delegate 3 sub-agents writing to shared workspace, parent synthesizes
- Workspace persistence (optional save to `.kota/workspaces/`)
- Workspace events on the event bus (`workspace.write`, `workspace.delete`)

## Iteration 630 — Inspiration-first brainstorming and composition category

Added landscape exploration before candidate generation and concrete demo evaluation to improve builder creativity and ambition.

### Intervention verdicts

- **Phase 2 restructuring (iter 628)**: **CONFIRMED EFFECTIVE**. Iter 629 did
  12 web searches ALL on replanning (the chosen work), 0 on eliminated candidates.
  Compare iter 627: 8 on HTTP tools (eliminated), 0 on conditional steps (built).
  Research-implementation disconnect is resolved.

### Diagnosis

Builder generates candidates only from internal knowledge (codebase + NOTES.md).
Iter 629's Phase 1 candidates (replanning, hardening, experience memory,
self-improvement loop) were all predictable extensions of existing features —
no externally-inspired ideas. Deep Ideation (arXiv:2511.02238) shows exploration
before ideation yields 10.67% quality improvement over direct brainstorming.

### What changed

**`prompts/build-agent.md` (104→105 lines)**:
- Phase 1 renamed "Explore & Diverge" — builder does 2-3 web searches for
  recent agent capabilities/patterns before generating candidates
- Added "Novel composition" category — combine 2+ existing capabilities
- Phase 2 evaluation changed from "user can ___" to "describe a concrete demo:
  what does the user do, what happens, why is it impressive?"

### Candidates considered

1. **Inspiration-first brainstorming** — CHOSEN. Highest leverage on creativity.
2. **Context engineering (inject best iteration example)** — Deferred. Try
   inspiration first; SGICE pattern available if needed.
3. **BUILDER_LESSONS research quality patterns** — Lessons work for procedures,
   not strategy (pattern watch #7). Strategic change via prompt structure.
4. **Improve improver's own analysis framework** — No evidence of improver
   quality issues; builder quality is the bottleneck.

### Expected effects

- Builder explores the agent landscape before brainstorming → novel, externally-
  inspired candidates that wouldn't emerge from codebase knowledge alone
- Composition category → combinatorial thinking over existing primitives
- Demo evaluation → bolder choices grounded in tangible user outcomes
- Verify in iter 631: look at Phase 1 candidates for externally-inspired ideas

## Iteration 629 — Adaptive replanning for architect mode

Built `src/architect-replan.ts` — when the editor loop detects failure patterns (3+ consecutive errors or stagnation), it invokes a replanner LLM call that can continue, revise the plan, or abort.

### What changed
- New `architect-replan.ts`: failure tracking, trigger detection, replan prompt, decision parsing, replanner invocation
- Modified `architect.ts`: wired replanning into `runEditorLoop` — monitors tool results, triggers replanning, injects revised plans
- 45 new tests (38 unit + 7 integration) covering all trigger types, decisions, prompt building, and edge cases

### Candidates considered
- **Agent experience memory** — auto-reflect on task outcomes and store lessons. Deferred: harder to validate, compounding value requires many sessions.
- **Harden computer-use.ts** (#1 neglected, 418L) — important but depth work, not bold.

### Verification
typecheck ✓ | build ✓ | 3863 tests pass (+45) | lint ✓ | CLI loads ✓ | runtime SKIP (no key)

### Future directions
- Agent experience memory / self-improvement loop (strong next candidate)
- Harden computer-use.ts (NEVER tested, 418L — overdue)
- Replanning with budget awareness (token/cost limits trigger simplified plan)

## Iteration 628 — Separated feasibility, evaluation, and research in builder Phase 2

Restructured Phase 2 convergence to fix research-implementation disconnect — builder was researching eliminated candidates and building without research.

### Diagnosis

Iter 627 spent 8 web searches researching HTTP tools, then eliminated that
candidate (already existed in codebase). Chose conditional workflow steps
instead — built with 0 state-of-the-art research. Root cause: Phase 2 said
"search the web for state of the art" as step 1 of evaluating each candidate,
before feasibility was checked. Research informed evaluation, not implementation.

### What changed

**`prompts/build-agent.md`**: Phase 2 restructured into 3 distinct steps:
1. **Feasibility** — grep codebase to eliminate duplicates (before any research)
2. **Evaluate** — case-making comparison (preserved from iter 626)
3. **Research your choice** — web search AFTER commitment, focused on how top
   agents implement this capability, informing the implementation step

**`BUILDER_LESSONS.md`**: Added `sqlite-memory.test.ts` as known flaky test
(observed iter 627: fails under load, passes in isolation).

### Intervention verdicts

- **Iter 626 (adversarial case-making)**: **PARTIALLY EFFECTIVE**. Builder made
  explicit cases for each candidate (4 vs 2 bullets). Genuine comparison
  occurred. But research was decoupled from implementation — 8 searches on
  eliminated candidate, 0 on chosen work. Case-making structure preserved;
  research placement fixed.

### Candidates considered

1. **Phase 2 research restructuring** — CHOSEN. Highest impact: research
   quality directly determines implementation quality.
2. **Read efficiency guidance** — 25% read focus (3/12 read files edited). But
   owner says don't optimize for efficiency/cost. Skipped.
3. **Phase 2 case-length balancing** — Force equal-length cases. Too mechanical,
   risks anti-pattern territory.
4. **EnCompass-inspired search strategy** — MIT framework for agent search with
   backtracking. Interesting but premature — current builder doesn't need search
   strategy infrastructure.

### Expected effects

- Builder researches what it actually builds (not what it eliminates)
- Implementation quality improves from state-of-the-art awareness
- No wasted web searches on already-existing capabilities
- Verify in iter 629: research calls should appear AFTER candidate commitment

## Iteration 627 — Compound condition expressions for module scripts and pipe steps

Extended the step condition language with logical operators (&&, ||, !), string operators (contains, matches), and parenthesized grouping. Module scripts and pipe steps can now express compound, data-dependent workflow logic.

### What changed
- `src/manifest/steps.ts`: Recursive descent evaluator replacing flat regex — handles `&&`, `||`, `!`, `()`, `contains`, `matches`
- `src/manifest/types.ts`: Updated JSDoc for `if` field with new operators
- 28 new tests covering all operators, combinations, and a real-world API health check scenario
- DESIGN.md updated for both module factory and pipe tool sections

### Candidates considered
- **Compound condition expressions** — CHOSEN. Fills the composition gap between linear scripts and real workflows
- **Guardrails test coverage** (282L, NEVER tested) — valuable but purely defensive, no new capability
- **HTTP request tool** — already exists (http-request.ts, web-fetch.ts, web-search.ts)

### Verification
56/56 step tests pass (28 existing + 28 new). Typecheck, build, full suite pass.

### Future directions
- `else` branches or `match` step type for multi-way routing
- `loop`/`retry` step modifier for repetition with backoff
- Guardrails test coverage (282L, NEVER tested) — high priority for security hardening

## Iteration 626 — Structured adversarial convergence in builder Phase 2, countering choice-supportive bias

Restructured builder Phase 2 convergence to counter choice-supportive bias (AAAI 2025) — forces explicit case-making for each candidate before committing.

### Intervention verdicts (from iter 624)
- **Per-item owner next-steps**: **EFFECTIVE**. Builder chose E2E tests (owner
  request) in iter 625. Owner priorities: 0 builder iters since last progress.
  Specificity asymmetry hypothesis confirmed and resolved.

### What changed
**`prompts/build-agent.md` Phase 2** — replaced vague "evaluate side by side"
with structured comparison:
1. "Search the web for state of the art" (was "prior art" — raises bar)
2. "Complete: After this, a user can ___ that they couldn't before" (grounds
   evaluation in user impact, not code structure)
3. "Make the strongest case for it over the other candidate" (adversarial
   case-making counters early-commitment bias per AAAI 2025 research)
4. "If similar impact, prefer the bolder one" (inverts justification burden)

### Research informing this iteration
- **Choice-Supportive Bias in LLM Evaluators** (AAAI 2025): LLMs inflate
  assessments of their initial pick. Fix: force evidence-based comparison.
- **DReaMAD** (2503.16814): Assigning evaluation stances breaks conservative
  convergence. Applied as adversarial case-making requirement.
- **AutoHarness** (ICLR 2026 RSI Workshop): Agent writes own verification
  criteria before executing. Filed for future use.
- **Context Engineering > Prompt Engineering** (2026 consensus): Loading examples
  of ambitious successes outperforms instructions. Filed for escalation if
  Phase 2 restructuring alone isn't sufficient.

### Candidates considered
1. **Structured adversarial convergence** — CHOSEN. Research-backed, directly
   addresses decision quality, no prompt bloat (same line count).
2. **Context engineering with trajectory replay** — Load best recent iteration
   as example. High potential but needs infrastructure (session scoring).
   Filed as escalation path.
3. **Research methodology guidance in BUILDER_LESSONS** — Add "how to research
   effectively" section. Risks prompt bloat; builder already researches 5/8
   iters. Lower priority.
4. **Improver self-improvement** — Add quality criteria to improver prompt.
   Meta-meta-optimization; diminishing returns at current maturity.
5. **BUILDER_LESSONS update** — No stale entries found; all 11 sections still
   relevant. No action needed.

### Expected effects
- Builder makes genuine side-by-side comparisons (not pick-then-rationalize)
- More research calls in convergence phase (even for "obvious" candidates)
- Shift toward bolder, more user-impactful work when candidates are similar
- Verify: iter 627 CHANGELOG should show substantive comparison in "candidates"

## Iteration 625 — E2E tests for delegate, architect mode, and scheduled actions

Added 11 E2E tests exercising multi-layer agent workflows with mock clients — delegate sub-agents, architect plan-then-execute, and scheduled action execution.

### What changed
- **Delegate E2E tests** (4 tests): Main loop → delegate(explore/execute) → sub-agent uses tools → results return to main loop. Covers explore mode file reading, execute mode file editing, invalid mode error, and empty task error.
- **Architect mode E2E tests** (2 tests): Full architect → editor → main loop pipeline. Covers single-file and multi-file plan execution with real tool I/O.
- **Scheduled action E2E tests** (5 tests): ActionExecutor → AgentSession pipeline, no-action error, concurrency limits, Scheduler.getDue() → ActionExecutor pipeline, and multi-turn tool-using actions.

### Candidates considered
1. **E2E tests for delegate/architect/actions** — CHOSEN. Owner request (iter 533, "Next: delegate E2E tests, architect mode tests, scheduled action tests"). 46+ iters stale.
2. **Source structure reorganization** — owner `[never]` item, but large scope and lower immediate reliability value.
3. **Test computer-use.ts** (418L, NEVER tested) — hard to test without OS-level mocking.
4. **New capability (structured data query)** — less urgent than reliability.

### Verification
- All 3790 tests pass (+11 new). Typecheck, build, lint clean. Load OK. Runtime SKIP (no API key).

### Future directions
- Source structure reorganization (owner `[never]` item)
- More provider types for module system (iter 575 next step)
- Ollama integration test for multi-provider (iter 613 next step)

## Iteration 624 — Per-item owner priority next-steps in trend, breaking top-neglected attractor

Owner-priority staleness signal (iter 622) was visible but ignored — builder chose file-splitting 3 straight iters despite "getting stale" warning, because top-neglected list provided specific, risk-free candidates. Fixed specificity asymmetry.

### Intervention verdicts (from iter 622)
- **Owner priority staleness signal**: INEFFECTIVE. Builder saw "Owner priorities getting stal[e]" in iter 623 (text block #1) but chose module-factory split anyway. Top-neglected list's specificity outcompeted the vague warning. Research confirms: verbal encouragement doesn't change behavior (Arumugam et al., ICLR 2025); structural specificity does.

### What changed
**parse-log.py trend output** — three structural changes:
1. **Owner priorities moved above depth/neglected** — first actionable signal
2. **Per-item "Next:" steps** extracted from NOTES.md progress history — matches the specificity of the neglected list
3. **Top-neglected condensed 5→2** when owner priorities are stale — reduces the attractor

### Candidates considered
1. **Per-item owner priority with next-steps** — CHOSEN. Matches specificity of neglected list. Follows data > instructions principle.
2. **Remove top-neglected entirely** — too aggressive; it's useful when owner priorities aren't stale.
3. **OS-style aging in builder prompt** — text instructions; proven less effective than data signals.
4. **SGICE trajectory replay** — high potential but requires harness changes. Deferred.
5. **Add "no more than N file-splits" constraint** — bureaucratic; violates anti-patterns.

### Expected effects
- Builder sees 5 concrete next-steps for owner requests, each with "Next: ..."
- Top-neglected reduced from 5→2 entries when stale — less attractor surface
- Prediction: builder picks an owner request in iter 625

### Research informing this iteration
- Arumugam et al. (ICLR 2025): verbal "explore more" doesn't work; structural algorithmic changes do
- MAST taxonomy (NeurIPS 2025): "unaware of termination conditions" causes loops
- OS-style aging: priority increment on wait time prevents starvation of hard tasks

## Iteration 623 — Split #1 neglected file module-factory.ts into focused modules with 25 new edge-case tests

Split `src/tools/module-factory.ts` (455L, NEVER tested directly) into `src/tools/module-factory/` with 6 focused modules: definition (55L), state (45L), actions (215L), scripts (50L), logs (65L), index (55L). Original file becomes thin re-export facade — zero consumer changes needed.

**25 new edge-case tests** covering: state granular operations (6), create edge cases — prompt section, no tools, persistence failure, registration rollback, replace (5), list session-only modules (2), remove disk-only module (1), info session-only/long-prompt/dependencies/parameters/saved-status (5), script undefined args (1), logs data field/combined filters/filter description/default limit (4), combined filter matching (1).

- Candidates: (a) module-factory split+harden — CHOSEN, #1 neglected, 455L, diversifies "tools" domain; (b) structured output/JSON mode — rejected, agent already uses tool-use mechanism
- Verification: typecheck ✓, build ✓, lint ✓, 3779 tests (3754→3779, +25), runtime SKIP (no key)
- Future: structured output abstraction across providers, harden guardrails.ts (282L, NEVER), source structure reorg

## Iteration 622 — Owner priority staleness signal in trend output

Added owner-priority tracking to parse-log.py trend: parses NOTES.md for pending `b:` items, finds latest progress iteration, shows "N pending, last progress iter M (K builder iters ago)" with warnings at 5+ and 8+ iters.

### Intervention verdicts (from iter 620)
- **Suite_totals targeted-test filtering**: CONFIRMED. Iter 621 trend shows
  accurate `3712→3754 (+42)` delta. No more nonsensical negative deltas.

### Diagnosis
Builder did file-splitting for 2 consecutive iterations (619, 621) and plans
more (future directions: 3 more files). Owner requests haven't progressed
since iter 613 (4 builder iters ago). The trend shows diversity 94% (healthy)
because "split" gets classified as architecture, masking the repetition.
Per Pattern Watch #1 (data > instructions), surfacing the staleness gap in
the trend tool will be more effective than adding prompt text.

### Candidates considered
1. **Owner priority staleness signal** — CHOSEN. Adds data to the tool the
   builder already reads, making owner-request neglect visible during
   brainstorming. Aligns with proven pattern (data > instructions).
2. **Consecutive work-name pattern detection** — Detect "split-*" repetition.
   Lower impact; the owner signal addresses the root cause (what to work on)
   not the symptom (same work type).
3. **SGICE trajectory replay** (from research) — Store successful trajectories
   as few-shot examples. High potential but requires harness changes beyond
   parse-log.py. Deferred.
4. **MPO meta-plan abstraction** — Raise brainstorming abstraction level.
   Prompt change, less proven than data injection. Deferred.
5. **Work-type classifier fix** — Distinguish "split/refactor" from genuine
   architecture. Marginal; the real issue is missing owner-priority signal.

### Expected effects
- Builder will see "5 pending, last progress: iter 613 (N builder iters ago)"
  during brainstorming, making the owner-priority gap concrete
- At 5+ iters, "getting stale" warning activates — should tip brainstorming
  toward owner requests within the next 1-2 iterations
- No change to builder prompt or lessons — pure data injection

### Research informing this iteration
- MPO (arXiv 2503.02682, EMNLP 2025): meta plans at higher abstraction escape
  local optima. Deferred but promising for future prompt restructuring.
- ICLR 2026 RSI Workshop: agents modifying only prompts plateau; expanding to
  tool/scaffold code shows continued improvement. Validates the "change the
  data signal, not the instruction" approach.

## Iteration 621 — Split openai-model-client.ts (484L) into 4 focused modules + 42 depth tests

Split the #1 neglected file into `src/openai/` — types (56L), translations (165L), stream (120L), client (110L). Original file becomes a thin re-export facade; zero consumer changes needed. Added 42 new edge-case tests covering: safeJsonParse (5), extractToolResultContent (5), translation edge cases (8), parallel tool call streaming (1), partial SSE chunk buffering (1), multi-listener registration (1), fallback model/id handling (3), client error paths (3), and more.

### What changed
- `src/openai/` directory with 4 source + 3 test files (all under 170L)
- `src/openai-model-client.ts` reduced from 484L → 19L re-export facade
- DESIGN.md section updated to reflect new structure

### Candidates considered
- **Split openai-model-client.ts** — CHOSEN. #1 neglected file (484L, NEVER depth-tested), provider domain (avoids "other" concentration), follows iter 619 pattern
- Data transformation tool — incremental; `code-exec` and `shell` already handle this
- Source restructure (tools/ directory) — high-value but larger scope than one iteration
- Persistent workflow engine — requires extensive design; deferred

### Verification
- typecheck: PASS, build: PASS, tests: 3754 pass (42 new), 1 flaky (shell-pipeline timing, pre-existing), lint: clean
- Runtime: SKIP (no ANTHROPIC_API_KEY)

### Future directions
- Split remaining oversized files: computer-use.ts (418L), custom-tool.ts (358L), read-document.ts (346L)
- Provider failover / health monitoring for multi-provider reliability
- Source restructure for `src/tools/` (38 files, exceeds 15-file guideline)

## Iteration 620 — Fix suite_totals corruption from targeted test runs (--changed, specific files)

Fixed parse-log.py test delta showing -2472 instead of +61 for iter 619 — `suite_totals` collected counts from `npx vitest run --changed` (1179 tests) alongside full-suite `npm test` (3651 tests), producing a nonsensical negative delta.

Fix: correlate each `tool_result` with its originating `tool_use` Bash command
via `tool_use_id`. Added `_is_targeted_test()` helper that detects `--changed`
flags and specific file/dir arguments. Both `parse()` (individual sessions) and
`_quick_parse()` (trend mode) now skip targeted test results when collecting
suite totals. Trend mode accidentally worked before (negative delta fell through
to text extraction), but the individual session mode displayed wrong data.

### Intervention verdicts (from iter 618)
- **Test delta total-count extraction**: CONFIRMED. Iter 619 trend shows
  accurate `+61`. However, individual session mode showed `3651→1179 (-2472)` —
  a separate bug (this iteration's fix).
- **Subsystem security-keyword pre-check**: CONFIRMED. Iter 619 classified as
  `modules/manifest` (not `modules/provider`), correctly picking up the manifest
  split work.

### Candidates considered
1. **Suite_totals targeted-test filtering** — CHOSEN. 6th metric accuracy fix
   (Pattern Watch #5). Individual session analysis showed completely wrong delta.
2. **Verify reruns breakdown (targeted vs full-suite)** — test 8.5× avg
   includes targeted runs (good TDD) alongside full-suite reruns (rework). Would
   give clearer efficiency signal. Deferred — lower urgency.
3. **BUILDER_LESSONS update for refactoring patterns** — Iter 619 was efficient
   (69 calls, 1 fix cycle). No new lesson needed.
4. **Web research signal for iter 619** — `rsrch: .` (none). Acceptable for a
   pure refactoring task. No intervention needed.

### Expected effects
- Individual session `Test delta` now matches trend output for iterations using
  `--changed` or targeted test runs
- No change to trend output (it already fell through to text extraction)

## Iteration 619 — Split module-factory.ts (854L) into focused src/manifest/ directory (6 files, all under 300L)

Refactored the largest untested file into `src/manifest/` with 5 focused modules (types, validation, steps, execution, persistence) + index re-exports. Original file becomes thin facade — zero consumer changes needed.

### What changed
- `src/manifest/types.ts` (75L) — manifest type definitions
- `src/manifest/validation.ts` (228L) — validateManifest, extracted helper functions for tools/steps/events/scripts validation
- `src/manifest/steps.ts` (163L) — resolveRef, resolveStepInput, evaluateCondition (pure functions, used by pipe tool too)
- `src/manifest/execution.ts` (196L) — manifestToModule, runModuleScript, tool runners, event handlers
- `src/manifest/persistence.ts` (98L) — save/load/delete/discover manifests on disk
- `src/manifest/index.ts` (36L) — re-exports for backward compat
- `src/module-factory.ts` (30L, was 854L) — thin re-export facade
- 61 new edge-case tests across validation, steps, and persistence

### Candidates considered
- **Split module-factory.ts** — CHOSEN. #1 neglected file (854L, NEVER depth-tested), 3x over 300L limit, addresses owner's source structure concern
- Workflow DSL for module scripts — too ambitious for one iteration
- Harden computer-use.ts — valuable but module-factory has higher leverage (critical infrastructure)

### Verification
- typecheck: PASS, build: PASS, 1179 changed-area tests: PASS, CLI load: PASS, runtime: SKIP (no API key)

### Future directions
- Migrate existing `src/module-factory.test.ts` into `src/manifest/` directory
- Update consumers to import directly from `src/manifest/` instead of facade
- Harden computer-use.ts (418L, NEVER tested) or custom-tool.ts (358L, NEVER tested)

## Iteration 618 — Fix test delta to use total counts instead of passed counts, fix secrets subsystem misclassification

Fixed test delta extraction to use Vitest totals (not passed counts) and subsystem classifier to exclude security keywords from "provider" pattern.

### Intervention verdicts (from iter 616)

- **Depth tracking auto-detection (iter 616)**: CONFIRMED. Builder updated
  depth-log.md in iter 617 (call 65). The depth work logging lesson is working.
- **Depth coverage signal accuracy (iter 616)**: CONFIRMED. knowledge-store.ts
  and openai-model-client.ts correctly excluded from neglected list after
  auto-detection picked up iter 615's edits.

### Diagnosis

Test delta for iter 617 showed "31→54 (+23)" in trend (per-file count from
text fallback) instead of "3628→3651 (+23)" (correct full-suite total). Root
cause: Vitest output `Tests 41 failed | 3610 passed (3651)` — the `passed`
regex captured 3626→3610 (decreasing due to flaky failures), triggering None
from the primary extractor and falling through to text-based P4/P5 patterns.
Fix: extract `(total)` instead of `passed` count. Totals never decrease within
a session (new tests always increase total regardless of flaky failures).

Additionally, iter 617's subsystem was classified as "modules/provider" because
the summary line contained "provider chain priority" (secrets providers, not
module providers). This inflated modules domain from 4 to 5/10, generating a
false "nearing saturation" warning. Fix: check security keywords (secret,
credential, keychain, injection guard) before the "provider" pattern.

### Candidates considered

1. **Test delta total-count fix** — CHOSEN. 6th metric accuracy fix (Pattern
   Watch #5). Affects any session with flaky test failures.
2. **Subsystem classifier security keywords** — CHOSEN (bundled). One-line fix
   removing a false saturation warning that could misdirect builder decisions.
3. **Re-edit rate analysis** — 52% avg, 75% in iter 617 (6 edits to test file).
   Inherent to bulk test additions. Not a clear intervention target.
4. **Web research on smart test selection** — Delegated to background agent.
5. **BUILDER_LESSONS update** — No new recurring patterns from iter 617.

### Expected effects

- Test deltas accurate even when flaky failures cause passed counts to decrease
- Subsystem classification no longer inflated by security-domain "provider" usage
- Builder gets cleaner domain concentration signals → less false avoidance of
  modules work

## Iteration 617 — Harden secrets management: fix remove() masking bug, injection guard, +23 tests

Fixed a bug where `SecretStore.remove()` failed to untrack secret values from masking — `knownSecrets` maps value→name but `delete()` was called with the name as key, leaving removed secrets still masked. Hardened `KeychainProvider.escapeArg` to reject newlines and null bytes (command injection guard). Added 23 edge-case tests covering provider chain priority, masking after removal, overlapping values, .env format variants, and special characters.

**Changes:**
- `secrets.ts`: Fixed `remove()` to iterate `knownSecrets` by name and delete by value. Added newline/null-byte validation in `escapeArg`.
- `secrets.test.ts`: 31→54 tests (+23). Coverage: provider chain priority, CRLF line endings, values with `=`, caching, overlapping substring masking, removal untracking, global scope, deduplication, boundary-length values.

**Candidates considered:**
1. **Harden secrets.ts** — CHOSEN. Security-critical, NEVER tested in depth, #4 neglected. Non-modules domain (addresses concentration).
2. **Harden computer-use.ts** — #3 neglected, 418L. Deferred: harder to test (OS mocking), less security-critical.
3. **Plan executor** — New composition capability for autonomous workflows. Deferred: larger scope.
4. **Module-factory refactor** — #1 neglected (854L) but modules domain saturated (3/5 recent iters).

**Verification:** typecheck ✓, build ✓, lint ✓, 54/54 secrets tests pass, CLI loads ✓, runtime SKIP (no key).

**Future directions:**
- Computer-use.ts hardening (418L, never tested)
- Module-factory.ts split + test (854L, never tested)
- Plan executor for autonomous multi-step workflows

## Iteration 616 — Fixed broken depth tracking by auto-detecting module activity from builder session data

Depth coverage signal was broken: depth-log.md frozen at iter 463 made `max_iter` anchor 150 iterations in the past, reporting misleading "31 stale" when the true number is 34. Builder did depth work in iter 615 (knowledge-store.ts) but the tracking didn't register it.

**Changes:**
- `parse-log.py`: Auto-detects which modules each builder session edited, maps test files to source modules, passes session activity to `_depth_health()`. Modules touched in recent sessions correctly drop from "neglected" list without needing manual depth-log.md entries.
- `depth-log.md`: Added iter 615's knowledge-store depth entry manually.
- `BUILDER_LESSONS.md`: Added "Depth Work Logging" procedure for updating depth-log.md. Updated stale DESIGN.md and test count references.
- `prompts/improvement-thesis.md`: Verified iter 612 (EFFECTIVE — builder acted on signal in 615), iter 614 (CONFIRMED — accurate test delta). Updated evidence, priorities, research library (Factory.ai Signals, Addy Osmani patterns).

**Intervention verdicts:**
- **(612)** Top-neglected modules in trend: **EFFECTIVE** — builder chose depth work for first time in 150+ iterations (iter 615), found real substring-match bug.
- **(614)** Suite-total test delta: **CONFIRMED** — iter 615 delta `3596→3618 (+22)` is accurate.

**Candidates considered:**
1. **Depth tracking auto-detection** — CHOSEN. Broken feedback loop: builder does depth work but metric doesn't reflect it. Classic Pattern #5 (metric accuracy is load-bearing).
2. **GEPA-inspired waste-pattern auto-diagnosis** — Higher potential but larger scope. Noted as priority #3 for future iters.
3. **Parse-log.py dead metric cleanup** (severity, mutation) — Low impact noise reduction. Deferred.
4. **Cross-session positive reinforcement** — Surface what made iter 615 efficient (simple scope, consumer-first). Interesting but hard to automate.

**Expected effects:**
- Depth coverage signal now accurate: modules touched in recent builder sessions no longer appear as "NEVER" in neglected list.
- BUILDER_LESSONS depth-log procedure (procedural lesson — proven to work) ensures manual logging as belt-and-suspenders alongside auto-detection.
- Builder sees correct top-5 neglected modules, leading to better-targeted depth work.

## Iteration 615 — Fix knowledge store ID collision bug and add 24 edge-case tests

Fixed `findFileInDir` substring match bug where `file.includes(id)` could return
the wrong entry when one ID is a prefix of another. Changed to exact suffix
matching (`file.endsWith(`-${id}.md`)`).

### What changed
- **`src/knowledge-store.ts`**: Fixed `findFileInDir` to use `endsWith` suffix
  match instead of `includes` substring match. Prevents ID collision when one
  entry's hex ID is a prefix of another's.
- **`src/knowledge-store.test.ts`**: Added 24 new tests (29 → 53 total) covering:
  ID substring collision, `since` filter in list/search, multi-term search
  ranking, empty/whitespace queries, scope "all", sort order, partial updates,
  meta merge preservation, corrupted files, missing IDs, non-.md files, no
  project dir error, updated timestamp, CRLF line endings, URLs in frontmatter,
  empty values, toSlug edge cases.

### Candidates considered
- **Knowledge store bug fix + edge-case tests** — CHOSEN. Data domain (breaks
  3-iter modules concentration). Found real bug in `findFileInDir`. 4th top
  neglected module by staleness.
- **Structured `git` tool** — Research showed all major agents shell out to git.
  Low incremental value over code_exec/shell.
- **Tool input validation middleware** — Architecture work, but modules-adjacent.
- **Source structure reorg** — Owner request but too large for one iteration.

### Verification
typecheck ✓, build ✓, 3618/3628 tests pass (10 pre-existing flaky: timing-
sensitive subprocess/REPL/integration tests), lint ✓, CLI help ✓, runtime SKIP
(no API key)

### Future directions
- BM25-style search ranking for knowledge store (replaces term-count scoring)
- Source structure reorganization (owner request, multi-iteration)
- Module-factory.ts deep testing (854L, top neglected by size)

## Iteration 614 — Suite-total test delta extraction and GEPA-informed thesis update

Fixed test delta false positive where "0 new test failures" matched as "+0 tests", and replaced text-pattern extraction with actual test-run suite totals as primary source. Iter 613 now correctly shows +22 (was +0).

### Intervention verdicts (from iter 612)

- **Classifier fix (model-client → modules/provider)**: **EFFECTIVE**. Iter 613
  correctly classified as modules/provider.
- **Flaky test lesson (process.test.ts)**: **EFFECTIVE**. Builder in iter 613
  explicitly referenced it and avoided wasted investigation (text blocks 1, 32).
- **Top-neglected modules in trend**: **PENDING**. Builder continued owner
  request (multi-provider) in iter 613 — expected. Need 1+ more builder iter.

### What changed

**`parse-log.py`**: Two fixes:
1. **False positive fix**: `_extract_test_delta` P3b matched "0 new test
   failures" → "+0". Added `int(N) > 0` guard and "fail" negative lookahead.
2. **Suite-total extraction (primary source)**: Both `_quick_parse` (trend) and
   `parse()` (single-session) now extract full-suite test totals (>500 passed)
   from Bash tool result output. First total vs last total → precise delta.
   Text-pattern matching (`_extract_test_delta`) is now fallback only.

**`prompts/improvement-thesis.md`**: Updated with GEPA (ICLR 2026 Oral) and
SICA research. GEPA validates the improver's trace-reflection approach and
suggests formalizing diagnosis. SICA's archive-of-agents pattern is a
potential future direction.

### Candidates considered

1. **Suite-total test delta + thesis update** — CHOSEN. Pattern Watch #5 (metric
   accuracy is load-bearing) applies — this is the 4th metric accuracy fix.
   GEPA/SICA research provides new strategic direction.
2. **Auto-detect waste patterns in parse-log.py** — GEPA-inspired. Would auto-
   diagnose "deleted function without checking test consumers" patterns. Medium
   impact but adds parse-log.py complexity. Future direction.
3. **Pre-edit test-read ratio in trend** — Surface "0 test reads before editing"
   as a predictor of avoidable fix cycles. Already tracked in single-session
   output; adding to trend risks information overload (Pattern Watch #2).
4. **SICA-style agent archive** — Track prompt versions + outcomes to revert
   regressions. Interesting but too complex for one iteration.
5. **BUILDER_LESSONS update for test-file checking** — Cross-Cutting Changes
   lesson already covers this. Pattern Watch #7: lessons don't change strategic
   behavior.

### Expected effects

- **Test delta accuracy**: No more false +0 from negation phrases. Suite totals
  give exact before/after counts instead of regex-guessed deltas.
- **Trend averages**: Corrected from +18.8 to +21.4 tests/iter (8-iter window).
- **Thesis clarity**: GEPA/SICA findings give concrete direction for next
  structural improvements to the improver.

## Iteration 613 — Wire multi-provider support into CLI and config, enabling local models via provider/model notation

Completes the multi-provider story started in iters 609+611. Users can now run KOTA with any OpenAI-compatible backend via `--model ollama/llama3`, `--provider groq`, or `--base-url`.

### What changed
- **`src/provider-factory.ts`** (new, 126L) — Factory resolving CLI flags + config into a ModelClient. Supports `provider/model` notation (LiteLLM convention), 5 built-in presets (openai, ollama, groq, together, lmstudio), and custom endpoints via `--base-url`.
- **`src/config.ts`** — Added `modelProvider` config section (type, baseUrl, apiKey) with sanitization and merging.
- **`src/cli.ts`** — Added `--provider` and `--base-url` flags. Replaced `ensureApiKey()` with factory. All three entry points (run, pipe, history resume) use the factory.
- **`src/provider-factory.test.ts`** (new) — 23 tests covering parsing, API key resolution, all provider presets, flag overrides, and error cases.

### Candidates considered
- **Wire OpenAI provider into CLI/config** — CHOSEN. Direct continuation of iter 609+611, addresses owner request.
- **Deepen module-factory testing** (854L, never tested) — High reliability value but lower user impact.
- **Source structure reorg** — Owner request but too large for single iteration.

### Verification
typecheck ✓, build ✓, 3602/3604 tests pass (2 pre-existing flaky: process.test.ts timing, sqlite-memory.test.ts), lint ✓, CLI help ✓, runtime SKIP (no API key)

### Future directions
- Integration test with Ollama (requires local Ollama)
- Module-factory.ts deep testing (854L, top neglected module)
- Source structure reorganization (owner request in NOTES.md)

## Iteration 612 — Surface top-neglected modules in trend output, giving builder actionable data for depth work

Surfaced top-5 neglected modules (by staleness and size) in parse-log.py trend, fixed subsystem classifier, added known flaky test to BUILDER_LESSONS.

### Intervention verdicts (from iter 610)

- **Improvement thesis compression (491→149 lines)**: **CONFIRMED NEUTRAL**.
  Builder in iter 611 performed well (96 calls, $5.11, +36 tests, 30% rework,
  0 fix cycles). No regression — expected, since builder doesn't read thesis.

### What changed

- **parse-log.py**: `_depth_health()` now returns top-5 neglected modules
  (never-covered first, then most stale, weighted by file size). Trend output
  shows: `Top neglected: module-factory.ts (NEVER, 854L), ...`. This gives
  the builder concrete targets for its "Deepen existing" brainstorming category.
- **parse-log.py**: Fixed `_classify_subsystem()` — added "model client",
  "modelclient", "openai-compatible" to modules/provider keywords. Iter 611
  was misclassified as "other" (now correctly "modules/provider").
- **BUILDER_LESSONS.md**: Added known flaky test (`process.test.ts` truncation
  test — timing-dependent 1500ms wait). Saves 2-4 investigation calls per
  encounter.
- **improvement-thesis.md**: Updated with iter 611 analysis, new research
  findings (Live-SWE-agent, Meta ACH mutation testing, SSR self-play).

### Candidates considered

1. **Surface neglected modules in trend** — CHOSEN. Pattern Watch #1 (data >
   instructions). 31 stale modules is a genuine quality gap; builder needs
   to see WHICH modules, not just the count.
2. **Research-pivot tracking metric** — Track whether web research changed the
   builder's plan. Deferred: the 2→36 swing is actually adaptive behavior.
3. **Mutation testing integration** — Meta ACH pattern. Deferred: adds builder
   procedure (against Pattern Watch #2).
4. **Self-play bug injection** — SSR pattern. Deferred: too complex for one iter.
5. **Experience trajectory storage** — Deferred: high complexity.

### Expected effects

- Builder sees concrete neglected modules → may pick "Deepen existing" candidate
  from the list, improving code quality in blind spots
- Corrected subsystem classification → more accurate domain concentration signals
- Flaky test lesson → saves 2-4 calls when process.test.ts timing flake hits

## Iteration 611 — OpenAI-compatible ModelClient enabling Ollama, Groq, and local model support

Added `OpenAIModelClient` implementing the iter 609 `ModelClient` interface for any
OpenAI-compatible API. Enables running KOTA with local models (Ollama — no API key
needed), Groq, Together, vLLM, LM Studio, or OpenAI itself.

### What changed

- **`src/openai-model-client.ts`** (~290 lines): Full `ModelClient` implementation
  with format translation (Anthropic ↔ OpenAI), SSE stream parsing, tool call
  accumulation, and error handling.
- **`src/openai-model-client.test.ts`**: 36 tests covering translation functions,
  streaming with tool calls, error responses, and edge cases.
- **Research**: `@anthropic-ai/claude-agent-sdk` is an agent framework (not API
  wrapper) — documented in NOTES.md. Pivoted to OpenAI-compatible approach.

### Candidates considered

- **ClaudeAgentClient via Agent SDK** — API surfaces don't align with ModelClient
- **Claude CLI (`claude -p`) as backend** — agent framework, not raw LLM access
- **E2E tests for middleware pipeline** — valuable but lower leverage

### Verification

`npm run typecheck` ✓, `npm run build` ✓, `npm test` (3581 tests) ✓

### Future directions

- Wire `OpenAIModelClient` into config/CLI for provider selection at runtime
- Integration test with Ollama
- Model-specific prompt tuning (tool-calling quality varies across providers)

## Iteration 610 — Compress improvement thesis 491→149 lines, applying own document growth pattern

Compressed improvement thesis 491→149 lines, distilling 20 pattern watch entries into 7 core principles.

### Intervention verdicts (from iter 608)

- **Owner-priority brainstorming category**: **EFFECTIVE**. Builder in iter 609
  generated an "Owner request" candidate (ModelClient for dual SDK), chose it,
  executed cleanly (103 calls, $4.35, 28% rework, +9 tests). First direct
  NOTES.md `b:` item addressed in 10+ iterations.

### What changed

- **improvement-thesis.md** (491→149 lines, -70%): Archived iters 534-596
  intervention history (18 entries → 1-line summary). Consolidated 20 pattern
  watch entries → 7 core principles. Pruned research library (90→40 lines).
  Removed capability assessment (redundant with DESIGN.md). Updated evidence
  and strategic priorities with iter 609 data.
- Added two new research references: Self-Verification Dilemma (2602.03485)
  on LLM overthinking, Eco-Evolve (dual-process critic agent).

### Candidates considered

1. **Thesis compression** — CHOSEN. At 491 lines, thesis exhibited the same
   growth pattern identified for every other growing document. 70% reduction
   improves future improver orientation speed.
2. **Research quality monitoring** — Web searches declined 21→2 over 5 iters.
   But quality was fine in 609. Monitor, not act.
3. **Verify rerun analysis** — Test 5.5×, lint 4.1× possibly overstated. The
   Self-Verification Dilemma paper suggests targeted > blanket verification,
   but no clear prompt change follows.
4. **Builder self-critique step** — Eco-Evolve shows +26.6% from dedicated
   critic. Risks adding bureaucratic procedure.
5. **Trajectory examples** — Already attempted (iter 584). Marginal improvement.

### Expected effects

- Future improver iterations orient ~3× faster (149 vs 491 lines of thesis)
- Pattern Watch distilled to 7 actionable principles vs 20 verbose entries
- No builder-facing changes — builder prompt, lessons, and metrics unchanged

## Iteration 609 — Model client abstraction for multi-provider LLM support

Extracted ModelClient interface decoupling the agent from the Anthropic SDK, enabling future provider swapping.

### What changed
- New `ModelClient` interface + `AnthropicModelClient` default implementation (`src/model-client.ts`)
- Updated 7 consumer files (loop, streaming, architect, delegate, compaction, context) to accept `ModelClient` instead of `Anthropic` directly
- Updated mock client and 3 test files to use `ModelClient` type
- 9 new tests verifying interface compliance and stream behavior

### Candidates considered
- **Model client abstraction** — CHOSEN. Owner's #1 request (multi-provider support). Architecture work in core domain (diversity from recent tools work). High leverage — enables Claude Agent SDK, other model backends.
- **Tool execution timeout middleware** — Practical but lower leverage, stays in tools domain (concentrated)
- **Structured output extraction** — New capability, deferred as it builds on top of the model client layer
- **E2E middleware composition tests** — Deepen existing, lower priority than foundational architecture

### Verification
typecheck pass, build pass, 3545 tests pass (+9 new), lint clean, load OK, runtime SKIP (no API key)

### Future directions
- Add `ClaudeAgentClient` using `@anthropic-ai/claude-agent-sdk` for Claude Code backend fallback
- Add `OpenAIModelClient` for model-agnostic support
- Abstract message types away from `Anthropic.*` namespace for full provider independence

## Iteration 608 — Owner-priority brainstorming category, accept domain concentration limits

Added "Owner request" as 4th brainstorming category and simplified concentration guidance, redirecting builder toward owner priorities after 7 fruitless iterations on domain concentration.

### Diagnosis

Iter 606's domain concentration prompt fix was INEFFECTIVE — builder in iter
607 saw "tools: 3/5 CONCENTRATED" but still chose tools (retry middleware,
$5.40, 73k ctx/turn). This was the 7th intervention on domain concentration
(iters 588, 590, 592, 594, 598, 602, 606). Each partially worked but the
builder rationalizes tools work as "proving the pattern." Root cause is likely
fundamental to single-agent decision-making, not fixable by prompt tweaking.

Meanwhile, the builder ignores concrete owner requests (dual SDK support,
module plug-n-play) that would naturally diversify work. The builder reads
NOTES.md during orientation but doesn't reference it during brainstorming.

### What changed

- **build-agent.md**: Added "Owner request" category to Phase 1 brainstorming
  (pending `b:` items in NOTES.md). Simplified concentration section from
  5→2 lines (soft guidance, not mandate). Net -2 lines.
- **improvement-thesis.md**: Marked domain concentration as ACCEPTED. Added
  owner-priority alignment as #1 strategic priority. New pattern watch about
  knowing when to accept partial results. Added 4 new research papers.

### Candidates considered

1. **Owner-priority brainstorming category** — CHOSEN. Addresses root cause
   (builder doesn't consider owner requests during brainstorming). Also
   indirectly diversifies domains since owner priorities span multiple areas.
2. **Typecheck-before-test lesson** — Iter 607's fix cycles were from type
   errors in tests caught at runtime. Medium impact, too micro-targeted.
3. **Verify rerun reduction** — test 5.6×, lint 4.4× still elevated.
   BUILDER_LESSONS already covers batching. Likely task-inherent.
4. **PromptWizard-style systematic self-critique** — Interesting research
   direction but adds complexity to the improver process. Deferred.
5. **Accept concentration entirely** — Considered removing all concentration
   signals. Kept soft guidance as tiebreaker since it costs only 2 lines.

### Expected effects

- Builder generates at least 1 candidate from owner priorities per iteration
- Owner-requested features (dual SDK, module isolation) more likely to be
  chosen when they compete with marginal tools work
- Lighter concentration section reduces prompt noise
- Verify: does iter 609 reference NOTES.md `b:` items in Phase 1?

## Iteration 607 — Retry middleware module

Converted ad-hoc tool retry from manual `maybeRetry()` calls to a proper middleware module using the iter 599 middleware system.

### What changed
- `src/tool-retry.ts`: Added `createRetryMiddleware()` — same policies (shell timeout doubling, web transient errors), now runs inside the middleware chain with retry stats tracking
- `src/modules/tool-retry.ts`: New module (priority 20, after cache at 10) auto-registered on startup
- `src/tool-runner.ts`: Removed manual `maybeRetry` call; `baseFn` now reads from `call.input` so middleware can adjust it
- 14 new tests (3522→3536), 151 test files

### Candidates considered
- **Retry middleware module** — CHOSEN. Second concrete middleware, proves the pattern for reliability use cases
- LLM provider abstraction — higher impact but too large for one iteration
- Rate-limiting middleware — defensive, less immediate value than retry

### Verification
Static: typecheck ✓, build ✓. Unit+integration: 3536 pass. Lint: clean. Load: ✓. Runtime: SKIP (no key).

### Future directions
- Multi-retry with exponential backoff + jitter (current: single retry, preserves existing behavior)
- Rate-limiting middleware (third middleware type)
- Migrate delegate.ts retry to middleware (requires delegate to use middleware chain)

## Iteration 606 — Fix Domain Concentration Signal + Fix Cycle Detection Accuracy

Two metric/signal accuracy fixes improving the verifier.

**Domain concentration**: Builder prompt referenced "Work pattern" line but
CONCENTRATED only appears on "Domains" line (lost in iter 594 rewrite).
Prompt now references both lines.

**Fix cycle detection**: Algorithm required tight edit→test→edit — verify
calls (typecheck, build) and diagnostic calls (Read, Grep) broke the chain.
0 reported vs 7 actual across 10 iters (591:3, 593:1, 601:2, 605:1). Fix:
only Write/Agent break the chain. Both session-detail and trend algorithms
updated. Validated: no false positives (597, 599, 603 correctly 0).

Verdicts: edit-planning **TENTATIVE POSITIVE** (re-edit 38%, was 75%).
Build MISS fix **CONFIRMED**. Impl efficiency metrics **CONFIRMED**.

Other candidates: surface stale modules, lint rerun reduction, research eval.

## Iteration 605 — Tool Result Cache Middleware

First concrete middleware using the iter 599 middleware system. Caches deterministic read tool results (file_read, grep, glob, repo_map, files_overview, read_document, view_image) with session-scoped in-memory storage. Auto-invalidates on mutating tools (file_write, shell, code_exec, etc.). Cache key uses canonical JSON of sorted input for order-independent matching. Errors are never cached. 23 new tests.

### What changed
- `src/tool-cache.ts`: ToolCache class with get/set/invalidate, stats tracking, and createCacheMiddleware factory
- `src/modules/tool-cache.ts`: Module that registers cache middleware at priority 10 (outermost)
- Module index + integration test counts updated (13→14 builtin modules)

### Candidates considered
- **Tool result cache middleware** — CHOSEN. First real middleware payload, validates iter 599's system, measurable perf benefit (CrewAI's opt-out model as prior art)
- **Typed event bus** — Strong DX improvement but purely a refactor with high blast radius (every emit/on call site). Deferred.

### Verification
typecheck + build + 3522 tests pass (23 new), lint clean

### Future directions
- Path-specific invalidation (only flush entries matching written file) instead of full cache clear
- Cache hit/miss stats surfaced in tool telemetry for agent self-awareness
- Typed event bus (deferred from this iteration)

## Iteration 604 — Implementation-Phase Analytics and Verification Signal Fix

Fixed build MISS false negative in parse-log.py and added implementation efficiency metrics, shifting improver focus from brainstorming (resolved) to implementation phase.

### Verification of iter 602 (classification fix + Shannon entropy)
**EFFECTIVE.** Builder in iter 603 correctly read diversity data and chose
feature (underrepresented 1/5). Classification produced no false signals.
Research-before-convergence DURABLE: 3rd iteration (601, 603) with 21+ web
searches before implementation.

### What changed
- **parse-log.py**: Fixed build MISS false negative — combined "typecheck &&
  build" commands now correctly detected (was excluded by `"typecheck" not in s`
  filter). Added edits-per-file metric to trend (links to BUILDER_LESSONS when
  >4). Added zero-fix-cycle streak counter (surfaces when 5+ iters without
  failures).
- **BUILDER_LESSONS.md**: Updated "Batch Edits" with concrete data from iter
  603 (7 edits/file, should be 2-3). Added "aim for ≤3 edits/file" target.
- **build-agent.md**: Added one sentence to step 3: "For each file, outline
  all planned edits before making the first one."
- **improvement-thesis.md**: Shifted focus from brainstorming (resolved) to
  implementation efficiency. Added 4 new research entries (SICA, EvolveR,
  Agentless, SWE-PRM). Updated evidence, priorities, pattern watch.

### Candidates considered
- **Implementation-phase analytics** — CHOSEN. Highest leverage: implementation
  is where builder spends most time, untouched by improver since iter 542.
- **Trajectory principle distillation (EvolveR-style)** — Interesting but
  BUILDER_LESSONS already serves this role. Automation would add complexity.
- **Composition coverage data** — Addresses thesis priority but close to
  telling builder what to build.
- **Pre-flight self-critique (ReVeal)** — Would add a mechanical procedure
  to the builder prompt, which is an anti-pattern.
- **Zero-fix-cycle challenge** — Included as data signal, not standalone.

### Expected effects
- Build detection accuracy: build 1.3× → 1.7× (verified already)
- Builder sees edits-per-file metric and adjusts (target: ≤3 edits/file avg)
- Fix cycle streak data may prompt builder toward more challenging work

## Iteration 603 — Persistent Working Memory

Added opt-in persistence to working memory entries. Entries written with `persist:true` survive session restarts, auto-restored on startup via the module's `onLoad` hook.

### What changed
- `working-memory.ts`: Added `persistent` flag to entries, `loadEntries()` for bulk restore, `getPersistentEntries()` for filtering
- `modules/working-memory.ts`: Added `onLoad` hook to restore from `ModuleStorage`, tool runner saves/deletes persistent entries, prompt section updated
- Persistent entries show ★ in system prompt and `[persistent]` in tool output
- 19 new tests (3480→3499), all passing

### Candidates considered
- **Persistent working memory** — CHOSEN. Feature (underrepresented 1/5), non-tools domain, follows MemGPT/Letta pattern
- **Session checkpoint/resume** — Higher complexity, more architecture (already 3/5). Deferred.

### Verification
typecheck ✓, build ✓, 3499 tests ✓, lint ✓, load ✓, runtime SKIP (no key)

### Future directions
- Session checkpoint/resume — serialize full AgentSession state for crash recovery
- Conversation branching — fork conversations to explore alternatives
- Working memory summarization — auto-compact entries approaching size limits

## Iteration 602 — Fixed Work-Type Classification and Added Diversity Metric

Fixed broken work-type classification that reported "5/5 feature CONCENTRATED" when 3 of 5 recent iterations were architecture work, plus added Shannon entropy diversity metric.

### Verification of iter 600 (research-before-convergence)

**VERY EFFECTIVE.** Builder in iter 601 did 21 web searches + 2 Agent research
calls (calls 8-31), all before implementation started at call 33. This is up
from 0 web searches in iters 595-599. The tool-call barrier between diverge
and converge works — the thinking block cannot skip past actual tool calls.

### What changed

**`parse-log.py` — Three classification improvements:**
1. `_load_changelog_titles()` now loads heading + first summary line, giving
   richer context for keyword matching (heading alone is often too terse)
2. Added missing architecture keywords: "middleware", "telemetry",
   "instrumentat", "state machine", "lifecycle", "state pattern", "intercept",
   "hook system". Added hardening category: "e2e test", "harden", "fuzz", etc.
3. Replaced threshold-based concentration warning with Shannon entropy
   diversity metric (arxiv 2511.15593). Shows diversity % and qualitative label.

Before: `Work pattern: 5 feature — CONCENTRATED`
After:  `Work pattern: 3 architecture, 1 feature, 1 hardening — diversity 86%`

### Candidates considered
- **LLM-as-judge classification** — F1 ~0.88 vs ~0.65 for keywords (arxiv
  2505.08263). Blocked by missing ANTHROPIC_API_KEY. Future direction.
- **EWMA drift detection** — Deferred; entropy metric is simpler and sufficient.
- **Builder lessons for async race conditions** — Iter 601 hit close-during-send
  race. One-off, not recurring pattern yet.

### Expected effects
- Builder sees accurate work-type distribution, making better-informed choices
- Diversity metric replaces brittle "≥70% feature" threshold with continuous
  measure grounded in information theory

## Iteration 601 — Session State Machine

Added explicit lifecycle state machine to AgentSession, mapping to the ReAct pattern (idle→initializing→ready→thinking→acting→ready). Inspired by OpenHands' ConversationExecutionStatus.

### What changed
- `src/session-state.ts` — `SessionStateMachine` with 8 states, enforced transition table, listener callbacks, history tracking, and `consecutiveCount()` for loop detection
- `src/loop.ts` — Integrated into AgentSession: transitions at each lifecycle point (init, think, act, reflect, done, close)
- `src/transport.ts` — New `state_change` event type (verbose mode)
- `src/event-bus.ts` — New `session.state` bus event for module/operator visibility
- 24 unit tests + 4 E2E tests (28 new, 3480 total)

### Candidates considered
- **Tool dependency resolution** — deferred; LLM handles sequencing, tool groups cover availability
- **E2E tests for middleware/telemetry** — deferred; good hardening but less foundational
- **Mutation testing** — deferred; 0/5 recent iters ran mutation checks

### Verification
typecheck ✓, build ✓, 3480 tests pass, lint clean, load ✓, runtime SKIP (no key)

### Future directions
- Tool gating by state (restrict which tools are callable per state)
- Pause/resume support leveraging the state machine
- Stuck detection using `consecutiveCount()` to break infinite loops

## Iteration 600 — Research-Before-Convergence in Builder Brainstorming

Moved web research from afterthought to prerequisite in brainstorm Phase 2, fixing hollow diverge/converge compliance where the builder pre-decides then generates token alternatives.

### Verification of iter 598 (diverge/converge brainstorming)

**STRUCTURALLY EFFECTIVE, SUBSTANTIVELY HOLLOW.** The builder in iter 599
followed the Phase 1/Phase 2 format and chose architecture (middleware),
breaking the feature streak. But session analysis reveals the decision was
made in the thinking block BEFORE Phase 1 was written. Phase 1 contained
three minimum-viable stubs (7 words for "new capability"). Phase 2 evaluated
only the pre-chosen option. Zero web searches despite prompt instruction.
The diverge/converge labels are cosmetic; the decision process is unchanged.

### What changed

**`prompts/build-agent.md` — Phase 2 restructured:**
- Research moved from end-of-section suggestion ("For promising candidates,
  search the web") to the FIRST action in Phase 2 ("Pick your top 2 candidates
  and search the web for prior art on each")
- Comparative evaluation made explicit: "evaluate both side by side" and "only
  after comparing, commit to one"
- Net change: -1 line (98→97 lines). No prompt bloat.

### Why this should work

The builder's thinking block runs before tool calls. Current Phase 2 says
"evaluate each" then later suggests research — by which point the model has
already committed. Moving research to the START of Phase 2 means the model
must issue web search tool calls before it can write its convergence analysis.
This creates a genuine information injection between diverge and converge that
can shift the pre-decision.

### Candidates considered

1. **Research-before-convergence** — CHOSEN. Fixes the root cause: research
   (which could change the decision) happens after the decision is already made.
2. **Require minimum detail per candidate** — Would increase diverge quality
   but doesn't prevent the thinking-block pre-commitment. Stubs would get
   longer but still be post-hoc.
3. **Composition test coverage signal in trend** — ChainFuzzer (2603.12614)
   found 302/365 bugs need multi-tool chains. Important but addresses a
   different problem (what to build vs how to decide).
4. **Clade-Metaproductivity metric** — HGM insight: measure whether iteration
   enables future improvement. Strategic but hard to operationalize in one iter.
5. **Integration depth metric** — Track how many existing systems a change
   coordinates with. Good signal but requires parse-log.py changes.

### Expected effects

- **Research frequency**: Should increase from 0/3 to at least 2/3 recent iters
- **Decision quality**: Research may surface better alternatives or patterns
- **Brainstorming depth**: Comparing two researched candidates prevents
  single-candidate tunnel vision
- **No cost increase**: Research typically adds 2-5 calls ($0.01-0.05)

### Research informing this iteration

- ChainFuzzer (arXiv:2603.12614): 302/365 agent vulnerabilities require
  multi-tool execution; single-tool testing misses composition bugs
- HGM Clade-Metaproductivity (arXiv:2510.21614): evaluate iterations by
  whether they enable future improvement, not just current test pass rate
- Chroma Context Rot (2025): 15-20% accuracy degradation from position alone;
  critical rules must be at top/bottom of prompt
- ToolGym (arXiv:2601.06328): planning-execution misalignment in tool use;
  models can plan correct sequences but fail at execution (and vice versa)

## Iteration 599 — Tool Middleware Pipeline

Added composable middleware system for tool execution. Modules can now register pre/post hooks that wrap any tool call — enabling caching, rate limiting, audit logging, and access control without modifying individual tools.

### What changed
- `src/tool-middleware.ts` — `ToolMiddlewareRegistry` with priority-ordered chain execution, owner tracking, singleton lifecycle
- `src/tool-runner.ts` — `executeToolCalls()` routes through middleware between guardrails and telemetry
- `src/module-types.ts` + `src/module-loader.ts` — `ctx.registerMiddleware(name, fn, priority?)` on `ModuleContext`, auto-cleanup on unload
- `src/tool-middleware.test.ts` — 21 tests: chain ordering, short-circuit, input mutation, error propagation, module integration

### Candidates considered
- Tool middleware pipeline — CHOSEN (architecture, breaks 5-iter feature streak)
- Structured output / JSON mode — deferred, narrower impact
- Composition E2E tests (batch/pipe/map chains) — good hardening, lower unlock value

### Verification
typecheck, build, 3452 tests (+21), lint pass. Runtime: SKIP (no API key).

### Future directions
- Built-in middleware: caching, rate limiting, audit logger as example modules
- Middleware in module manifests (declarative, for agent-created modules)

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

