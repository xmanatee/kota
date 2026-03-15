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

### HTTP API Server (`src/server.ts`)

Makes KOTA accessible via HTTP — the bridge from CLI-only agent to embeddable service. Any frontend (web UI, Telegram bot, Discord bot, automation pipeline) can connect via standard HTTP.

**Endpoints**:
- `POST /api/chat` — Send `{ message, session_id? }`, receive SSE stream of agent events
- `POST /api/sessions` — Create a new session, returns `{ session_id }`
- `GET /api/sessions` — List active sessions with busy/idle status
- `DELETE /api/sessions/:id` — Close and clean up a session
- `GET /api/schedules` — List pending scheduled items (JSON)
- `GET /api/notifications` — SSE stream for real-time reminder notifications
- `GET /api/health` — Health check with session count

**SSE event stream** (maps 1:1 to `AgentEvent` types):
```
event: session
data: {"session_id":"abc12345"}

event: text
data: {"type":"text","content":"Hello!"}

event: status
data: {"type":"status","message":"[kota] Turn 1"}

event: done
data: {"session_id":"abc12345","result":"Hello!"}
```

**Key design decisions**:
- **ProxyTransport pattern**: Each `AgentSession` gets a `ProxyTransport` whose target is swapped per-request. The SSE transport for the current HTTP response is set as target during `send()`, then reset to `NullTransport` after. Zero changes to `AgentSession`.
- **SessionPool**: Manages session lifecycle — create, get, delete, TTL-based cleanup (30 min idle), LRU eviction at capacity (max 10). Busy sessions can't be evicted.
- **Concurrency**: One request per session at a time (409 Conflict for concurrent requests to same session).
- **No external deps**: Pure `node:http`. CORS enabled by default.

**Usage**: `kota serve --port 3000`

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

### Persistent Tasks (`src/task-store.ts`)

Cross-session task tracking that survives session restarts. Tasks are stored per-project in `~/.kota/tasks-<hash>.json` where `<hash>` is derived from the project directory path.

**Key capabilities**:
- **Project-scoped isolation**: Each project gets its own task file. No cross-contamination.
- **Session resume**: Active tasks recalled during session warmup — the agent knows what was in progress.
- **Auto-pruning**: Completed tasks beyond 15 are automatically pruned (oldest first). Orphaned children are also removed.
- **Notes**: Tasks can carry progress notes for cross-session context (e.g., "found 3 sources, comparing").
- **Archive**: Explicitly clear all completed tasks via `archive` action.

**Integration with todo tool**: The `todo` tool uses `TaskStore` as its backend. All existing features (subtasks, priorities, dependencies) are preserved. Tasks persist automatically — no special action needed.

**Session warmup**: `buildSessionWarmup()` in `init.ts` checks for active tasks and includes a summary (e.g., "2 in progress: 'Research competitors', 'Write report'; 3 pending") so the agent can resume from where it left off.

**In-memory mode**: When `storageDir` is `null`, the store operates without file I/O (used in tests and sub-agents).

### Scheduler (`src/scheduler.ts`, `src/tools/schedule.ts`)

Time-aware scheduling for reminders, recurring tasks, and autonomous agent actions. Enables the agent to "remind me in 30 minutes", "check this every hour", or proactively execute tasks on a schedule.

**Time parsing** (`parseTime`):
- ISO datetime: `"2025-06-15T14:00:00Z"`
- Relative: `"in 30 minutes"`, `"in 2 hours"`, `"in 1 day"`
- Time today/tomorrow: `"at 3pm"`, `"tomorrow at 9am"`, `"at 15:00"`

**Repeat parsing** (`parseRepeat`):
- Named: `"daily"`, `"hourly"`
- Interval: `"every 30 minutes"`, `"every 2 hours"`

**Persistence**: Same project-scoping pattern as TaskStore — `~/.kota/schedules-<hash>.json`. Auto-prunes old fired items (keeps last 20). In-memory mode for tests.

**Schedule tool** (in `management` group): `add` (create reminder with time + optional repeat + optional agent_action), `list` (pending items), `cancel` (by ID). Auto-detected from prompts containing "remind", "schedule", "alarm", etc.

**Session warmup**: Overdue and upcoming items appear at session start, so the agent can notify the user about missed reminders.

**Server integration**: When running `kota serve`, a 30-second timer checks for due items and pushes them as SSE notifications to connected clients via `GET /api/notifications`. Also exposes `GET /api/schedules` for listing pending items.

**Repeating items**: After firing, the next trigger time advances by the interval. If multiple intervals were missed, jumps to the next future occurrence rather than firing repeatedly.

### Autonomous Scheduled Actions (`src/action-executor.ts`)

Transforms KOTA from a reactive tool into a proactive agent. Scheduled items can carry an `action` prompt that KOTA executes autonomously when triggered — no user input needed.

**How it works**:
1. User schedules an item with `agent_action`: "Check the weather in NYC and save to /tmp/weather.txt"
2. When the scheduler fires, `ActionExecutor` creates a lightweight agent session with `BufferTransport`
3. The action prompt is wrapped with context from the schedule description
4. The agent executes the prompt (using all available tools), collects the result
5. Results are delivered via SSE notifications (server) or printed to stderr (REPL)

**Concurrency**: Max 3 concurrent actions by default. Actions that exceed the limit are skipped with a notification. Each action has a 120s timeout.

**Server mode**: Due items are partitioned by `partitionDueItems()`:
- Items without `action` → notification-only (SSE `reminder` event, as before)
- Items with `action` → `ActionExecutor.execute()` runs asynchronously, delivers `action_started`, `action_result`, or `action_skipped` SSE events

**CLI REPL mode**: Scheduler timer runs between user turns. Due actions execute in the background. Results print to stderr so they don't interfere with the conversation flow.

**Example**: "Every morning at 8am, check Hacker News for AI news and summarize the top 5 stories" — KOTA runs this autonomously and delivers the summary without being prompted.

### Persistent Memory (`src/memory.ts`)

Cross-session memory in `~/.kota/memory.json`. Save/search/list/delete with keyword ranking. Auto-prune at 100 entries.

### Conversation History (`src/history.ts`)

Automatic conversation persistence that lets KOTA resume previous conversations across sessions. Every `AgentSession` auto-saves to `~/.kota/history/` — the agent remembers what you were working on and can pick up where you left off.

**Storage**: Each conversation is stored as `~/.kota/history/<id>.json` with full message history + metadata. An `index.json` file provides fast listing without reading every conversation file.

**ConversationRecord metadata**: id, title (auto-generated from first user message), createdAt, updatedAt, model, messageCount, cwd (project directory).

**Auto-save lifecycle**:
1. `AgentSession` constructor creates a new conversation entry (unless `noHistory: true` or using legacy `--session`)
2. After each tool-execution turn and at end of `send()`, state is saved to history
3. On SIGINT, state is saved before exit

**CLI commands** (`kota history`):
- `list` — recent conversations, filterable by `--search`, `--limit`, `--all` (cross-directory)
- `show <id>` — conversation details and message preview
- `resume <id>` — resume in interactive mode
- `delete <id>` — remove a conversation
- `clear` — delete all conversations for current directory

**Resume shortcut**: `kota run --continue` resumes the most recent conversation for the current directory. `kota run --continue <id>` resumes a specific conversation.

**Session warmup**: At session start, if a recent conversation (< 7 days) exists for the current directory, a hint is shown: "Previous conversation: 'Fix auth bug' (5 messages, 2 hours ago). Resume with: kota run --continue"

**API endpoints** (HTTP server):
- `GET /api/history` — list conversations (supports `?search=` and `?limit=`)
- `GET /api/history/:id` — full conversation data
- `DELETE /api/history/:id` — remove a conversation

**Auto-prune**: Oldest conversations beyond 50 are automatically deleted when new ones are created. Project-scoped: conversations are tagged with their working directory for filtering.

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

### Tool Format Adapters (`src/tool-adapters.ts`)

Plugins don't need to use KOTA's native `ToolDefinition` format. The adapter layer auto-detects and converts common formats:

**Supported formats**:
- **Native KotaPlugin**: `{ name, tools: [{ tool, runner }] }` — pass-through
- **Simple**: `{ name, description, parameters, run }` — minimal, one function per tool
- **OpenAI function-calling**: `{ type: "function", function: { name, description, parameters }, run }` — compatible with OpenAI ecosystem tools
- **Array**: `[simpleTool, openAITool, ...]` — multiple tools from one file, any mix of formats
- **Hybrid KotaPlugin**: `{ name, tools: [simpleTool, ...], onLoad, onUnload }` — plugin with lifecycle hooks but simple-format tools

**Result normalization**: External tool `run` functions can return strings, numbers, objects, or `{ content, text }` — all normalized to KOTA's `ToolResult`. Native `{ content: string }` passes through unchanged.

**Programmatic API**: `fromSimple(def)` and `fromOpenAI(def)` for explicit conversion. `adaptExport(moduleExport, fileName)` for auto-detection (used by `PluginManager`).

**Example — simple format plugin** (`.kota/plugins/weather.mjs`):
```js
export default {
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  run: async ({ location }) => `Weather in ${location}: 72°F, sunny`,
};
```

**Example — OpenAI format** (drop-in from OpenAI ecosystem):
```js
export default {
  type: "function",
  function: {
    name: "calculate",
    description: "Evaluate a math expression",
    parameters: { type: "object", properties: { expr: { type: "string" } } },
  },
  run: async ({ expr }) => eval(expr),
};
```

### Configuration (`src/config.ts`)

Layered configuration system with three levels of precedence:

1. **Global** (`~/.kota/config.json`): User-wide defaults (model, user profile, aliases)
2. **Project** (`.kota/config.json`): Project-specific overrides (autoEnable groups, model for this project)
3. **CLI flags / overrides**: Highest precedence, always wins

**Schema** (`KotaConfig`):
- `model`, `editorModel`, `maxTokens`: LLM settings
- `architect`, `thinking`, `thinkingBudget`: Behavior modes
- `verbose`, `skipConfirmations`: UX preferences
- `autoEnable`: Tool groups to activate at session start (e.g., `["web", "code"]`)
- `user.name`, `user.context`: User profile injected into system prompt for personalization
- `aliases`: Prompt expansion shortcuts (e.g., `{"/research": "Enable web tools and research: "}`)

**User profile** is injected into the system prompt between project context and session warmup. This lets the agent personalize responses — a data scientist gets different explanations than a frontend engineer.

**Aliases** expand at the CLI layer: if a prompt starts with an alias key, the alias value is prepended. Works in both single-shot and REPL modes.

**Merging**: Scalar fields use last-wins. `user` and `aliases` shallow-merge (project extends global). `autoEnable` replaces (project knows best which groups it needs). Invalid values are silently dropped.

### MCP Support (`src/mcp-client.ts`, `src/mcp-manager.ts`)

External tool servers via Model Context Protocol. Configure in `.kota/mcp.json`. Tools namespaced as `mcp__<server>__<tool>`. Stdio transport, graceful degradation.

### Vision

`file_read` handles images (PNG, JPEG, GIF, WebP) natively — base64-encoded and sent as Anthropic image content blocks. Rich tool results (`ToolResult.blocks`) support mixed text + image content.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI parsing
- `glob` — File pattern matching
- `vitest` — Testing (dev)
