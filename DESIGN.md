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
- `ProxyTransport` — mutable target proxy, used by HTTP server and Telegram bot to swap per-request sinks

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

### Event Bus (`src/event-bus.ts`)

Internal pub/sub for cross-module coordination. Decouples modules so they can react to each other without direct imports. Foundation for daemon mode and event-based scheduler triggers.

**Typed events** (defined in `BusEvents`):
- `session.start` — emitted when `AgentSession.send()` runs the first prompt
- `session.end` — emitted when `AgentSession.close()` runs (with duration and error status)
- `schedule.fire` — emitted when `Scheduler.markFired()` fires an item
- `action.start` / `action.complete` — emitted by `ActionExecutor` around action execution

**API**:
- `on(event, handler)` — subscribe, returns unsubscribe function
- `once(event, handler)` — auto-unsubscribe after first call
- `emit(event, payload)` — synchronous fan-out to all handlers
- `on("*", handler)` — wildcard listener receives all events as `BusEnvelope`
- `clear()` / `listenerCount()` — management

**Singleton**: `initEventBus()` / `getEventBus()` / `resetEventBus()` — same pattern as Scheduler and TaskStore. Modules use `tryEmit()` convenience function which is a no-op when the bus isn't initialized, so emitting is safe from any module without checking state.

**Custom events**: The bus supports arbitrary string event names beyond the typed ones, allowing plugins and daemon-mode automations to define their own events.

**Design decisions**:
- Ephemeral: no persistence, no replay. Events are fire-and-forget.
- Synchronous delivery: handlers run in the order they subscribed.
- No error isolation: a handler that throws will prevent subsequent handlers from running (by design — errors should not be silently swallowed in an agent runtime).

### Module System (`src/module-types.ts`, `src/module-loader.ts`, `src/modules/`)

Pluggable architecture where features are self-contained modules instead of hardcoded. Built-in and external modules use the same `KotaModule` protocol.

**What a module can register**:
- **Tools** — agent tools with optional group assignment (progressive disclosure)
- **CLI commands** — subcommands that appear in `kota --help`
- **HTTP routes** — endpoints available when the server runs
- **Event subscriptions** — react to events on the bus

**Module lifecycle**:
1. `ModuleLoader.loadAll(modules)` — topologically sorts by dependencies, then loads each module
2. For each module: register tools → call `onLoad(ctx)` → add to loaded list
3. `connectEvents(bus)` — wire up event subscriptions (called when bus is available)
4. `getCommands()` / `getRoutes()` — collected lazily when CLI/server needs them
5. `unloadAll()` — unsubscribe events, call `onUnload()` in reverse order, clear tools

**ModuleContext** provided to modules:
- `cwd`, `verbose`, `config` — environment info
- `registerGroup(name, toolNames, pattern?)` — create/extend tool groups

**Built-in modules** (`src/modules/index.ts`): Ship with KOTA, loaded at session startup alongside external plugins. All 7 features extracted: `memory`, `scheduler`, `telegram`, `daemon`, `vercel-adapter`, `web`, `registry`.

**Coexistence with plugins**: The existing `PluginManager` continues to handle external `.kota/plugins/` and npm packages. Modules handle built-in features. Both systems use `registerTool()` from `tools/index.ts`. Future iterations will migrate external plugin loading into the module system.

**Design decisions**:
- Modules are loaded at startup, not hot-loaded — simplicity over dynamism.
- Dependency ordering via topological sort — a module can declare dependencies on other modules.
- The core without modules loaded still functions as a basic agent (requirement #8 from the plan).
- Tool registration via the existing `registerTool()` mechanism — modules don't need special plumbing.

### HTTP API Server (`src/server.ts`)

Makes KOTA accessible via HTTP — the bridge from CLI-only agent to embeddable service. Any frontend (web UI, Telegram bot, Discord bot, automation pipeline) can connect via standard HTTP.

**Endpoints**:
- `POST /api/chat` — Send `{ message, session_id? }`, receive SSE stream of agent events
- `POST /api/chat/vercel` — Vercel AI SDK Data Stream Protocol (module route, stateless)
- `POST /api/sessions` — Create a new session, returns `{ session_id }`
- `GET /api/sessions` — List active sessions with busy/idle status
- `DELETE /api/sessions/:id` — Close and clean up a session
- `GET /api/schedules` — List pending scheduled items (JSON)
- `GET /api/notifications` — SSE stream for real-time reminder notifications
- `POST /api/events/:name` — Fire a custom event on the bus (webhook trigger for CI, GitHub, etc.)
- `GET /api/daemon/status` — Daemon health (PID liveness check) and server status
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

### Web UI (`src/web-ui.ts`, `src/web-ui-styles.ts`, `src/web-ui-client.ts`, `src/web-ui-markdown.ts`)

Embedded browser-based chat interface served directly from the HTTP server at `GET /`. No build step, no external files — HTML/CSS/JS assembled from separate modules.

**Features**:
- **Real-time streaming**: Reads SSE from `POST /api/chat` via ReadableStream, renders text as it arrives.
- **Session management**: Create, switch, and delete sessions via sidebar. Auto-creates session on first message.
- **Conversation history**: Lists recent conversations from `GET /api/history`.
- **Markdown rendering**: Code blocks, inline code, bold, italic, headers, links.
- **Health monitoring**: Periodic health check with visual indicator.
- **Responsive design**: Works on mobile with collapsible sidebar.
- **Keyboard shortcuts**: Enter to send, Shift+Enter for newlines, auto-resizing textarea.
- **XSS protection**: HTML escaping covers all 5 dangerous characters (`&`, `<`, `>`, `"`, `'`). Links restricted to `http:`, `https:`, `mailto:` protocols only.

**Module split**:
- `web-ui.ts` — HTML structure + assembly (imports CSS and JS)
- `web-ui-styles.ts` — CSS template literal
- `web-ui-client.ts` — Client-side JavaScript template literal (session management, SSE streaming, chat UI)
- `web-ui-markdown.ts` — Testable TypeScript `escapeHtml()` and `renderMarkdown()` (canonical reference for the browser-side rendering logic)

**Design decisions**:
- **Embedded HTML**: `getWebUI()` returns a complete HTML string. No separate build pipeline, no static file serving. Keeps deployment as simple as `kota serve`.
- **Zero dependencies**: Pure HTML/CSS/JS. No React, no bundler, no framework.
- **Same SSE protocol**: Consumes the exact same SSE events as any other client. The web UI is just another consumer of the existing API.
- **Testable rendering**: Markdown/escaping logic exists both as browser-side JS (in the template literal) and as real TypeScript functions (in `web-ui-markdown.ts`). Tests verify the TypeScript functions, catching rendering and security bugs that would otherwise be untestable.

**Usage**: Start `kota serve`, open `http://localhost:3000/` in a browser.

### Telegram Bot (`src/telegram.ts`)

First real messaging frontend — makes KOTA accessible as a personal assistant via Telegram. Uses the Telegram Bot API via HTTP (no external dependencies). Validates and exercises the full transport/session infrastructure.

**Architecture** (same ProxyTransport pattern as HTTP server):
- Each chat ID gets an `AgentSession` with a `ProxyTransport`
- On each message, a `TelegramTransport` is set as the proxy target
- `TelegramTransport` buffers `text` events, shows typing indicators, flushes as Telegram messages
- After response, proxy resets to `NullTransport`

**Key features**:
- **Long polling**: `getUpdates` with 30s timeout. Error backoff at 5s.
- **Typing indicators**: Sent every 4s while agent is processing.
- **Message chunking**: Long responses split at newline boundaries (4096 char Telegram limit).
- **Chat session persistence**: One `AgentSession` per chat — conversation state persists across messages.
- **Commands**: `/start` (greeting), `/clear` (reset session), `/status` (session info + pending reminders).
- **Access control**: Optional `allowedChatIds` whitelist.
- **Concurrency**: One message per chat at a time (busy guard). Other messages get "please wait".
- **Scheduler integration**: 30-second timer checks for due reminders and scheduled actions. Reminders are broadcast to all active chats. Autonomous actions run via `ActionExecutor` and results are delivered as messages.

**Usage**: `kota telegram --token <BOT_TOKEN>` or set `TELEGRAM_BOT_TOKEN` env var.

**No new dependencies**: Uses Node's built-in `fetch` for all Telegram API calls.

**Scheduler lifecycle**: The bot owns the scheduler lifecycle — `initScheduler()` on `start()`, `resetScheduler()` on `stop()`. Individual `AgentSession.close()` calls (from `/clear`) do not reset the shared scheduler, preventing one session's cleanup from killing reminders for all chats.

### Daemon Mode (`src/daemon.ts`)

Long-running process that hosts the event bus, scheduler, and idle tasks — an event-driven runtime for autonomous agent operation. Third piece of the self-hosting loop plan.

**Core responsibilities**:
- **Event bus + scheduler hosting**: Initializes both singletons, connects the scheduler to the bus so event-triggered items fire automatically.
- **Time-based polling**: Runs the scheduler timer to detect and fire due items.
- **Idle tasks**: When no actions are running and no idle task is active, picks the next idle task (round-robin) and runs it as an `AgentSession`. Respects configurable cooldowns.
- **Self-restart**: Watches `dist/cli.js` mtime. When it changes (after a build), saves state and exits with code 75. A wrapper script can detect this and restart the daemon.
- **State persistence**: Saves `daemon-state.json` to `~/.kota/` with cycle count, last idle task, and PID. On startup, recovers previous state.
- **Graceful shutdown**: SIGINT/SIGTERM → stops accepting new work, waits up to 30s for the active idle session to finish, cleans up scheduler connections, saves state.

**CLI**: `kota daemon [--idle-prompt "..."] [--idle-cooldown 300] [--poll-interval 30] [--no-restart]`

**Self-hosting loop pattern**: With event-triggered scheduler items, the daemon can run the build/improve loop:
1. Daemon starts idle → picks up "self-build" idle task
2. Session runs, builds code, emits `session.end`
3. Event trigger fires: "on session.end → run self-improve"
4. If `dist/` changed → daemon exits 75, wrapper restarts it

**Design decisions**:
- No hot reload — restart is simpler and safer.
- Idle tasks are preempted by scheduled actions (checked via `executor.activeCount`).
- State persistence is best-effort — daemon functions correctly without it.
- The HTTP server (`kota serve`) also connects the event bus to the scheduler, so `POST /api/events/:name` webhooks trigger event-based scheduler items without requiring the daemon. The daemon status endpoint reads `daemon-state.json` and checks PID liveness.

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

**MCP tool integration**: When MCP servers are configured, their tools are automatically available to sub-agents. The `McpManager` is threaded through `DelegateConfig` after MCP initialization. In the delegate loop, tool calls are routed: MCP-namespaced tools (`mcp__*`) go through `McpManager.executeTool()`, built-in tools through the standard runners. This ensures users' external tool servers work consistently across the main loop and delegated tasks.

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

**Event-based triggers**: Items can fire when a named event occurs on the EventBus instead of at a time. Created via `addEventTrigger(description, eventName, opts?)` or the `on_event` tool action. The scheduler subscribes to the bus via `connectBus(bus, onFire)` — a wildcard listener checks pending event-triggered items against incoming events. Optional `triggerFilter` does key-value matching on the event payload (string coercion). Repeating event triggers (`repeat: true`) stay pending after firing; one-shot triggers become "fired". `schedule.fire` events are ignored to prevent self-triggering loops. Event-triggered items are excluded from `getDue()` (they don't use time-based polling). This enables automations like "when a session ends, run this prompt."

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
- **Vercel AI SDK**: `{ description, parameters, execute }` — compatible with tools created via `tool()` from the Vercel AI SDK. Parameters can be Zod schemas (auto-converted), `jsonSchema()` results, or raw JSON Schema objects. Also detects tool maps: `{ toolName: { execute, parameters }, ... }`
- **Array**: `[simpleTool, openAITool, vercelTool, ...]` — multiple tools from one file, any mix of formats
- **Hybrid KotaPlugin**: `{ name, tools: [simpleTool, ...], onLoad, onUnload }` — plugin with lifecycle hooks but simple-format tools

**Zod → JSON Schema conversion**: Vercel AI SDK tools commonly use Zod schemas for parameter validation. The adapter includes a lightweight converter that handles common Zod types (ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray, ZodObject, ZodOptional, ZodDefault, ZodLiteral) without requiring Zod as a dependency. For `jsonSchema()` results from the AI SDK, the embedded JSON Schema is extracted directly.

**Result normalization**: External tool `run`/`execute` functions can return strings, numbers, objects, or `{ content, text }` — all normalized to KOTA's `ToolResult`. Native `{ content: string }` passes through unchanged.

**Programmatic API**: `fromSimple(def)`, `fromOpenAI(def)`, and `fromVercelAI(def, name)` for explicit conversion. `adaptExport(moduleExport, fileName)` for auto-detection (used by `PluginManager`).

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

**Example — Vercel AI SDK format** (compatible with `tool()` from the `ai` package):
```js
// Single tool — name derived from filename
export default {
  description: "Get weather for a location",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: async ({ city }) => `Weather in ${city}: 72°F, sunny`,
};
```

```js
// Map of tools — names derived from object keys
export default {
  get_weather: {
    description: "Get weather",
    parameters: z.object({ city: z.string() }), // Zod schemas auto-converted
    execute: async ({ city }) => fetchWeather(city),
  },
  search: {
    description: "Web search",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => searchWeb(query),
  },
};
```

### Remote Tool Registry (`src/registry.ts`)

Install, remove, and manage KOTA tools from external sources — npm packages, URLs, and GitHub repos. This connects the plugin system, tool format adapters, and Vercel AI SDK compatibility into a real distribution mechanism.

**Sources**:
- **npm**: `kota tools install <package>` or `kota tools install npm:@scope/package` — installs to `.kota/packages/` via npm, auto-loaded on startup
- **URL**: `kota tools install https://example.com/tool.mjs` — downloads to `.kota/plugins/`
- **GitHub**: `kota tools install github:user/repo` or `kota tools install user/repo` — installs via npm's GitHub support

**Manifest** (`.kota/tools.json`): Tracks installed tools with source type, URI, version, file paths, and install timestamp. Used for list, remove, and update operations.

**CLI commands**:
- `kota tools install <source>` — install from npm, URL, or GitHub
- `kota tools list` — show installed tools with source, version, URI
- `kota tools remove <name>` — uninstall and clean up files
- `kota tools update <name>` — reinstall latest version

**PluginManager integration**: `loadAll()` now loads from two locations:
1. `.kota/plugins/` — file-based plugins (manual drops + URL downloads)
2. `.kota/packages/node_modules/` — npm-installed packages (reads dependencies from `.kota/packages/package.json`)

**Name derivation**: `kota-` and `tool-` prefixes are stripped automatically (e.g., `kota-weather` → `weather`, `@scope/tool-calc` → `calc`).

**Example workflow**:
```bash
kota tools install kota-weather              # npm package
kota tools install https://raw.github.../tool.mjs  # URL download
kota tools install user/kota-search          # GitHub repo
kota tools list                              # show all installed
kota tools remove weather                    # uninstall
```

### Vercel AI SDK Streaming (`src/vercel-ai-stream.ts`, `src/modules/vercel-adapter.ts`)

The vercel-adapter module provides Vercel AI SDK Data Stream Protocol v1 integration via `POST /api/chat/vercel`. It's registered as a KotaModule with HTTP routes — the first module to exercise the route registration mechanism. Each request is stateless (fresh AgentSession per request), matching the `useChat()` pattern where the client sends the full messages array.

**Wire format**: `{TYPE_CODE}:{JSON}\n` (not SSE). Type codes:
- `0`: text delta
- `2`: data annotation (status/cost metadata)
- `3`: error
- `9`: tool call (toolCallId, toolName, args)
- `a`: tool result (toolCallId, result)
- `d`: finish message (finishReason, usage)
- `e`: finish step (finishReason, usage, isContinued)
- `g`: reasoning (extended thinking)

**Headers**: `Content-Type: text/plain; charset=utf-8`, `X-Vercel-AI-Data-Stream: v1`

**Endpoints**:
- `POST /api/chat` → KOTA's native SSE format: `{ message: "...", session_id?: "..." }` (used by the built-in web UI)
- `POST /api/chat/vercel` → Vercel AI SDK Data Stream Protocol v1: `{ messages: [{role, content}, ...] }` (used by `useChat()`)

**Usage with Next.js**:
```tsx
import { useChat } from "ai/react";
const { messages, input, handleSubmit } = useChat({
  api: "http://localhost:3000/api/chat/vercel",
});
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

### Session Pool (`src/session-pool.ts`)

Extracted HTTP session infrastructure — `SseTransport`, `SessionPool`, `ManagedSession` type, and HTTP helpers (`setCors`, `jsonResponse`, `readBody`). Shared by the HTTP server and any future transport that needs session management over HTTP.

### Linting (`biome.json`)

Biome linter enforces code quality across all source files. Rules cover unused imports/variables, type-only imports, template literal preference, `Number.isNaN` over global `isNaN`, and import sorting. Run via `npm run lint`; auto-fix via `npm run lint:fix`.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI parsing
- `glob` — File pattern matching
- `@biomejs/biome` — Linting and import organization (dev)
- `vitest` — Testing (dev)
