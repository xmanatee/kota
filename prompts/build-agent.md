# Task: Build the Ultimate AI Coding Agent

You are a world-class software architect and implementer. Your job: design and build an AI coding agent that is better than Claude Code, Codex CLI, Aider, OpenHands, and SWE-agent.

## CRITICAL CONSTRAINTS

**Working directory: `{{TOOL_DIR}}`**
You MUST only create, read, and modify files inside this directory. Never `cd` outside it. Never reference or access files outside it. This constraint is absolute and non-negotiable.

**Iteration: #{{ITERATION}}**
Check `{{TOOL_DIR}}/CHANGELOG.md` to understand what was already done. Do NOT redo work from previous iterations. Build on top of it.

**Git history**: Run `git log --oneline -20` inside `{{TOOL_DIR}}` to see what happened in all previous iterations. Each iteration auto-commits its changes, so the full history of the project is in git. Use `git log`, `git diff`, and `git show` to understand previous work.

## Phase Strategy

**If this is iteration 1-2 (early stage):**
Before writing ANY code, research the state of the art. You MUST:

1. **Study existing agents** — search the web for architecture details of:
   - Claude Code: master agent loop, tool system, sub-agents, TodoWrite, context compaction (read https://www.anthropic.com/engineering/claude-code-best-practices)
   - Codex CLI: shell + apply_patch two-tool design, prompt caching (read https://openai.com/index/unrolling-the-codex-agent-loop/)
   - Aider: Architect/Editor split, repo map, auto-commits (search for "aider architect editor pattern")
   - OpenHands: event-sourced state, Docker sandbox, AgentDelegateAction
   - SWE-agent: Agent-Computer Interface, linter-gated edits

2. **Read key articles:**
   - "Building Effective Agents" by Anthropic — the 5 composable workflow patterns
   - "Writing Tools for Agents" by Anthropic — tool design as contracts for non-deterministic clients
   - ghuntley/how-to-build-a-coding-agent on GitHub — a ~300-line minimal agent built in 6 stages

3. **Design the architecture** in a `DESIGN.md` file before writing implementation code:
   - What is the core loop? (input → reason → tool call → observe → repeat)
   - What tools does the agent need? (file read/write/edit, shell, grep, glob, todo tracking)
   - What is the context management strategy? (static prefix, dynamic suffix, compaction triggers)
   - How does the Architect/Editor split work?
   - What makes YOUR agent better than existing ones?

4. **Then implement** the minimal core — CLI entry point, agent loop, 2-3 essential tools.

**If code already exists (iteration 3+):**
1. **Pre-flight**: Run `npm install && npm run typecheck && npm run build` to confirm the codebase is healthy before touching anything. If something is broken, fix it first.
2. **Orient**: Read ALL existing source files in `{{TOOL_DIR}}/src/` to understand current state. Read `CHANGELOG.md` — look for the "Next iteration priorities" section from the most recent iteration. Those priorities are your primary input for what to work on.
3. **Pick the highest-impact priority**: Choose the top P1 item from the previous iteration's priorities. If closely related improvements can be done together, tackle 2-3, but prefer depth over breadth.
4. **Implement**: Write the code, then verify with `npm run typecheck && npm run build`.
5. **Update CHANGELOG.md**: Document what you built and list the next priorities for the following iteration.

## Architecture Requirements

Build in TypeScript/Node.js. The agent should have these modules:

| Module | Purpose | Priority |
|--------|---------|----------|
| `src/cli.ts` | Entry point, argument parsing (Commander.js) | P0 |
| `src/tools/` | Tool implementations (read, write, edit, shell, grep) | P0 |
| `src/context.ts` | Conversation history + compaction | P1 |
| `src/planner.ts` | Task decomposition, TodoWrite-style tracking | P1 |
| `src/repo-map.ts` | Structural index of codebase (function signatures, imports) | P2 |
| `package.json` | Dependencies and scripts | P0 |
| `tsconfig.json` | TypeScript configuration | P0 |
| `DESIGN.md` | Living architecture document | P0 |

### Design Principles (non-negotiable)
- **Simplicity first**: Start with ~300 lines of core loop. Add complexity only when simpler solutions fail.
- **Two-tool minimum viable**: Shell + file editor gets you 80% of capability (proven by Codex CLI)
- **Architect/Editor split**: Separate reasoning about WHAT to do from generating edits (proven by Aider to produce SOTA results)
- **Tool design as API contracts**: Tools must be defensively designed — clear names, meaningful errors, token-efficient output
- **Linter-gated edits**: Reject edits that introduce syntax errors (proven by SWE-agent)
- **Files ≤ 300 lines each**

### Implementation Hints for Current Priorities

**Multi-file edit batching (P1)** — allow multiple edits in a single tool call to reduce round-trips:

Current state: `file_edit` in `src/tools/file-edit.ts` accepts one `{path, old_string, new_string, replace_all}` per call. When the agent needs to make 5 related edits across 3 files, that's 5 separate tool calls, each costing a full LLM round-trip. While the loop already executes tool calls in parallel via `Promise.all`, the LLM still has to enumerate each one in its response (token overhead per tool_use block).

Recommended approach — create a new `multi_edit` tool alongside the existing `file_edit` (keep `file_edit` for simple single-edit cases):

- New file `src/tools/multi-edit.ts` (~80 lines):
  - Tool name: `multi_edit`
  - Description: "Apply multiple edits across one or more files atomically. All edits succeed or all are reverted."
  - Input schema:
    ```
    edits: Array<{ path: string, old_string: string, new_string: string, replace_all?: boolean }>
    ```
  - Implementation:
    1. Validate all inputs upfront (paths exist, old_strings found, uniqueness checks)
    2. Save original contents of all affected files in a `Map<string, string>`
    3. Apply edits sequentially — for each edit, do the same logic as `runFileEdit` (find, replace, lint)
    4. If ANY edit fails (not found, ambiguous match, lint failure): revert ALL files from the saved map
    5. Return a summary: "Applied N edits across M files" or the first error with all reverts noted
  - This gives atomicity — partial edits don't leave the codebase in a broken state
  - The lint check runs after each individual edit (not just at the end) so the error message is specific

- In `src/tools/index.ts`: Import and register `multiEditTool` and `runMultiEdit` alongside existing tools (10 tools total)

- Keep `file_edit` unchanged — it's simpler for single edits and the LLM can choose which to use

Key detail: The atomicity is the main value-add over multiple parallel `file_edit` calls. If edit 3 of 5 breaks a lint check, edits 1 and 2 are reverted too. This prevents cascading errors from partial multi-file changes.

**Cost tracking (P1)** — display running cost estimate based on token usage and model pricing:

Current state: `loop.ts` already has `response.usage` with `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. These are logged in verbose mode but not translated to dollars.

Recommended approach — new `src/cost.ts` module (~50 lines):

- Define pricing as a simple record (per million tokens):
  ```typescript
  const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  };
  ```
  - Cache reads = 0.1x input price, cache writes = 1.25x input price
  - Unknown models: fall back to Sonnet pricing with a warning

- `CostTracker` class:
  - `addUsage(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): void`
  - `getTotalCost(): number` — returns total in dollars
  - `getSummary(): string` — returns formatted string like `"$0.0342 (12.5K in, 2.1K out, 8.3K cache)"`
  - Accumulate totals across all turns for running cost

- In `loop.ts`:
  - Create `CostTracker` instance at the top of `runAgentLoop`
  - After each `response`, call `tracker.addUsage(model, response.usage)`
  - Display cost after every turn (not just in verbose mode — cost is always useful):
    ```
    [kota] Turn 5 — $0.0342 total
    ```
  - At end of loop, print final cost summary to stderr

- In `cli.ts`: No changes needed — cost tracking is always on (it's small overhead and always valuable information)

Key detail: The `response.usage.input_tokens` already EXCLUDES `cache_read_input_tokens` — cached tokens are reported separately. So the cost calculation is:
```
cost = (input_tokens * inputPrice + output_tokens * outputPrice + cache_read * cacheReadPrice + cache_creation * cacheWritePrice) / 1_000_000
```
Don't double-count cached tokens.

### What Makes a Great Agent (aim for these)
- Fresh context management (compaction at 75-92% capacity)
- Sub-agent delegation for exploration without polluting main context
- Prompt caching for linear cost (not quadratic)
- TodoWrite-style task tracking injected as system messages
- Circuit breaker: stop after 3 identical failed attempts

## Output Requirements

- Write real, working code (not pseudocode, not plans-only)
- Every file must be syntactically valid
- Run `npm run typecheck && npm run build` before finishing to confirm nothing is broken
- Update `CHANGELOG.md` — use this exact heading format (step.sh parses it):
  ```
  ## Iteration {{ITERATION}} — Short Title

  What you did...

  ### Next iteration priorities
  - P1: ...
  - P2: ...
  ```
