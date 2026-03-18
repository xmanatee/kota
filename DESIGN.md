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
- **Prompt sections** — contribute to the system prompt, teaching the agent how to use the module's capabilities

**Module lifecycle**:
1. `ModuleLoader.loadAll(modules)` — topologically sorts by dependencies, then loads each module
2. For each module: create context → resolve tools (array or factory) → register tools → call `onLoad(ctx)` → add to loaded list
3. `connectEvents(bus)` — wire up event subscriptions (called when bus is available)
4. `getCommands()` / `getRoutes()` — collected lazily when CLI/server needs them
5. `unload(name)` — deregister module's tools, disconnect its events, call `onUnload()`
6. `reload(name)` — unload then re-load from stored definition, reconnect events
7. `unloadAll()` — unsubscribe events, call `onUnload()` in reverse order, deregister tools per-module

**ModuleContext** provided to modules:
- `cwd`, `verbose`, `config` — environment info
- `storage` — scoped file-based storage (`ModuleStorage`) under `.kota/modules/<name>/`. Supports JSON (`getJSON`/`setJSON`), text (`getText`/`setText`), and raw files (`readFile`/`writeFile`). Each module's data is fully isolated.
- `getModuleConfig<T>()` — access module-specific config section from `config.modules.<name>`
- `registerGroup(name, toolNames, pattern?)` — create/extend tool groups
- `getRoutes()` — discover HTTP routes from all loaded modules (decouples modules from each other)
- `log` — scoped logger (`info`, `warn`, `error`, `debug`) with `[module:<name>]` prefix. `debug` is silent unless verbose mode is active.
- `getSecret(key)` — get a secret value by name. Returns null if not found or store not initialized. Enables tool runners to access credentials without importing the SecretStore singleton.
- `listTools()` — list names of all currently registered tools. Read-only introspection for modules that need to discover available capabilities.

**Tools as factory function** (iter 549): `tools` can be a static `ToolDef[]` array (existing pattern) or a factory function `(ctx: ModuleContext) => ToolDef[]`. The factory form lets tool runners capture the context via closure, accessing `ctx.log`, `ctx.getSecret()`, `ctx.listTools()`, and `ctx.storage` without importing core singletons. The loader resolves the factory during `load()` before tool registration. `resolveModuleTools(mod, ctx?)` is the canonical helper for normalizing the union type.

**Loading modes**: `ModuleLoader` supports `commandsOnly` mode that skips tool registration and `onLoad` hooks — used by the CLI for command discovery without side effects. Agent sessions use full mode for tool and event registration.

**Built-in modules** (`src/modules/index.ts`): Ship with KOTA, loaded at session startup. 11 modules: `secrets`, `memory`, `knowledge`, `history`, `scheduler`, `telegram`, `daemon`, `vercel-adapter`, `web`, `registry`, `mcp-server`.

**Module isolation**: Modules interact with the core and each other only through `ModuleContext` — no direct imports between modules. The web module discovers vercel-adapter routes via `ctx.getRoutes()` rather than importing the vercel-adapter module.

**Unified plugin→module system** (iter 447): External plugins from `.kota/plugins/` and `.kota/packages/` are now discovered by `discoverPluginModules()` and loaded through the same `ModuleLoader` as built-in modules. The old `PluginManager` class, `KotaPlugin` type, `ToolDefinition` type, and `PluginContext` type were eliminated — `KotaModule` and `ToolDef` are the single canonical types. User-authored plugins are simply modules discovered from disk.

**Hot-restart**: Individual modules can be unloaded and reloaded without stopping the KOTA process. `unload(name)` deregisters only that module's tools (via per-module ownership tracking), disconnects only its event subscriptions, and calls its `onUnload()` hook. Dependency safety: unloading a module that others depend on throws an error — unload dependents first. `reload(name)` is `unload` + `load` from the stored definition, with automatic event reconnection.

**Per-module tool ownership**: `registerTool()` accepts an optional `moduleName` parameter. Tools are tracked in a `moduleToolOwners` map, enabling surgical `deregisterModuleTools(name)` — removing only one module's tools without affecting others. This replaces the previous `clearCustomTools()` nuclear approach where unloading modules or plugins would wipe out each other's tools.

**Module SDK** (iter 535, extended iter 549, extended iter 551): Modules receive a complete SDK through `ModuleContext`:
- **Scoped storage** (`src/module-storage.ts`): Each module gets its own directory at `.kota/modules/<name>/` with APIs for JSON, text, and raw file storage. Directory created lazily on first write, keys sanitized for filesystem safety.
- **Module config**: Per-module configuration in `config.modules.<name>`. Example: `{ "modules": { "telegram": { "botToken": "..." } } }`.
- **Prompt sections**: Modules contribute to the system prompt via `promptSection()`. Sections are collected during loading and appended under a `## Module Capabilities` heading with per-module `###` headings.
- **Scoped logger**: `ctx.log.{info,warn,error,debug}` with `[module:<name>]` prefix. Debug only logs in verbose mode.
- **Secret access**: `ctx.getSecret(key)` provides credential lookup without importing SecretStore.
- **Tool introspection**: `ctx.listTools()` returns names of all registered tools.
- **Event proxy** (iter 551): `ctx.events.{emit,on,once}` wraps the event bus. Modules can emit and subscribe to events without importing the event bus singleton. Subscriptions made via `ctx.events` are auto-tracked and cleaned up on module unload. The proxy resolves `this.bus` lazily at call time — safe to use before `connectEvents()` (emit is no-op, on returns dummy unsub). Tool runners access via closure for event-driven coordination.
- **Session factory** (iter 551): `ctx.createSession(options?)` creates `ModuleSession` instances (send + close) without importing `AgentSession`. Avoids circular imports via dependency injection — `AgentSession` sets a factory on `ModuleLoader` via `setSessionFactory()`. Sessions default to `noHistory: true`, `historySource: "action"`, `reflectionEnabled: false`, and `BufferTransport`. Throws if called before factory injection (e.g., in CLI-only mode).
- **Config type**: `KotaConfig.modules` is a `Record<string, Record<string, unknown>>`, sanitized and merged like other config sections.
- **Provider registration** (iter 563): `ctx.registerProvider(type, provider)` registers the module as a provider for a service type (e.g., "memory", "knowledge"). `ctx.getProvider<T>(type)` retrieves the active provider. See Provider System below.
- **Tool invocation** (iter 569): `ctx.callTool(name, input)` invokes any registered tool directly, returning a `ToolResult`. Skips guardrails (programmatic calls are trusted). Recursion depth tracked per-loader instance with a limit of 10 to prevent infinite tool→tool chains. Enables modules to compose existing tools cheaply — event handlers, `onLoad`, and tool runners can call `web_fetch`, `memory`, `knowledge`, etc. without LLM overhead.

**Design decisions**:
- Dependency ordering via topological sort — a module can declare dependencies on other modules.
- The core without modules loaded still functions as a basic agent (requirement #8 from the plan).
- Tool registration via the existing `registerTool()` mechanism — modules don't need special plumbing.
- Single loading path: both CLI and agent sessions use `ModuleLoader` — no ad-hoc module iteration.

### Module Log Store (`src/module-log.ts`)

Persistent, queryable log storage for modules. Each module gets a JSONL file at `.kota/modules/<name>/logs.jsonl`. Enables observability of autonomous operations (scheduled actions, event handlers, scripts).

**Integration**:
- `ctx.log.{info,warn,error,debug}(msg, data?)` persists to log store (in addition to console)
- Step handlers and scripts in `module-factory.ts` auto-log start/complete/error/skip
- Agent queries logs via `module_factory(action:"logs", name?, level?, keyword?, limit?)`

**API**: `append(module, level, msg, data?)`, `query({module?, level?, since?, keyword?, limit?})`, `tail(module, n)`, `modules()`, `clear(module)`. Auto-prunes at 1000 entries (keeps 750).

### Provider System (`src/providers.ts`)

Typed interfaces for swappable core services. Modules can register alternative implementations — swap memory from JSON to SQLite, vector DB, or cloud storage by implementing an interface and setting config.

**Interfaces** (4 service types):
- `MemoryProvider` — `save`, `search`, `list`, `update`, `delete`. Built-in: `MemoryStore`.
- `KnowledgeProvider` — `create`, `read`, `update`, `delete`, `search`, `list`, `count`. Built-in: `KnowledgeStore`.
- `TaskProvider` — `add`, `update`, `list`, `active`, `get`, `clear`, `archiveCompleted`, `getActiveSummary`, `isEmpty`, `count`. Built-in: `TaskStore`.
- `HistoryProvider` — `create`, `save`, `load`, `list`, `getMostRecent`, `findByPrefix`, `remove`, `cleanup`. Built-in: `ConversationHistory`.

**ProviderRegistry**:
- `register(type, name, provider)` — register a named provider for a service type
- `get<T>(type)` — get the active provider (typed)
- `setActive(type, name)` — switch the active provider
- `list(type)` — list registered providers for a type

**Config** (`.kota/config.json`):
```json
{
  "providers": {
    "memory": "my-vector-memory",
    "knowledge": "default",
    "task": "default",
    "history": "default"
  }
}
```

**Module integration**: Modules register as providers via `ctx.registerProvider(type, provider)` in `onLoad`. After all modules are loaded, `ModuleLoader.activateConfiguredProviders()` activates the providers specified in config.

**Fallback**: If no provider is registered for a type, the convenience getters (`getMemoryProvider()`, `getKnowledgeProvider()`) fall back to the built-in singletons. This means the agent works identically with zero config.

**Built-in providers**:
- `default` — file-based JSON (`MemoryStore`, `KnowledgeStore`). Active by default.
- `sqlite-memory` — SQLite-backed memory (`src/memory/sqlite-memory.ts`, `src/modules/sqlite-memory.ts`). SQL-powered search, no 100-memory cap, concurrent-safe via WAL mode. Uses `sqlite3` CLI (no library dependency). Activate: `{ "providers": { "memory": "sqlite-memory" } }`. DB stored at `.kota/modules/sqlite-memory/memory.db`.

**Design decisions**:
- Structural typing — existing classes don't need `implements MemoryProvider`. TypeScript duck typing ensures conformance automatically.
- Follows the `SecretProvider` pattern from `secrets.ts` but generalized to any service type.
- Default providers registered during init, before modules load. Modules can override.
- Registry cleared on `ModuleLoader.unloadAll()` — no stale providers across sessions.

### Git Version Control (`src/tools/git.ts`)

Dedicated VCS tool with structured operations and safety guardrails. Operations: status, diff, log, show, add, commit, branch, push. Safety: force-push to main/master blocked (allows `--force-with-lease`), protected branch deletion blocked. Token-efficient: large diffs auto-truncated at 15K chars (60% head + 30% tail). Core tool, moderate risk. 30s timeout per operation.

### Human-in-the-Loop Approval (`src/tools/confirm.ts`)

Agent-initiated approval gate for high-stakes actions in autonomous workflows. The agent calls `confirm(action, risk, details?, timeout?)` before irreversible operations. Risk levels (low/medium/high) set default timeouts (60s/300s/600s). Interactive mode prompts via terminal; non-interactive auto-rejects (safe default). Emits `confirm.requested` / `confirm.resolved` events on the bus for module integration. Management group, safe risk.

### Approval Queue (`src/approval-queue.ts`, `src/tools/approval.ts`)

File-based queue for tool calls that require human approval. When guardrails resolve to `queue` policy (default for dangerous operations in non-interactive contexts like server, telegram, daemon), the tool call is stored in `.kota/approvals/` instead of being denied. Each pending item is a JSON file with tool name, input, risk, reason, and source. The `approval` agent tool provides 4 actions: `list` (pending items), `approve` (execute queued call), `reject` (with optional reason), `count`. Approved items execute immediately via `executeTool()`. Emits `approval.requested` / `approval.resolved` events on the bus. Management group, safe risk.

### Desktop Notifications (`src/tools/notify.ts`)

OS-native desktop notifications (macOS `osascript`, Linux `notify-send`) with console fallback. Core tool, safe risk. Sound enabled by default.

### Screenshot Capture (`src/tools/screenshot.ts`)

Captures screen as image content block. macOS `screencapture`, Linux fallback chain. Auto-resizes to 1568px (Claude optimal). Core tool, safe risk.

### Document Reader (`src/tools/read-document.ts`)

Extracts text from PDFs, DOCX, RTF, ODT, EPUB via platform tool fallback chains (e.g., `pdftotext` → `pdfminer` → `PyPDF2`). Page ranges for PDFs, 50K char limit, 30s timeout. Core tool, safe risk. Zero npm deps.

### Clipboard (`src/tools/clipboard.ts`)

System clipboard read/write via `pbpaste`/`pbcopy` (macOS) or `xclip` (Linux). Core tool, safe risk. 50K read / 100K write limits.

### Computer Use (`src/tools/computer-use.ts`)

Mouse/keyboard GUI control — click, type, key combos, scroll, drag, cursor position. macOS: `cliclick` + `osascript`; Linux: `xdotool`. Pairs with screenshot for the see→act→verify loop. Core tool, moderate risk. Scroll capped at 20, coordinates rounded to int.

### SQLite Queries (`src/tools/sqlite.ts`)

Query SQLite via `sqlite3` CLI — `tables`, `schema`, `query` actions. Results as markdown tables, 100 row / 50K char cap, 30s timeout. Mutations report affected rows. Core tool, moderate risk.

### Image Viewer (`src/tools/view-image.ts`)

Reads local images (PNG, JPEG, GIF, WebP) as image content blocks. Auto-resizes to 1568px, 20MB limit. Core tool, safe risk.

### Knowledge Store Events

Knowledge CRUD operations emit typed events on the event bus, enabling reactive data-driven workflows:
- `knowledge.create` — emitted with `{id, title, type, tags, scope}` after successful creation
- `knowledge.update` — emitted with `{id, fields}` after successful update (fields lists changed keys)
- `knowledge.delete` — emitted with `{id}` after successful deletion

Events are emitted from the tool runner (`src/tools/knowledge.ts`) via `tryEmit()` — no-op if the bus isn't initialized. Only fires on success; failed operations (not found, validation error) emit nothing.

**What this enables**:
- Agent-created modules with `eventHandlers` can react to data changes automatically
- "When a new research entry is added, send a notification" via module manifest
- "When a task entry is marked done, archive related notes" via event-driven automation
- Foundation for the data→events→actions pipeline

### Custom Tool Builder (`src/tools/custom-tool.ts`)

Lets the agent dynamically create new tools at runtime from Python/Node.js code. Transforms the agent from a fixed-tool system into a self-extending one.

**Actions**: `create` (define tool with name, description, params, code), `list` (show custom tools), `remove` (deregister and clean up).

**Execution model**: Custom tools run in the same REPL sessions as `code_exec` — shared state, installed packages, and environment. Parameters are serialized via base64-encoded JSON to avoid quoting issues.

**Persistence**: `persist: true` saves the tool definition to `.kota/tools/<name>.json`. Saved tools are auto-loaded at session startup via `loadSavedTools()` in `initExtensions()`.

**Registration**: Custom tools are registered via `registerTool()` with the standard tool registry. They pass the `!KNOWN_TOOL_NAMES.has()` filter in `filterTools()`, so they're always visible once created.

**Circular dependency resolution**: `custom-tool.ts` needs `registerTool`/`deregisterTool` from `index.ts`, and `index.ts` imports `customToolTool` from `custom-tool.ts`. Resolved via `initCustomToolRegistry()` — dependency injection at module load time.

**Design decisions**:
- Core tool (always available) — the agent should always be able to extend itself without enabling a group.
- Classified as `moderate` risk in guardrails — same sandbox as `code_exec`.
- Max 20 custom tools to prevent tool list explosion.
- Replacing an existing custom tool deregisters the old one first (no duplicates).
- `deregisterTool(name)` added to `tools/index.ts` for surgical single-tool removal.

### Module Factory (`src/manifest/`, `src/tools/module-factory/`)

Lets the agent create full modules at runtime from declarative JSON manifests. Transforms KOTA from an agent that can create individual tools (via `custom_tool`) into one that can create structured, multi-tool capability packages with metadata, prompt sections, and persistence.

**Manifest format** (JSON):
```json
{
  "name": "weather",
  "version": "1.0.0",
  "description": "Weather tools",
  "tools": [{
    "name": "get_weather",
    "description": "Get weather for a city",
    "parameters": { "type": "object", "properties": { "city": { "type": "string" } } },
    "code": "print('sunny')",
    "language": "python"
  }],
  "eventHandlers": [{
    "event": "schedule.fire",
    "steps": [
      { "tool": "web_fetch", "input": { "url": "https://api.example.com/data" } },
      { "tool": "notify", "input": { "message": "fetch failed" }, "if": "$prev.error" },
      { "tool": "knowledge", "input": { "action": "create", "title": "Fetched data", "content": "$prev" }, "if": "$prev.error != true" }
    ]
  }],
  "scripts": {
    "refresh": {
      "description": "Fetch and store latest data",
      "steps": [
        { "tool": "web_fetch", "input": { "url": "https://api.example.com/data" } },
        { "tool": "notify", "input": { "message": "Data refreshed: $prev" } }
      ]
    }
  },
  "promptSection": "Use get_weather to look up weather.",
  "dependencies": []
}
```

**Actions**: `create` (define module from manifest), `list` (show custom modules), `remove` (unload and delete), `info` (show details), `run` (execute a named script), `logs` (query persistent module operation logs).

**Persistence**: Manifests are saved to `.kota/modules/<name>/manifest.json`. This is the same directory used by `ModuleStorage`, so module definition and module data live together. Manifests are auto-discovered on startup via `discoverManifestModules()` in `plugin-loader.ts`.

**Tool execution**: Module tools use the same REPL session pattern as `custom_tool` — code runs in persistent Python/Node.js sessions with base64-encoded parameter passing.

**Event handlers**: Manifest modules can subscribe to event bus events via `eventHandlers`. Two handler modes:
- **Code-based** (`code` field): Runs code in a REPL session with `event_name` and `payload` variables. Good for custom logic, data processing, and calling external APIs.
- **Step-based** (`steps` field): Executes a sequence of KOTA tool calls via `executeTool()`. Each step specifies a `tool` name and optional `input`. Steps run sequentially with full data flow between steps. Stops on first error. Good for composing existing tools into workflows without writing code.

**Step input references** (`resolveStepInput`): Step inputs support these reference patterns for data flow:
- `$prev` / `$steps[N]` — whole-value: previous step or step N output string
- `$payload` — whole-value: JSON-serialized event payload or script args
- `$prev.field.path` / `$steps[N].field.path` — JSON field extraction via dot-path
- `$payload.field.path` — direct field access on payload object
- `"text {{$prev.field}} more {{$steps[0].name}}"` — inline template interpolation

**Conditional steps** (`if` field): Any step can have an optional `if` guard — a condition expression that determines whether the step executes. If the condition evaluates to falsy, the step is skipped (output is `""`, `$prev` unchanged). Supports:
- Bare truthiness: `"$prev"`, `"$prev.status"` — truthy if non-empty, non-null, non-`"false"`, non-`"0"`
- Comparisons: `==`, `!=`, `>`, `<`, `>=`, `<=` (numeric when both sides parse as numbers, string otherwise)
- String ops: `contains` (substring), `matches` (regex) — e.g., `"$prev contains error"`, `"$prev matches ^2\\d\\d$"`
- Logical: `&&` (AND), `||` (OR), `!` (negation), `()` (grouping) — e.g., `"$prev.ok && !($prev contains error)"`

Code and steps are mutually exclusive per handler. Handlers run asynchronously; errors are logged but never crash the bus.

**Scripts**: Named, on-demand tool-call sequences in the manifest's `scripts` field. Invoked via `module_factory(action:"run", name, script, args?)`, return final step result. Same data-flow references as event handler steps. `args` maps to `$payload`. Example:
```json
{
  "name": "ops",
  "scripts": {
    "daily-check": {
      "steps": [
        { "tool": "web_fetch", "input": { "url": "$payload.url" } },
        { "tool": "knowledge", "input": { "action": "create", "title": "Status: {{$prev.title}}", "content": "$steps[0]" } }
      ]
    }
  }
}
```

**Hot-loading**: When a module is created, its tools are immediately registered via `registerTool()` with module-name ownership tracking. Prompt sections take effect on next session startup (the system prompt is already built for the current session).

**Relationship to custom_tool**: `custom_tool` creates individual tools quickly (ad-hoc needs). `module_factory` creates structured packages of related tools with organization and metadata. A module can have zero tools (prompt-section only) or multiple tools with shared purpose.

**Design decisions**:
- Core tool (always available) — classified as `moderate` in guardrails.
- Max 10 custom modules (vs. 20 for individual custom tools) — modules are heavier.
- Manifest validation rejects: builtin module/tool name conflicts, invalid schemas, duplicate tool names.
- Modules are tracked per-session (`loadedManifestModules` set) for status display.
- `deleteManifest()` removes only the manifest file, preserving module storage data.

### MCP Server (`src/mcp/server.ts`, `src/modules/mcp-server.ts`)

Exposes all KOTA tools via MCP (JSON-RPC 2.0 over stdio). Any MCP-compatible host (Claude Code, Cursor, VS Code) can use KOTA tools natively. Custom implementation (no SDK dep). `--tools` flag to filter. No guardrails in MCP mode — host handles safety. Usage: `kota mcp-server`.

### Guardrails (`src/guardrails.ts`)

Centralized risk classification and policy enforcement for all tool calls. Every tool call is assessed before execution — the policy determines whether to allow, require confirmation, or deny.

**Risk levels**:
- `safe` — Read-only tools (file_read, grep, glob, repo_map, todo, ask_user, web_search, memory, get_secret, enable_tools, files_overview). Also HTTP GET requests.
- `moderate` — File modifications (file_edit, file_write, multi_edit, find_replace), code_exec, web_fetch, delegate, schedule, notebook, HTTP mutations, shell/process with non-destructive commands, unknown/MCP tools.
- `dangerous` — Shell/process with destructive command patterns (rm, git push, sudo, kill, npm publish, etc.), code_exec with system-level operations (os.system, subprocess, shutil.rmtree), file operations targeting paths outside the project directory.

**Policies** (configurable per risk level):
- `allow` — Execute immediately. Default for safe and moderate.
- `confirm` — In interactive mode, prompt the user. In non-interactive mode, deny. Default for dangerous (interactive).
- `queue` — Enqueue in ApprovalQueue for later review. Default for dangerous (non-interactive). Returns queued item ID.
- `deny` — Block execution. Return error guiding the agent to use ask_user or try a safer approach.

**Configuration** (`.kota/config.json`):
```json
{
  "guardrails": {
    "policies": { "safe": "allow", "moderate": "allow", "dangerous": "confirm" },
    "toolOverrides": { "shell": "confirm" }
  }
}
```

**Non-interactive contexts** (server, telegram, daemon, scheduled actions): Default policy for dangerous operations is `deny` instead of `confirm`, since there's no user to prompt. This prevents autonomous sessions from running destructive commands. Configurable via config.

**Integration**: Guardrails check runs in `executeToolCalls()` in `tool-runner.ts`, before any tool execution. Transport emits `guardrail` events for visibility (logged in CLI verbose mode, always logged for non-allow decisions). Every assessment is also persisted to the audit trail.

**Audit trail** (`src/guardrails-audit.ts`): Persistent JSONL log at `.kota/audit.jsonl`. Every guardrail assessment (tool name, risk, policy, reason, session ID, timestamp) is appended. `AuditStore` provides `query(filter)` and `summarize(filter)` for analysis. Auto-trims at 10K entries. The `audit` tool (management group) lets the agent query its own guardrail history.

**Design decisions**:
- Centralized: one check point for all tools, rather than each tool implementing its own safety checks. Shell/process retain their existing `isDangerous()` + `confirmExecution()` as a fallback layer.
- Conservative defaults: moderate tools are allowed (the agent needs to be useful), dangerous operations require confirmation (the user needs to be safe).
- Tool overrides: per-tool policies bypass risk classification entirely. Users who trust specific tools can override.
- MCP and module tools default to moderate — unknown tools are treated cautiously but not blocked.

### Self-Reflection (`src/reflection.ts`)

Lightweight self-evaluation step before the agent delivers its final response. Based on research showing +6-15% accuracy improvement on complex tasks (PreFlect, Reflexion, MAR papers).

**When it triggers** (`shouldReflect()`):
- Response is substantive (>200 chars)
- Session involved meaningful tool use (3+ tool calls)
- Reflection hasn't already run this turn (capped at 1 round)

**Domain-adaptive criteria** (`buildReflectionPrompt()`):
The evaluation prompt adjusts based on which tools were used during the session:
- Always: completeness (does it answer the request?) and correctness
- File edits detected → adds verification criterion (tests/typecheck/build)
- Research tools detected → adds source quality criterion
- Compute tools detected → adds methodology criterion
- Always: response quality and structure

**Integration** (`loop.ts`):
When the agent produces a response with no tool calls (about to stop), the loop checks `shouldReflect()`. If warranted, it injects the reflection prompt as a user message and continues the loop for one more iteration. The model either:
- Makes tool calls to fix identified issues (loop continues naturally)
- Produces text confirming quality (loop breaks, delivers response)

**Configuration**:
- CLI: `--no-reflect` to disable
- Config: `{ "reflection": false }` in `.kota/config.json`
- Default: enabled

**Design decisions**:
- Single round only — research shows diminishing returns after 2-3 rounds, and confirmation bias increases.
- Complements VerifyTracker (which handles code-specific nudges) with domain-agnostic quality evaluation.
- Structured criteria over open-ended "find problems" — forces the model to evaluate specific dimensions rather than rubber-stamp its own work.
- Low overhead: ~15-20% additional tokens per task, only for substantive completions.

### Secrets Management (`src/secrets.ts`, `src/modules/secrets.ts`)

Provider-based credential management with automatic output masking. Prevents secret leakage into LLM context.

**Provider chain** (checked in order until a value is found):
1. Project file (`.kota/secrets.json`)
2. Global file (`~/.kota/secrets.json`)
3. Project `.env` file
4. Global `~/.kota/.env` file
5. macOS Keychain (via `security` CLI — skipped on non-macOS)

**`SecretProvider` interface**: `get(key)`, `set(key, value)`, `remove(key)`, `list()`. Three implementations: `EnvProvider` (read-only), `FileProvider` (JSON), `KeychainProvider` (macOS).

**Output masking**: `SecretStore.mask(text)` replaces all known secret values with `<secret:NAME>`. Called in `tool-runner.ts` on every tool result before it enters the conversation context. Uses a compiled regex sorted by value length (longest match wins). Values under 4 chars are excluded to avoid false positives.

### Prompt Templates (`src/prompt-template.ts`, `src/tools/prompt.ts`)

File-based prompt management using markdown + YAML front matter. Templates live in `.kota/prompts/*.md` and support `{{variable}}` substitution.

**PromptStore**: discovers, loads, caches, and renders templates from the prompts directory. Auto-detects variables from `{{placeholders}}` when not declared in front matter. Create/delete operations persist to disk immediately.

**Agent tool** (`prompt_template`): management group. Actions: `list` (available templates), `get` (load by name), `render` (with variable substitution, warns on unresolved vars), `create` (new template file). Templates are re-discovered on each action to pick up external changes.

**Delegate integration**: The `delegate` tool accepts optional `prompt` (template name) and `prompt_vars` (substitution values) parameters. When specified, the named template replaces the default mode system prompt (EXPLORE_PROMPT/EXECUTE_PROMPT/RESEARCH_PROMPT), enabling domain-specific sub-agent behavior without code changes.

### Working Memory (`src/memory/working-memory.ts`, `src/modules/working-memory.ts`)

Agent-controlled scratchpad — named entries that appear in `<working-memory>` tags in the dynamic system prompt every turn. Inspired by Letta/MemGPT's memory blocks. Limits: 20 entries, 500 chars/value, 4000 chars total. The `working_memory` tool supports write/read/list/remove/clear actions with optional `persist:true` flag. Persistent entries are saved to `.kota/modules/working-memory/entries.json` via `ModuleStorage` and auto-restored on session start via the module's `onLoad` hook. Non-persistent entries remain session-scoped. Persistent entries show a ★ marker in the system prompt.

**Agent tool**: `get_secret` injects the secret into `process.env` for use by shell/code_exec tools. The LLM receives `<secret:NAME>` — never the real value.

**CLI**: `kota secrets set|get|list|remove` with `--global`/`--project` scope flags. `set` prompts for the value interactively (never accepts secrets as CLI arguments).

**Singleton**: `initSecretStore(cwd)` / `getSecretStore()` / `resetSecretStore()` — same pattern as TaskStore and Scheduler.

### Conversation Recall (`src/tools/conversation-recall.ts`, `src/modules/history.ts`)

Gives the agent access to its own conversation history — search, list, and read past conversations. Transforms the agent from having amnesia between sessions to being able to reference prior interactions.

**Agent tool**: `conversation_recall` with three actions:
- `search` — keyword search across conversation titles and directories
- `list` — show recent conversations with metadata (date, message count, source)
- `read` — load messages from a specific conversation by ID or prefix

**History module** (`src/modules/history.ts`): Built-in module registering the tool in the `management` group. Prompt section teaches the agent when to use conversation recall vs. memory/knowledge.

**Request analyzer integration** (`src/request-analyzer.ts`): Per-request context analysis now searches conversation history alongside memory. When a user's message contains keywords that match past conversation titles, the relevant conversations are surfaced in the pre-loaded context hint — giving the agent immediate awareness of related prior discussions at zero LLM cost.

**Design decisions**:
- Read-only: the agent can search and read but not modify or delete conversations. History management stays in the CLI (`kota history delete/clear`).
- Classified as `safe` in guardrails — pure read-only access to local data.
- Messages truncated to 500 chars each, max 50 messages per read — prevents context explosion when reading long conversations.
- Builds on existing `ConversationHistory` infrastructure (iter 525+) — no new storage layer needed.

### HTTP API Server (`src/server/server.ts`)

Pure `node:http` server exposing KOTA via REST + SSE. Key endpoints: `POST /api/chat` (SSE stream), sessions CRUD, schedules, notifications, events webhook, health. ProxyTransport pattern swaps SSE target per-request. SessionPool with TTL cleanup (30min) and LRU eviction (max 10). Usage: `kota serve --port 3000`.

### Web UI (`src/web-ui/`)

Embedded browser chat at `GET /`. Zero-dependency HTML/CSS/JS assembled from 4 modules. SSE streaming, session management, markdown rendering, XSS protection, responsive design. Testable rendering via `web-ui-markdown.ts`.

### Telegram Bot (`src/telegram.ts`)

Telegram messaging frontend using Bot API over `fetch` (zero deps). ProxyTransport pattern (same as HTTP server). Per-chat sessions with typing indicators, message chunking (4096 char limit), long polling. Commands: `/start`, `/clear`, `/status`. Access control via `allowedChatIds`. Scheduler integration for reminders and autonomous actions. Usage: `kota telegram --token <TOKEN>`.

### Daemon Mode (`src/scheduler/daemon.ts`)

Long-running event-driven runtime hosting event bus, scheduler, and round-robin idle tasks. Self-restart on `dist/cli.js` change (exit 75). State persisted to `~/.kota/daemon-state.json`. Graceful shutdown (30s drain). CLI: `kota daemon [--idle-prompt "..."] [--idle-cooldown 300]`.

### Context Management (`src/context.ts`)

Three-phase lifecycle to maximize usable context:

1. **Observation masking** (every turn, `src/observation-masking.ts`): Replace ALL old tool outputs beyond a rolling window of 10 messages with compact placeholders. Zero LLM cost — pure string replacement. Based on JetBrains research (NeurIPS 2025, "The Complexity Trap") showing tool outputs are 80%+ of context tokens and masking cuts context ~50% with no performance loss. Idempotent — already-masked results are skipped. Preserves agent reasoning and action history (assistant text + tool_use blocks untouched).
2. **Compaction** (75% budget): Two-phase — deterministic state extraction (files modified, commands run, errors) + LLM narrative summary. Keeps recent 10 messages intact. Now triggers less frequently thanks to masking.
3. **Adaptive truncation**: Tool result size limits shrink as budget fills (50K → 15K → 5K chars).

Split system blocks: static prompt (cached) + dynamic state (uncached, changes per turn).

### Token Budget Awareness

Each turn shows `context: N%`. Above 50%, budget warnings appear in the dynamic system prompt. Tool results auto-truncate based on remaining budget (head + tail with notice).

### Streaming (`src/model/streaming.ts`)

Mid-stream failures retry up to 3 times with jittered exponential backoff. Auth/config errors fail fast; transient errors retry. Text streams to stdout, thinking to stderr.

### Self-Registering Tool Registry (`src/tools/index.ts`)

Each core tool file exports a `registration` object with co-located metadata:
```typescript
export const registration = {
  tool: myTool,        // Anthropic.Tool definition
  runner: runMyTool,   // execution function
  risk: "safe",        // "safe" | "moderate" | "dangerous"
  group: "web",        // optional: tool group for progressive disclosure
};
```

`tools/index.ts` collects all registrations and exports `getCoreRegistrations()`. Consumers derive their data from the registry instead of hardcoding tool names:

- **`guardrails.ts`**: `SAFE_TOOLS`/`MODERATE_TOOLS` built from `registration.risk` — no manual edit needed when adding a tool.
- **`module-factory.ts`**: `BUILTIN_TOOL_NAMES` built from registrations — prevents name conflicts with agent-created modules automatically.
- **`tool-groups.ts`**: Still reads from hardcoded sets (circular import with `tools/index.ts` prevents direct derivation). Future work.

**Adding a new core tool** (reduced from 8 files to 5):
1. `src/tools/<tool>.ts` — implement + export `registration` with risk/group
2. `src/tools/index.ts` — import registration (1 line)
3. `src/tool-groups.ts` — add to CORE_TOOL_NAMES or TOOL_GROUPS
4. `src/tools/<tool>.test.ts` — write tests
5. `DESIGN.md` — document

**Lazy initialization**: Registration array and derived structures (runners, tool list) are built on first access, not at module level. This avoids crashes from circular ESM imports (e.g., `delegate.ts → context.ts → tools/index.ts → delegate.ts`).

### Tool Design Principles

From Anthropic's "Writing Tools for Agents":
1. Tools are API contracts — clear names, typed parameters, meaningful errors
2. Output is token-efficient — no verbose dumps, paginated where needed
3. Errors guide the agent — "File not found at X. Did you mean Y?" not "ENOENT"

### Page-Level Web Extraction (`src/data/html-page-extract.ts`)

Enhances `web_fetch` output for HTML pages with three layers of intelligence on top of the base `extractContent()` pipeline:

1. **Content region detection** (`findContentRegion`): Identifies the main content area using semantic HTML (`<article>`, `<main>`, `[role="main"]`) and common CSS patterns (`id="content"`, `.entry-content`, `.post-content`, `.article-content`). Falls back to full page when no region found. Minimum 100 chars threshold to reject empty containers.

2. **Metadata extraction** (`extractMetadata`): Pulls title, description, author, date, and site name from `<head>` meta tags. Supports OpenGraph (`og:title`, `og:description`, `og:site_name`), `article:published_time`, and standard meta tags. OG tags take priority over standard tags.

3. **Class/ID boilerplate removal** (`removeBoilerplateByAttr`): Removes `<div>`/`<section>` elements whose `class` or `id` matches common noise patterns: sidebar, comments, related, social, share, widget, advertisement, cookie, consent, popup, modal, banner, toolbar, newsletter, promo, sponsor.

**Integration**: `web_fetch` calls `extractPage()` instead of `extractContent()` for HTML responses. The result includes a compact metadata header (title, author, date, site name, description) followed by `---` separator and clean Markdown content.

**Design decisions**:
- Separate file from `data/html-extract.ts` — page-level concerns (metadata, content regions) are distinct from HTML→Markdown conversion.
- `extractPage()` delegates to `extractContent()` for the Markdown conversion step — no code duplication.
- Zero new dependencies — all regex-based, consistent with the existing approach.
- Content region detection uses priority ordering (article > main > role=main > id=content) to handle pages with multiple semantic containers.

### Linter-Gated Edits (`src/lint.ts`)

After each `file_edit`/`file_write`, syntax is checked (JSON.parse, node --check, esbuild, python3 ast.parse). On failure, file is auto-reverted. Prevents cascading errors from bad edits.

### Smart Edit Error Recovery (`src/tools/file-edit.ts`)

Two-tier recovery when `old_string` not found:
1. **Whitespace-tolerant auto-fix**: Normalize indentation/trailing spaces, re-match. Must be unambiguous and ≥10 non-WS chars. Still lint-gated.
2. **Fuzzy match display**: Bigram (Dice) similarity finds closest region, shows it with line numbers and context so the agent can self-correct.

### Sub-Agent Delegation (`src/tools/delegate.ts`)

Three modes and two backends:
- **`explore`**: Quick research with read + execution tools (file_read, grep, glob, repo_map, web tools, code_exec, shell, http_request). Max 10 turns.
- **`execute`**: Can modify files and run commands (adds file_edit, file_write, multi_edit, shell@60s). Max 15 turns. Tracks and reports modified files.
- **`research`**: Deep multi-step research with iterative deepening. Same read-only tools as explore, but 25-turn budget. Prompt guides: decompose → parallel search → evaluate gaps → deepen → synthesize with provenance. Response format: executive summary, key findings table with confidence, sources with dates.
- **Backend routing**: Model router selects `thin` (KOTA's own tool loop) or `agent-sdk` (Claude Code runtime via `delegate-agent-sdk.ts`). Agent SDK backend auto-selected for execute + coding/debugging/automation at capable tier. Manual override via `DelegateConfig.backend`.

Fresh API call per delegation — main context only sees task + final answer. Sub-agent text streams to stderr for live progress visibility. Robustness: prompt caching across turns, tool result truncation (30K cap), circuit breaker on 3 identical failures, and context overflow handling with actionable errors.

**Custom prompt templates**: The `prompt` parameter overrides the default mode system prompt with a template from `.kota/prompts/`. Templates are markdown files with YAML front matter and `{{variable}}` substitution (via `PromptStore`). The `prompt_vars` parameter supplies substitution values. This enables users to customize sub-agent behavior for domain-specific tasks (e.g., custom code review, security audit, data analysis) without modifying source code. When a template is specified but not found, an error lists available templates.

**MCP tool integration**: When MCP servers are configured, their tools are automatically available to sub-agents. The `McpManager` is threaded through `DelegateConfig` after MCP initialization. In the delegate loop, tool calls are routed: MCP-namespaced tools (`mcp__*`) go through `McpManager.executeTool()`, built-in tools through the standard runners. This ensures users' external tool servers work consistently across the main loop and delegated tasks.

### Batch Parallel Delegation (`src/tools/batch.ts`)

Scatter-gather orchestrator: takes an array of task descriptions, spawns parallel sub-agents (reusing `runDelegate`), collects all results. Concurrency-limited (default 3, max 5, max 10 tasks). Per-task result budget scales inversely with task count (total 30K). Partial failures don't block other tasks — all results returned with success/error status.

### Sequential Tool Pipe (`src/tools/pipe.ts`)

Inline sequential tool composition — the sequential complement to `batch` (parallel). Chains 2-10 tool invocations with data flow: `$prev` for previous output, `$steps[N]` for any prior step, `$prev.field` for JSON field access, `{{template}}` for inline interpolation. Supports conditional `if` on steps with full expression language (&&, ||, !, contains, matches, parentheses). Stops on first error. Reuses `resolveStepInput`/`evaluateCondition` from manifest steps (same semantics as module scripts).

### Parallel Map (`src/tools/map.ts`)

Homogeneous parallel apply — calls `executeTool` directly for each item (no LLM overhead). Complements `batch` (heterogeneous, LLM-powered sub-agents) and `pipe` (sequential chain). Max 50 items, concurrency 5-20. Per-item result budget scales inversely with count (total 30K). Partial failures don't stop other items.

### Shared Workspace / Blackboard (`src/workspace.ts`, `src/tools/workspace.ts`)

In-memory shared key-value store for multi-agent coordination. Parent creates a workspace, delegates tasks — sub-agents read/write entries directly without routing through the parent. Actions: `create`, `write`, `read`, `list`, `delete`. Entries have key, value, optional author, timestamp. Available to both explore and execute sub-agents. Part of the `orchestration` tool group.

### Environment Introspection (`src/tools/env-info.ts`)

Structured host environment discovery tool. Queries: `os` (platform, arch, version, shell, hostname, user, uptime, sudo), `runtimes` (installed languages — node, python, go, rust, java, ruby, deno, bun — and package managers), `services` (listening ports via lsof, Docker containers), `resources` (CPU model/cores, memory used/total/free, disk, GPU via nvidia-smi), `all`. All probes use 3-second timeouts and graceful fallback ("not available" on failure). Cross-platform: macOS-specific checks (sw_vers, sysctl), Linux (os-release), with general fallbacks. Safe-risk core tool. No environment variable exposure — avoids secret leakage.

### File Watcher (`src/file-watcher.ts`, `src/tools/file-watch.ts`)

Reactive filesystem monitoring with event bus integration. Watches directories for file changes (create/change/delete), batch-debounces at 250ms, and emits `file.changed` events on the EventBus. Enables reactive automation — combine with `schedule(on_event, "file.changed")` for auto-lint-on-save, test-on-change, or sync workflows.

- **WatcherManager**: Singleton managing up to 10 concurrent watchers. Each watcher uses `fs.watch` (recursive on macOS/Windows, per-directory fallback on Linux). Default-ignores: node_modules, .git, dist, build, .next, __pycache__, .cache, .turbo, dotfiles.
- **Tool actions**: `start` (path, optional extensions filter, recursive flag), `stop` (by ID), `list` (active watchers with change counts).
- **Delete detection**: `rename` events checked with `stat()` — missing files marked as `delete`.
- Moderate risk, management group.

### Agent Status Introspection (`src/tools/agent-status.ts`)

Runtime self-inspection tool — lets the agent query its own capabilities and configuration. Queries: `tools` (core + module-registered, with risk/group), `modules` (loaded modules + tool counts), `providers` (registered service providers + active selection), `groups` (tool groups + enabled/disabled status), `config` (current settings, apiKey redacted), `all`. Optional `filter` parameter for text search across results. Safe-risk core tool (always available). Module and config info injected by `loop.ts` via setter pattern to avoid circular imports.

### Background Process Management (`src/tools/process.ts`)

Enables async workflows — start servers, run watchers, monitor long-running tasks:
- **start**: Spawn a command as a background process. Returns PID and initial output.
- **output**: Get recent stdout/stderr from a running process (circular buffer, last 500 lines).
- **signal**: Send SIGTERM/SIGINT/SIGKILL to a process.
- **list**: Show all managed processes with status, uptime, and last output line.

Max 5 concurrent processes. All auto-terminated on session close. Same dangerous-command detection as shell tool.

### Architect/Editor Split (`src/architect/`)

From Aider's research (+3-8% on benchmarks):
1. **Architect pass**: LLM without tools produces a step-by-step plan.
2. **Editor pass**: Fresh conversation with only file tools executes the plan (up to 30 turns).
3. **Main loop** continues with all tools for verification.

**Adaptive replanning** (`src/architect/replan.ts`): The editor loop monitors tool execution for failure patterns. When 3+ consecutive errors or stagnation (same tool+error repeating) is detected, a replanner LLM call evaluates the situation and decides: continue, revise the remaining plan, or abort. Max 2 replans per execution. Based on AdaPlanner's dual-mode refinement.

### Prompt Caching

System prompt sent with `cache_control: { type: "ephemeral" }`. Static prefix cached at 0.1x cost. Only new messages pay full price.

### Session Warmup (`src/init.ts`)

Auto-detects project type (Node.js, Python, Rust, Go), git state (branch, dirty files, recent commits), and recalls relevant memories. Agent starts oriented from turn 1.

### Request-Aware Context Pre-loading (`src/request-analyzer.ts`)

Complements session warmup (which is generic, per-session) with per-request intelligence. When the user sends a message, the analyzer:

1. **Extracts file paths** — regex patterns for relative paths (`./`, `../`), source-directory paths (`src/`, `lib/`, etc.), and standalone filenames with code extensions. Verified on disk with `statSync`.
2. **Extracts search terms** — strips code blocks, URLs, and stop words, then searches the memory store by content keywords (vs session warmup which searches by directory basename only).
3. **Formats a compact context hint** — appended to the user message so the LLM immediately knows which mentioned files exist (with sizes), and has relevant memories without extra tool calls.

Zero LLM cost — pure heuristics and local lookups. Security: all paths resolved relative to cwd, rejects paths outside the working directory.

### Task Router (`src/scheduler/task-router.ts`)

Classifies user requests by task type and provides strategy hints. Complements the request analyzer (which pre-loads context) with task-level intelligence (which adapts the agent's approach).

**Task types**: `research`, `coding`, `data_analysis`, `writing`, `planning`, `debugging`, `automation`, `general`.

**Per-request routing**:
1. **Weighted pattern matching** — each task type has 4-5 regex patterns with weights (1-3). The type with the highest total score wins. Minimum score threshold (2) prevents weak matches.
2. **Strategy hint** — a compact, task-specific reminder appended to the user message (e.g., `[Task: research — Delegate parallel searches on different angles. Compare 3+ sources with dates. Save key findings to knowledge store.]`). Makes the relevant system prompt guidance salient at the right moment.
3. **Group recommendations** — auto-enables the tool groups most useful for the detected task type (e.g., `web` + `management` for research, `code` + `advanced_editing` for coding).

**Integration** (`loop.ts`): Runs alongside `analyzeRequest()` and `detectToolGroups()` on every `send()` call. Strategy hint is appended to the user message. Group recommendations are enabled via `enableGroup()`, complementing (not replacing) the existing `GROUP_SIGNALS` detection.

**Design decisions**:
- Separate from request analyzer — different concerns (context pre-loading vs strategy adaptation).
- Scored classification over first-match — handles mixed-intent prompts (e.g., "research and implement") by picking the dominant intent.
- Minimum score threshold — avoids false positives on generic messages. Returns `null` for unclassifiable prompts.
- Strategy hints echo the system prompt's Workflow Patterns, but making them salient per-request improves adherence (relevance priming).

### Project Context (`src/project-context.ts`)

Reads `.kota.md` files from working directory up to root (like Claude Code's CLAUDE.md). Injected into system prompt.

### Instruction File Discovery (`src/instruction-files.ts`)

Discovers and loads `AGENTS.md` and `CLAUDE.md` files from the working directory up to 10 levels. Follows the cross-tool standard (Claude Code, Codex CLI, Cursor, Copilot, Gemini). Injected into system prompt alongside project context.

- **Hierarchy**: Root-first ordering — outermost ancestor first, most-specific last
- **Cross-references**: `@path/to/file.md` references are resolved (up to depth 3), matching Claude Code's pattern
- **Truncation**: 8KB per file to manage token budget
- **Circular ref protection**: Detected and replaced with HTML comments
- **Both file types**: AGENTS.md and CLAUDE.md at each directory level

### Persistent Tasks (`src/scheduler/task-store.ts`)

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

### Scheduler (`src/scheduler/schedule-parser.ts`, `src/scheduler/scheduler.ts`, `src/tools/schedule.ts`)

Time-aware scheduling for reminders, recurring tasks, and autonomous agent actions. Enables the agent to "remind me in 30 minutes", "check this every hour", or proactively execute tasks on a schedule.

Pure parsing utilities (`parseTime`, `parseRepeat`, `matchesFilter`, `formatRelative`) and the shared `projectHash` function live in `schedule-parser.ts` — independently testable, no state or I/O. The `Scheduler` class in `scheduler.ts` handles stateful scheduling (CRUD, persistence, timer/bus orchestration) and re-exports the parsing functions for backward compatibility.

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

### Autonomous Scheduled Actions (`src/scheduler/action-executor.ts`)

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

### Persistent Memory (`src/memory/store.ts`)

Cross-session memory in `~/.kota/memory.json`. Save/search/list/delete with keyword ranking. Auto-prune at 100 entries.

### Knowledge Store (`src/memory/knowledge-store.ts`)

File-based structured data layer — each entry is a markdown file with YAML front matter. Replaces the limitations of flat JSON memory with human-readable, git-trackable knowledge management.

**Format**: Each entry is a `.md` file in `.kota/data/` (project) or `~/.kota/data/` (global):
```markdown
---
id: abc123
title: API Design Decision
type: decision
tags: [api, architecture]
status: active
created: 2024-03-15T10:00:00Z
updated: 2024-03-15T10:00:00Z
---
# API Design Decision
Content in markdown...
```

**Core operations**: create, read, update, delete, search, list. Search combines keyword matching across title, content, tags, and type with optional filters (type, tag, status, since date, scope).

**Dual scope**: Project-scoped entries (`.kota/data/`) for project-specific knowledge, global entries (`~/.kota/data/`) for cross-project information. Search/list can target either or both scopes.

**Interop**: Files are standard markdown — readable and editable by humans and other tools. The agent can also use `file_read`/`file_edit` directly on knowledge files.

**Integration**: Registered via the `knowledge` module in the `management` tool group. Session warmup (`init.ts`) recalls recent project knowledge entries at session start.

### Conversation History (`src/memory/history.ts`)

Auto-persists conversations to `~/.kota/history/<id>.json` with index for fast listing. Resume via `kota run --continue [id]`. CLI: list, show, resume, delete, clear. HTTP: `/api/history` CRUD. Source-aware auto-prune (50 user / 20 action max). Session warmup shows recent conversations on start.

### Safety & Error Recovery

- **Destructive command confirmation** (`src/confirm.ts`): Regex patterns detect rm, sudo, git push, etc.
- **Progressive failure tracking** (`src/tool-runner.ts`): 3 identical failures → circuit break; 5 diverse failures → guidance injection.
- **Automatic tool retry** (`src/tool-retry.ts`): Transient failures (timeouts, network, HTTP 429/5xx) retry once with adjusted params.
- **File freshness tracking** (`src/file-tracker.ts`): mtime-based stale detection between reads and edits.
- **Smart path resolution** (`src/path-resolver.ts`): File-not-found errors show similar files via basename + fuzzy match.
- **Shell error diagnostics** (`src/shell-diagnostics.ts`): Extracts diagnostic-relevant lines from long output (TypeScript errors, test failures, lint errors).
- **Error context enrichment** (`src/error-context.ts`): Pre-fetches source code around file:line references in errors.
- **Verification nudges** (`src/verify-tracker.ts`): Tracks unverified edits, detects available test/build commands, escalates after 3 turns.
- **File change tracking & undo** (`src/file-changes.ts`, `src/tools/checkpoint.ts`): Automatically records the original state of every file before its first modification. The `checkpoint` tool (core, always available) lets the agent list changes, diff against originals, and restore files — surgical undo for multi-file edits gone wrong. Singleton lifecycle managed in `AgentSession` (init on construction, reset on close). Change summary injected into dynamic system state for agent awareness.

### Model Client Abstraction (`src/model/model-client.ts`)

`ModelClient` interface decouples the agent loop from the Anthropic SDK. Exposes `messages.stream()` and `messages.create()` — the two API surfaces used by the agent. `MessageStream` interface: `.on("text"|"thinking", cb)` + `.finalMessage()`. `AnthropicModelClient` wraps `@anthropic-ai/sdk` as the default provider. All LLM call sites (`loop.ts`, `streaming.ts`, `architect.ts`, `delegate.ts`, `compaction.ts`, `context.ts`) accept `ModelClient` instead of `Anthropic` directly. Mock clients in tests now implement `ModelClient` instead of casting to `Anthropic`. Enables future provider swapping (Claude Agent SDK, other models) without changing agent code.

### OpenAI-Compatible Model Client (`src/openai/`)

Split into 4 focused modules under `src/openai/`: `types.ts` (API types), `translations.ts` (Anthropic ↔ OpenAI format conversion), `stream.ts` (SSE consumer with tool call accumulation), `client.ts` (`OpenAIModelClient` class). Works with any OpenAI-compatible endpoint (OpenAI, Ollama, Groq, Together, vLLM, LM Studio). 78 tests across 4 test files.

### Provider Factory (`src/model/provider-factory.ts`)

`createModelClient({ model, provider?, baseUrl?, apiKey? })` resolves CLI flags + config into a `ModelClient`. Supports `provider/model` notation (e.g., `ollama/llama3`, `openai/gpt-4o`) following the LiteLLM convention. Built-in presets: `openai`, `ollama`, `groq`, `together`, `lmstudio` (each with default base URL and API key env var). Unknown providers work with explicit `--base-url`. Config file: `modelProvider: { type, baseUrl, apiKey }` in `config.json`. Precedence: CLI flags > `provider/model` prefix > config file > default (anthropic). 23 tests.

### Claude Agent SDK Backend (`src/agent-sdk/`)

Alternative execution backend using `@anthropic-ai/claude-agent-sdk` (optional peer dep). Unlike ModelClient providers (which handle single LLM calls while KOTA manages the agent loop), this delegates entire tasks to Claude Code's full agent runtime — Claude Code handles its own tool execution (Read, Write, Edit, Bash, Glob, Grep, WebSearch), file checkpointing, and context management. Usage: `kota run --provider agent-sdk "task"` or `modelProvider.type: "agent-sdk"` in config. Streams assistant text to stdout. Types in `types.ts` match SDK's public API surface. Dynamic import with graceful error if SDK not installed. Also used as delegate backend (see below). 10 tests.

### Agent SDK Delegate Backend (`src/tools/delegate-agent-sdk.ts`)

Routes delegate sub-agent tasks through Claude Code's full agent runtime instead of the "thin" KOTA tool loop. When the model router selects the `agent-sdk` backend (execute mode + coding/debugging/automation at capable tier), `runDelegateAgentSDK()` calls `loadSDK().query()` with mode-appropriate options: explore gets read-only tools (Read, Glob, Grep, Bash, WebSearch, WebFetch), execute adds Edit+Write. Budget-capped ($0.50 default, configurable via `agentSdkBudgetUsd`). Result and cost from SDK's `ResultMessage` feed back into KOTA's `assembleDelegateResult()` and `CostTracker.addRawCost()`. Graceful fallback: if SDK not installed, returns error prompting thin backend. 12 tests.

### Adaptive Model Routing (`src/model/model-router.ts`)

Automatically selects the optimal model tier (fast/balanced/capable) and delegate backend (thin/agent-sdk) for delegate sub-agents based on task analysis. Combines task-type classification from `routeTask()` with complexity signals (architecture keywords → upgrade, simple lookups → downgrade) and delegate mode (execute → +1 tier bump). Backend routing: execute + coding/debugging/automation at capable tier → agent-sdk; everything else → thin. Config: `modelTiers: { fast, balanced, capable }` in `config.json` maps tiers to model strings. Defaults: fast=haiku, balanced=sonnet, capable=opus. 35 tests.

### Session State Machine (`src/session-state.ts`)

Explicit lifecycle states for `AgentSession`, mapping to the ReAct pattern. States: `idle → initializing → ready → thinking → acting → ready` (happy path), with `reflecting` and `error` branches. Transition table enforced — invalid transitions throw. Listeners notified on every change with `(from, to, meta)`. State changes emit `state_change` transport events and `session.state` bus events. `AgentSession.getState()` exposes current state. History tracking with `consecutiveCount()` for loop detection.

### Tool Execution Telemetry (`src/tool-telemetry.ts`)

Session-scoped instrumentation tracking per-tool timing, success/failure rates, and error patterns. Integrated into `executeToolCalls()` — every tool call is timed and recorded automatically. Compact summary injected into dynamic system state (`<tool-metrics>` tag) so the agent can see tool performance and adapt strategy. `tool_metric` transport events emitted for operator visibility. Singleton lifecycle: `getToolTelemetry()` / `resetToolTelemetry()` managed in `AgentSession`.

### Tool Middleware (`src/tool-middleware.ts`)

Composable pre/post hooks for tool execution. Modules register middleware via `ctx.registerMiddleware(name, fn, priority?)`. Each middleware wraps execution as `(call, next) => Promise<ToolResult>` — can inspect/modify input, short-circuit, or transform results. Priority controls order (lower runs first, default 100). Integrated into `executeToolCalls()` between guardrails and telemetry. Module middleware auto-cleaned on unload. Singleton: `getToolMiddleware()` / `resetToolMiddleware()`.

### Tool Result Cache (`src/tool-cache.ts`, `src/modules/tool-cache.ts`)

Session-scoped middleware that caches deterministic read tool results (`file_read`, `grep`, `glob`, `repo_map`, `files_overview`, `read_document`, `view_image`). Cache key: tool name + canonical JSON of sorted input. Auto-invalidates the entire cache when mutating tools (`file_write`, `file_edit`, `multi_edit`, `find_replace`, `shell`, `code_exec`, `notebook`, `process`, `computer_use`) execute. Errors are never cached. Stats (hits/misses/invalidations/size) available via `getToolCache().stats`. Registered as a module with priority 10 (runs before logging middleware). Singleton: `getToolCache()` / `resetToolCache()`.

### Tool Retry Middleware (`src/tool-retry.ts`, `src/modules/tool-retry.ts`)

Middleware that auto-retries transient tool failures. Per-tool policies in `RETRY_POLICIES`: `shell` retries on timeout with doubled `timeout_ms` (max 300s), `web_fetch`/`web_search`/`http_request` retry on transient network errors (ECONNRESET, ETIMEDOUT, 429, 502, 503, 504) with 1500ms delay. Permanent errors (404, 401, 403) are never retried. The middleware mutates `call.input` for input adjustment (shell timeout), so `baseFn` must read from `call.input`. Stats: `getRetryStats()` tracks totalRetries/successAfterRetry/exhausted. Registered as a module with priority 20 (after cache). Legacy `maybeRetry()` kept for delegate.ts which has its own execution loop.

### Interactive Code Execution (`src/tools/code-exec.ts`)

Persistent REPL sessions (Python / Node.js) for iterative computation. Wrapper processes use a sentinel-based protocol: code lines are sent via stdin until a sentinel marker, then executed, with a done marker printed to stdout when complete. State (variables, imports) persists across calls within a session. AST-based last-expression extraction (Python) displays return values like IPython. Sessions are managed per-language and cleaned up on agent shutdown.

**Matplotlib auto-capture** (`src/data/plot-capture.ts`): Python wrapper sets `MPLBACKEND=Agg` and captures open matplotlib figures after each execution (up to 5). Images are saved as temp PNGs, extracted from output via markers, read as base64, and returned as image blocks in the tool result. The agent can see its own charts and iterate on visualizations. Seaborn works automatically (uses matplotlib backend).

### Plugin Discovery (`src/plugin-loader.ts`)

File-based plugin architecture for extending KOTA without modifying core code. Drop `.js`/`.mjs` files in `.kota/plugins/` — they're auto-discovered, adapted to `KotaModule` format, and loaded through `ModuleLoader`.

**Discovery**: `discoverPluginModules(cwd)` scans `.kota/plugins/` and `.kota/packages/`, adapts each export to `KotaModule` via `adaptExport()`, and returns them. The caller passes them to `ModuleLoader.loadAll()` alongside built-in modules.

**Module interface** (`KotaModule` from `src/module-types.ts`):
- `name`: Unique identifier (required)
- `tools`: Array of `ToolDef` — each provides an Anthropic tool schema + runner function
- `commands`, `routes`, `events`: CLI commands, HTTP routes, and event bus subscriptions
- `onLoad(ctx)`: Lifecycle hook called after registration. `ModuleContext` provides `cwd`, `verbose`, `config`, `registerGroup()`, and `getRoutes()`
- `onUnload()`: Cleanup hook called on shutdown

**Tool registration**:
- Tools with a `group` property follow progressive disclosure (hidden until `enable_tools` is called or auto-detected)
- Ungrouped tools are always available (13 core tools: shell, file ops, grep, glob, delegate, ask_user, checkpoint, etc.)
- 6 groups with auto-detect: `web`, `code`, `advanced_editing`, `management`, `gui`, `orchestration`
- `gui` group: computer_use, screenshot, view_image, clipboard — auto-enabled for visual/screen tasks
- `orchestration` group: batch, pipe, map — auto-enabled for parallel/sequential composition tasks
- Module groups appear in the `enable_tools` description dynamically
- `registerGroup()` supports auto-detect regex patterns for automatic group activation

**Lifecycle**: `discoverPluginModules()` runs during session init. Discovered modules are loaded through `ModuleLoader`, which handles tool registration, dependency ordering, event connections, and cleanup via `unloadAll()`.

### Tool Format Adapters (`src/tool-adapters.ts`)

Auto-detects and converts plugin formats to KOTA's `ToolDef`: native KotaModule, simple (`{name, run}`), OpenAI function-calling, Vercel AI SDK (`{execute, parameters}`), arrays, and hybrid modules. Includes lightweight Zod→JSON Schema conversion (no Zod dep). Result normalization handles strings, objects, `{content}`. `adaptExport()` used by plugin discovery.

### Remote Tool Registry (`src/registry.ts`)

Install tools from npm, URLs, or GitHub: `kota tools install <source>`. Manifest at `.kota/tools.json`. Discovery scans `.kota/plugins/` (files) and `.kota/packages/node_modules/` (npm). CLI: install, list, remove, update. `kota-`/`tool-` prefixes auto-stripped.

### Vercel AI SDK Streaming (`src/vercel-ai-stream.ts`, `src/modules/vercel-adapter.ts`)

Data Stream Protocol v1 at `POST /api/chat/vercel`. Stateless per-request sessions matching `useChat()` pattern. Wire format: `{TYPE_CODE}:{JSON}\n` with codes for text deltas, tool calls/results, thinking, finish. Compatible with `useChat()` from `ai/react`.

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

### MCP Support (`src/mcp/`)

External tool servers via Model Context Protocol. Configure in `.kota/mcp.json`. Tools namespaced as `mcp__<server>__<tool>`. Stdio transport, graceful degradation.

### Vision

`file_read` handles images (PNG, JPEG, GIF, WebP) natively — base64-encoded and sent as Anthropic image content blocks. Rich tool results (`ToolResult.blocks`) support mixed text + image content.

### Session Pool (`src/server/session-pool.ts`)

Extracted HTTP session infrastructure — `SseTransport`, `SessionPool`, `ManagedSession` type, and HTTP helpers (`setCors`, `jsonResponse`, `readBody`). Shared by the HTTP server and any future transport that needs session management over HTTP.

### Linting (`biome.json`)

Biome linter enforces code quality across all source files. Rules cover unused imports/variables, type-only imports, template literal preference, `Number.isNaN` over global `isNaN`, and import sorting. Run via `npm run lint`; auto-fix via `npm run lint:fix`.

## Testing

### E2E Tests with Mock Client (`src/model/mock-client.ts`, `src/e2e.test.ts`)

The mock client enables full agent loop testing without a real API key:

```typescript
import { createMockClient, textResponse, toolUseResponse } from "./model/mock-client.js";

// Define the response sequence the "LLM" will return
const [client, calls] = createMockClient([
  toolUseResponse("file_read", { path: "/tmp/test.txt" }),  // Turn 1: agent calls file_read
  textResponse("The file says hello."),                      // Turn 2: agent responds
]);

const session = new AgentSession({ client, transport: new BufferTransport(), noHistory: true });
await session.send("Read the file");
// `calls` contains every API request for assertion
```

**How it works**: `AgentSession` accepts an optional `client` via `LoopOptions`. The mock client's `messages.stream()` returns a `MockStream` that emits text/thinking events and resolves `finalMessage()` with pre-configured responses. Each call consumes the next response in sequence; the last response is reused when exhausted.

**Response builders**: `textResponse(text)`, `toolUseResponse(name, input)`, `multiToolResponse([...])`. All produce valid `Anthropic.Message` objects with proper usage fields.

**Test coverage**: Core loop (single/multi-turn, parallel tools, circuit breaker), event bus (session.start/end), context persistence (multi-send), observation masking, tool integration (file_read, file_write, shell, grep, todo).

### Event-Driven Pipeline E2E Tests (`src/e2e-events.test.ts`)

Tests the full event → module handler → tool execution chain without mocking the LLM (no agent loop involved — tests the step-handler pipeline directly):

- **Step handler execution**: custom event → file_write tool produces file on disk
- **$prev chaining**: file_read → file_write with output flowing between steps
- **Conditional steps**: `if` guards that evaluate `$prev contains X`
- **Error isolation**: failed step stops pipeline but doesn't crash the event bus
- **Typed events**: `schedule.fire` and `knowledge.create` trigger handlers with `$payload` template interpolation and field access
- **Multi-handler**: multiple modules on same event all execute independently
- **Lifecycle**: unsubscribed handler does not fire; `$steps[N]` back-references
- **Full pipeline**: Scheduler getDue → markFired → bus emit → handler → tool; multiple due items produce separate files

### Composition Tests (`src/composition.test.ts`)

Verify that individually-tested capabilities compose into working multi-step workflows. Each scenario exercises a realistic user workflow through the full agent loop:

- **Code fix workflow**: grep → file_read → file_edit → file_read (verify)
- **Error recovery**: file_read (fails) → grep (find correct file) → file_read (succeed)
- **Write → edit → read roundtrip**: file_write → file_edit → file_read
- **Lint-gated edit recovery**: file_edit (syntax error, auto-reverted) → file_edit (correct)
- **Multi-turn state persistence**: file_write in turn 1 → file_read in turn 2
- **Task tracking + shell**: todo add → shell → todo update
- **Parallel + sequential**: multi-tool read → sequential edits

Tests assert not only final outcomes but also that tool results from earlier steps flow correctly into subsequent API calls (verifying context plumbing).

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI parsing
- `glob` — File pattern matching
- `@biomejs/biome` — Linting and import organization (dev)
- `vitest` — Testing (dev)
