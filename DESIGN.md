# KOTA — Keep Only The Awesome

A general-purpose AI agent built on Claude. Synthesizes ideas from Claude Code, Codex CLI, Aider, SWE-agent, and OpenHands.

## Research Summary

| Agent | Key Insight Borrowed |
|-------|---------------------|
| Claude Code | Sub-agent delegation, task tracking, context compaction |
| Codex CLI | Two-tool MVP (shell + apply_patch), prompt caching via static prefix |
| Aider | Architect/Editor split — separate reasoning from edit generation |
| SWE-agent | Linter-gated edits — reject changes that break syntax |
| OpenHands | Event-sourced conversation state (clean replay/compaction) |

## Architecture

### Core Loop (`src/loop.ts`)

```
User prompt → LLM call (system + messages + tools)
  → Text reply? → Return to user
  → Tool calls? → Execute in parallel → Append results → Loop back
```

The simplest agent is just an LLM in a while loop with tools. `AgentSession` maintains context across multiple prompts for interactive REPL use.

### Transport Layer (`src/transport.ts`)

All agent I/O is decoupled from the terminal via a typed event system. The agent emits `AgentEvent`s through a `Transport` interface — it never writes directly to stdout/stderr.

**Event types**:
- `text` — streamed response text (main agent output)
- `thinking` / `thinking_start` — extended thinking tokens
- `progress` — sub-agent or architect streaming output (with optional `source` tag)
- `status` — operational messages ("[kota] Turn 3", "[kota] Compacting...")
- `cost` — token usage and context budget updates
- `error` — non-fatal error information

**Built-in transports**:
- `CliTransport` — renders to stdout/stderr (default, reproduces original terminal behavior)
- `BufferTransport` — collects events in-memory (testing, batch processing)
- `NullTransport` — discards everything (headless/benchmarking)

**Embedding KOTA in other frontends** (Telegram, web, Discord):
```typescript
import { AgentSession, type Transport, type AgentEvent } from "kota";

class TelegramTransport implements Transport {
  emit(event: AgentEvent) {
    if (event.type === "text") sendToChat(event.content);
  }
}
const session = new AgentSession({ transport: new TelegramTransport() });
await session.send("What's the weather?");
```

Transport is threaded through `AgentSession` → `streamMessage()` → `runArchitectStep()` → `runDelegate()` → `executeToolCalls()`. Every component that previously wrote to stdout/stderr now emits events instead.

### Context Management (`src/context.ts`)

Three-phase lifecycle to maximize usable context:

1. **Pruning** (50% budget): Replace large read-only tool results with compact summaries. Deterministic, no LLM call. Preserves conversation structure.
2. **Compaction** (75% budget): Two-phase — deterministic state extraction (files modified, commands run, errors) + LLM narrative summary. Keeps recent 10 messages intact.
3. **Adaptive truncation**: Tool result size limits shrink as budget fills (50K → 15K → 5K chars).

Split system blocks: static prompt (cached) + dynamic state (uncached, changes per turn).

### Token Budget Awareness

Each turn shows `context: N%`. Above 50%, budget warnings appear in the dynamic system prompt. Tool results auto-truncate based on remaining budget (head + tail with notice).

### Streaming (`src/streaming.ts`)

Mid-stream failures retry up to 3 times with jittered exponential backoff. Auth/config errors fail fast; transient errors retry. Text streams to stdout, thinking to stderr.

### Tool Design Principles

From Anthropic's "Writing Tools for Agents":
1. Tools are API contracts — clear names, typed parameters, meaningful errors
2. Output is token-efficient — no verbose dumps, paginated where needed
3. Errors guide the agent — "File not found at X. Did you mean Y?" not "ENOENT"

### Linter-Gated Edits (`src/lint.ts`)

After each `file_edit`/`file_write`, syntax is checked (JSON.parse, node --check, esbuild, python3 ast.parse). On failure, file is auto-reverted. Prevents cascading errors from bad edits.

### Smart Edit Error Recovery (`src/tools/file-edit.ts`)

Two-tier recovery when `old_string` not found:
1. **Whitespace-tolerant auto-fix**: Normalize indentation/trailing spaces, re-match. Must be unambiguous and ≥10 non-WS chars. Still lint-gated.
2. **Fuzzy match display**: Bigram (Dice) similarity finds closest region, shows it with line numbers and context so the agent can self-correct.

### Sub-Agent Delegation (`src/tools/delegate.ts`)

Two modes:
- **`explore`**: Research with read + execution tools (file_read, grep, glob, repo_map, web tools, code_exec, shell, http_request). Max 10 turns.
- **`execute`**: Can modify files and run commands (adds file_edit, file_write, multi_edit, shell@60s). Max 15 turns. Tracks and reports modified files.

Fresh API call per delegation — main context only sees task + final answer. Sub-agent text streams to stderr for live progress visibility. Robustness: prompt caching across turns, tool result truncation (30K cap), circuit breaker on 3 identical failures, and context overflow handling with actionable errors.

### Background Process Management (`src/tools/process.ts`)

Enables async workflows — start servers, run watchers, monitor long-running tasks:
- **start**: Spawn a command as a background process. Returns PID and initial output.
- **output**: Get recent stdout/stderr from a running process (circular buffer, last 500 lines).
- **signal**: Send SIGTERM/SIGINT/SIGKILL to a process.
- **list**: Show all managed processes with status, uptime, and last output line.

Max 5 concurrent processes. All auto-terminated on session close. Same dangerous-command detection as shell tool.

### Architect/Editor Split (`src/architect.ts`)

From Aider's research (+3-8% on benchmarks):
1. **Architect pass**: LLM without tools produces a step-by-step plan.
2. **Editor pass**: Fresh conversation with only file tools executes the plan (up to 30 turns).
3. **Main loop** continues with all tools for verification.

### Prompt Caching

System prompt sent with `cache_control: { type: "ephemeral" }`. Static prefix cached at 0.1x cost. Only new messages pay full price.

### Session Warmup (`src/init.ts`)

Auto-detects project type (Node.js, Python, Rust, Go), git state (branch, dirty files, recent commits), and recalls relevant memories. Agent starts oriented from turn 1.

### Project Context (`src/project-context.ts`)

Reads `.kota.md` files from working directory up to root (like Claude Code's CLAUDE.md). Injected into system prompt.

### Persistent Memory (`src/memory.ts`)

Cross-session memory in `~/.kota/memory.json`. Save/search/list/delete with keyword ranking. Auto-prune at 100 entries.

### Safety & Error Recovery

- **Destructive command confirmation** (`src/confirm.ts`): Regex patterns detect rm, sudo, git push, etc.
- **Progressive failure tracking** (`src/tool-runner.ts`): 3 identical failures → circuit break; 5 diverse failures → guidance injection.
- **Automatic tool retry** (`src/tool-retry.ts`): Transient failures (timeouts, network, HTTP 429/5xx) retry once with adjusted params.
- **File freshness tracking** (`src/file-tracker.ts`): mtime-based stale detection between reads and edits.
- **Smart path resolution** (`src/path-resolver.ts`): File-not-found errors show similar files via basename + fuzzy match.
- **Shell error diagnostics** (`src/shell-diagnostics.ts`): Extracts diagnostic-relevant lines from long output (TypeScript errors, test failures, lint errors).
- **Error context enrichment** (`src/error-context.ts`): Pre-fetches source code around file:line references in errors.
- **Verification nudges** (`src/verify-tracker.ts`): Tracks unverified edits, detects available test/build commands, escalates after 3 turns.

### Interactive Code Execution (`src/tools/code-exec.ts`)

Persistent REPL sessions (Python / Node.js) for iterative computation. Wrapper processes use a sentinel-based protocol: code lines are sent via stdin until a sentinel marker, then executed, with a done marker printed to stdout when complete. State (variables, imports) persists across calls within a session. AST-based last-expression extraction (Python) displays return values like IPython. Sessions are managed per-language and cleaned up on agent shutdown.

**Matplotlib auto-capture** (`src/plot-capture.ts`): Python wrapper sets `MPLBACKEND=Agg` and captures open matplotlib figures after each execution (up to 5). Images are saved as temp PNGs, extracted from output via markers, read as base64, and returned as image blocks in the tool result. The agent can see its own charts and iterate on visualizations. Seaborn works automatically (uses matplotlib backend).

### Plugin System (`src/plugin-types.ts`, `src/plugin-loader.ts`)

File-based plugin architecture for extending KOTA without modifying core code. Drop `.js`/`.mjs` files in `.kota/plugins/` — they're auto-discovered and loaded on startup.

**Plugin interface** (`KotaPlugin`):
- `name`: Unique identifier (required)
- `tools`: Array of `ToolDefinition` — each provides an Anthropic tool schema + runner function
- `onLoad(ctx)`: Lifecycle hook called after registration. `PluginContext` provides `cwd`, `verbose`, and `registerGroup()` for custom tool groups with auto-detect patterns
- `onUnload()`: Cleanup hook called on session close

**Tool registration**:
- Tools with a `group` property follow progressive disclosure (hidden until `enable_tools` is called)
- Ungrouped tools are always available
- Plugin groups appear in the `enable_tools` description dynamically
- `registerGroup()` supports auto-detect regex patterns for automatic group activation

**Lifecycle**: `PluginManager.loadAll()` runs during session init (parallel with MCP). `unloadAll()` clears tools, groups, and calls `onUnload` hooks.

### MCP Support (`src/mcp-client.ts`, `src/mcp-manager.ts`)

External tool servers via Model Context Protocol. Configure in `.kota/mcp.json`. Tools namespaced as `mcp__<server>__<tool>`. Stdio transport, graceful degradation.

### Vision

`file_read` handles images (PNG, JPEG, GIF, WebP) natively — base64-encoded and sent as Anthropic image content blocks. Rich tool results (`ToolResult.blocks`) support mixed text + image content.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI parsing
- `glob` — File pattern matching
- `vitest` — Testing (dev)
