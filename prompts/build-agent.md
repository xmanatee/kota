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

**Repo map (P1)** — a structural index of the codebase for better context:

What it does: Scans project files and extracts a compact summary — file paths, exported functions/classes/constants, and their signatures. This lets the LLM understand the codebase structure without reading every file.

How Aider does it (for reference, NOT to copy): Full AST parsing via tree-sitter, then ranks symbols by relevance using PageRank on reference graphs. This is ~500 lines and requires native tree-sitter bindings. Too complex for KOTA.

Recommended approach for KOTA — regex-based extraction:
- New file `src/repo-map.ts` (target: ~80-100 lines)
- Scan `.ts`, `.js`, `.py` files (skip `node_modules`, `dist`, `.git`)
- Extract signatures via regex patterns:
  - TS/JS: `export function NAME(`, `export class NAME`, `export const NAME`, `export default`, `interface NAME`, `type NAME =`
  - Python: `def NAME(`, `class NAME`
- Output format: a compact tree grouped by file path, one line per symbol
- Example output:
  ```
  src/loop.ts
    export function runAgentLoop(prompt, options): Promise<string>
    export type LoopOptions
  src/tools/shell.ts
    export function runShell(input): Promise<ToolResult>
    export const shellTool: Anthropic.Tool
  ```

Integration — two uses:
1. **New tool `repo_map`**: Takes optional `directory` and `glob` params. Returns the map as text. The agent can call it on demand to orient itself.
2. **Context injection**: Optionally inject a compact version into the system prompt when the agent starts in a directory. Keep it short — just file names + top-level exports. Too much detail bloats the context.

Key design decisions:
- Use the existing `glob` dependency to find files (already in package.json)
- Read files with `fs.readFileSync` and regex — no new dependencies
- Truncate output if the repo is huge (cap at ~100 files or ~200 symbols)
- Unknown file types are silently skipped

**Sub-agent delegation (P2)** — exploration without polluting main context:

What it does: Spawns a separate LLM call with read-only tools to explore the codebase, then returns just the summary to the main conversation. The main context only sees the question and answer, not the intermediate tool calls.

Implementation sketch:
- New tool `delegate` in `src/tools/delegate.ts` (~80-100 lines)
- Takes `{ task: string }` as input
- Creates a fresh `Anthropic.messages.create()` call with a mini-loop (like the editor loop in architect.ts)
- Available tools: only `file_read`, `grep`, `glob` (read-only exploration)
- Max turns: 10 (exploration should be bounded)
- Returns the sub-agent's final text response as the tool result
- Main loop sees: `delegate({ task: "find all API endpoints" })` → `"Found 12 endpoints in src/routes/..."`

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
