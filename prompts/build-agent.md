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
| `src/loop.ts` | Core agent loop: reason → act → observe | P0 |
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
