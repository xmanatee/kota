# KOTA Changelog

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
