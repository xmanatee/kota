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

**Interfaces**:
- `MemoryProvider` — `save`, `search`, `list`, `update`, `delete`. The built-in `MemoryStore` structurally satisfies this.
- `KnowledgeProvider` — `create`, `read`, `update`, `delete`, `search`, `list`, `count`. The built-in `KnowledgeStore` structurally satisfies this.

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
    "knowledge": "default"
  }
}
```

**Module integration**: Modules register as providers via `ctx.registerProvider(type, provider)` in `onLoad`. After all modules are loaded, `ModuleLoader.activateConfiguredProviders()` activates the providers specified in config.

**Fallback**: If no provider is registered for a type, the convenience getters (`getMemoryProvider()`, `getKnowledgeProvider()`) fall back to the built-in singletons. This means the agent works identically with zero config.

**Built-in providers**:
- `default` — file-based JSON (`MemoryStore`, `KnowledgeStore`). Active by default.
- `sqlite-memory` — SQLite-backed memory (`src/sqlite-memory.ts`, `src/modules/sqlite-memory.ts`). SQL-powered search, no 100-memory cap, concurrent-safe via WAL mode. Uses `sqlite3` CLI (no library dependency). Activate: `{ "providers": { "memory": "sqlite-memory" } }`. DB stored at `.kota/modules/sqlite-memory/memory.db`.

**Design decisions**:
- Structural typing — existing classes don't need `implements MemoryProvider`. TypeScript duck typing ensures conformance automatically.
- Follows the `SecretProvider` pattern from `secrets.ts` but generalized to any service type.
- Default providers registered during init, before modules load. Modules can override.
- Registry cleared on `ModuleLoader.unloadAll()` — no stale providers across sessions.

### Desktop Notifications (`src/tools/notify.ts`)

Sends desktop notifications to the user via the OS notification system. Enables the agent to proactively alert the user about completed tasks, monitoring events, or anything needing attention when the user isn't watching the terminal.

**Platform support**:
- **macOS**: `osascript` with `display notification` (supports sound via `sound name "Glass"`)
- **Linux**: `notify-send` from libnotify (error message if not installed)
- **Fallback**: Console output via stderr (for unsupported platforms or when desktop fails)

**Design decisions**:
- Core tool (always available) — notifications are universally useful.
- Desktop failure automatically falls back to console — never silently fails.
- Sound enabled by default, can be disabled with `sound: false`.
- AppleScript string escaping for quotes and backslashes in messages.

### Screenshot Capture (`src/tools/screenshot.ts`)

Captures a screenshot of the screen and returns it as an image content block for Claude to analyze. Adds visual understanding — a fundamentally new input modality for the agent.

**Platform support**:
- **macOS**: `screencapture -x` (silent, built-in). Resizes with `sips` if image exceeds 1568px.
- **Linux**: Tries `gnome-screenshot`, `scrot`, then `import` (ImageMagick). Resizes with `convert`.
- **Unsupported**: Returns an error with platform-specific guidance.

**Design decisions**:
- Core tool (always available) — visual context is useful across all domains.
- Classified as `safe` in guardrails — read-only, no mutation.
- Resize to 1568px max (Claude's optimal image dimension) to minimize token cost.
- Only downscales, never upscales — resize failures are non-fatal.
- Returns `ToolResult.blocks` with image content block — the existing pipeline handles image blocks in tool results, observation masking, and context management.
- Temp file cleaned up after capture regardless of success/failure.

### Document Reader (`src/tools/read-document.ts`)

Extracts text from PDFs, DOCX, RTF, ODT, EPUB, and other document formats using available system tools. Zero npm dependencies — leverages platform utilities with graceful fallback chains.

**Extraction chains** (tried in order until one succeeds):
- **PDF**: `pdftotext` (poppler) → `pdfminer` (python3) → `PyPDF2` (python3)
- **DOCX**: `textutil` (macOS built-in) → `pandoc` → `python-docx` (python3)
- **RTF**: `textutil` (macOS built-in) → `pandoc`
- **ODT/EPUB/DOC**: `pandoc`
- **HTML**: Built-in tag stripping (no external tools needed)

**Features**:
- Page range selection for PDFs (`pages: "3-7"`)
- Configurable max output length (`max_chars`, default 50000)
- Truncation with notice when output exceeds limit
- Empty-content detection with OCR guidance

**Design decisions**:
- Core tool (always available) — document processing is useful across all domains.
- Classified as `safe` in guardrails — read-only, no mutation.
- Zero npm dependencies — uses only system tools. Missing tools produce actionable install hints.
- Complements `file_read` (raw text) and `screenshot` (visual) as a third input modality.
- 30s timeout per extraction attempt to handle large documents without hanging.

### Clipboard (`src/tools/clipboard.ts`)

Read from and write to the system clipboard. Enables seamless data transfer between the agent and other applications — users can copy text, have the agent process it, and get results back on their clipboard ready to paste.

**Platform support**:
- **macOS**: `pbpaste` / `pbcopy` (built-in)
- **Linux**: `xclip -selection clipboard` (requires `xclip` package)
- **Fallback**: Error with platform-specific guidance

**Design decisions**:
- Core tool (always available) — clipboard interaction is useful across all domains.
- Classified as `safe` in guardrails — clipboard read/write is low-risk and reversible.
- Read limit: 50,000 chars. Write limit: 100,000 chars. Prevents excessive clipboard usage.
- Zero npm dependencies — uses only platform clipboard utilities.

### Computer Use (`src/tools/computer-use.ts`)

Control mouse and keyboard to interact with the computer's GUI. Combined with the existing screenshot tool, enables the full computer use paradigm — the agent can see the screen, click buttons, fill forms, navigate menus, and automate GUI applications.

**Actions**:
- `click` / `double_click` / `right_click` — click at (x, y) coordinates
- `move` — move cursor to (x, y)
- `drag` — drag from (start_x, start_y) to (x, y)
- `type` — type a text string
- `key` — press a key or key combo (e.g., `"enter"`, `"cmd+c"`, `"ctrl+shift+z"`)
- `scroll` — scroll up/down (via Page Up/Down on macOS, mouse wheel on Linux)
- `cursor_position` — get current cursor coordinates

**Platform support**:
- **macOS**: `cliclick` for mouse operations (`brew install cliclick`), `osascript` for keyboard (built-in). Click falls back to `osascript` System Events when `cliclick` isn't available.
- **Linux**: `xdotool` for all operations (`apt install xdotool`).
- **Unsupported**: Returns error with platform-specific guidance.

**Workflow** (screenshot → action → screenshot loop):
1. Agent calls `screenshot()` to see the current screen
2. Agent identifies target (button, field, menu item) from the image
3. Agent calls `computer_use(action: "click", x: 500, y: 300)` to interact
4. Agent calls `screenshot()` again to verify the result
5. Repeat as needed

**Design decisions**:
- Core tool (always available) — GUI interaction is useful across all domains, pairs with screenshot.
- Classified as `moderate` in guardrails — user-level input, can have side effects but locally contained.
- Zero npm dependencies — uses only system tools with graceful fallback chains.
- Coordinates are rounded to integers (fractional pixels not meaningful).
- Scroll amount capped at 20 to prevent abuse.
- AppleScript string escaping handles embedded quotes via `character id 34` concatenation.
- Tool detection (`cliclick`, `xdotool`) is cached per-session with `resetComputerUseState()` for testing.
- Accessibility permission errors are detected and surfaced with setup instructions.

### SQLite Queries (`src/tools/sqlite.ts`)

Query SQLite databases via the `sqlite3` CLI. Enables data analysis, application debugging, structured queries, and database inspection — a fundamental capability for a general-purpose agent.

**Actions**:
- `tables` — list all user tables in the database
- `schema` — show column definitions, row count, and DDL for a table
- `query` — run arbitrary SQL and return results as markdown tables

**Implementation**:
- Uses `sqlite3 -json` for structured output parsing. Results formatted as markdown tables with column alignment.
- Mutations (INSERT/UPDATE/DELETE) append `SELECT changes()` in the same session to report affected rows.
- Table name validation via regex to prevent injection in PRAGMA/schema queries.
- Max 100 rows displayed, 50K char output cap. 30s timeout, 10MB buffer.

**Platform support**:
- **macOS**: `sqlite3` pre-installed (part of macOS).
- **Linux**: `apt install sqlite3` or equivalent.

**Design decisions**:
- Core tool (always available) — database queries are broadly useful across domains.
- Classified as `moderate` in guardrails — SQL can mutate data but is confined to local files.
- Zero npm dependencies — uses only the `sqlite3` CLI.
- `tables` and `schema` require the database file to exist. `query` allows creating new databases (sqlite3 creates on first write).
- Complements `code_exec` (Python/Node can also query SQLite, but this tool is faster and produces cleaner output for common queries).

### Image Viewer (`src/tools/view-image.ts`)

Reads a local image file and returns it as an image content block for Claude to analyze. Adds visual understanding of local files — a fundamental new input modality complementing `screenshot` (screen → vision) and `read_document` (document → text).

**Supported formats**: PNG, JPEG, GIF, WebP — mapped to appropriate MIME types.

**Validation**:
- File existence and type checks (rejects directories)
- Extension validation against supported formats (case-insensitive)
- Size limit: 20MB (Claude's base64 image limit)

**Resize**: Large images are copied to a temp file and downscaled to 1568px (Claude's optimal dimension) using `sips` (macOS) or `convert` (Linux). The original file is never modified. Resize failure is non-fatal — the original resolution is used.

**Design decisions**:
- Core tool (always available) — visual file analysis is useful across all domains.
- Classified as `safe` in guardrails — read-only, no mutation. The temp copy for resize is cleaned up in a `finally` block.
- Zero npm dependencies — uses only platform image tools for optional resize.
- Returns the user's original path in output text (not the resolved absolute path) for clarity.

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

### Module Factory (`src/module-factory.ts`, `src/tools/module-factory.ts`)

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
- Comparisons: `"$prev.status == ok"`, `"$steps[0].count > 0"`, `"$payload.mode != debug"`
- Operators: `==`, `!=`, `>`, `<`, `>=`, `<=` (numeric when both sides parse as numbers, string otherwise)

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

### MCP Server (`src/mcp-server.ts`, `src/modules/mcp-server.ts`)

Expose KOTA's tools via the Model Context Protocol — any MCP-compatible host (Claude Code, Cursor, VS Code, Zed) can connect and use KOTA's tools without a custom integration. Mirrors the client implementation in `mcp-client.ts` but in the server direction.

**Protocol**: JSON-RPC 2.0 over stdio, implementing MCP protocol version `2024-11-05`. Handles `initialize`, `tools/list`, `tools/call`, `ping`, and `shutdown` methods.

**Tool exposure**: All registered KOTA tools (core + module-registered) are exposed by default. The `--tools` flag filters to a specific set. Tool schemas are converted from Anthropic format (`input_schema`) to MCP format (`inputSchema`).

**Tool execution**: `tools/call` routes through the existing `executeTool()` from the tool registry. Results are converted from KOTA's `ToolResult` (text + optional image blocks) to MCP's `CallToolResult` content blocks.

**Module**: The `mcp-server` built-in module registers the `kota mcp-server` CLI command. On startup, it loads config, initializes all modules (to register their tools), then starts the stdio server.

**Usage**:
```bash
# Expose all tools
kota mcp-server

# Expose only specific tools
kota mcp-server --tools file_read,grep,glob,shell
```

**Claude Code integration** (`.claude/settings.local.json`):
```json
{
  "mcpServers": {
    "kota": {
      "command": "node",
      "args": ["dist/cli.js", "mcp-server"]
    }
  }
}
```

**Design decisions**:
- Custom JSON-RPC 2.0 implementation (no `@modelcontextprotocol/sdk` dependency) — consistent with the existing MCP client and KOTA's minimal-dependency philosophy.
- Stdio transport only — local process-spawned integration is the standard for MCP tool servers. HTTP/SSE transport can be added later via the existing HTTP server if needed.
- No guardrails in MCP mode — the MCP host is responsible for its own safety policies. KOTA tools execute directly.
- Tools are exposed read-only from the registry; MCP clients cannot register new tools.

### Guardrails (`src/guardrails.ts`)

Centralized risk classification and policy enforcement for all tool calls. Every tool call is assessed before execution — the policy determines whether to allow, require confirmation, or deny.

**Risk levels**:
- `safe` — Read-only tools (file_read, grep, glob, repo_map, todo, ask_user, web_search, memory, get_secret, enable_tools, files_overview). Also HTTP GET requests.
- `moderate` — File modifications (file_edit, file_write, multi_edit, find_replace), code_exec, web_fetch, delegate, schedule, notebook, HTTP mutations, shell/process with non-destructive commands, unknown/MCP tools.
- `dangerous` — Shell/process with destructive command patterns (rm, git push, sudo, kill, npm publish, etc.), code_exec with system-level operations (os.system, subprocess, shutil.rmtree), file operations targeting paths outside the project directory.

**Policies** (configurable per risk level):
- `allow` — Execute immediately. Default for safe and moderate.
- `confirm` — In interactive mode, prompt the user. In non-interactive mode, deny. Default for dangerous.
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

**Integration**: Guardrails check runs in `executeToolCalls()` in `tool-runner.ts`, before any tool execution. Transport emits `guardrail` events for visibility (logged in CLI verbose mode, always logged for non-allow decisions).

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

1. **Observation masking** (every turn, `src/observation-masking.ts`): Replace ALL old tool outputs beyond a rolling window of 10 messages with compact placeholders. Zero LLM cost — pure string replacement. Based on JetBrains research (NeurIPS 2025, "The Complexity Trap") showing tool outputs are 80%+ of context tokens and masking cuts context ~50% with no performance loss. Idempotent — already-masked results are skipped. Preserves agent reasoning and action history (assistant text + tool_use blocks untouched).
2. **Compaction** (75% budget): Two-phase — deterministic state extraction (files modified, commands run, errors) + LLM narrative summary. Keeps recent 10 messages intact. Now triggers less frequently thanks to masking.
3. **Adaptive truncation**: Tool result size limits shrink as budget fills (50K → 15K → 5K chars).

Split system blocks: static prompt (cached) + dynamic state (uncached, changes per turn).

### Token Budget Awareness

Each turn shows `context: N%`. Above 50%, budget warnings appear in the dynamic system prompt. Tool results auto-truncate based on remaining budget (head + tail with notice).

### Streaming (`src/streaming.ts`)

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

### Page-Level Web Extraction (`src/html-page-extract.ts`)

Enhances `web_fetch` output for HTML pages with three layers of intelligence on top of the base `extractContent()` pipeline:

1. **Content region detection** (`findContentRegion`): Identifies the main content area using semantic HTML (`<article>`, `<main>`, `[role="main"]`) and common CSS patterns (`id="content"`, `.entry-content`, `.post-content`, `.article-content`). Falls back to full page when no region found. Minimum 100 chars threshold to reject empty containers.

2. **Metadata extraction** (`extractMetadata`): Pulls title, description, author, date, and site name from `<head>` meta tags. Supports OpenGraph (`og:title`, `og:description`, `og:site_name`), `article:published_time`, and standard meta tags. OG tags take priority over standard tags.

3. **Class/ID boilerplate removal** (`removeBoilerplateByAttr`): Removes `<div>`/`<section>` elements whose `class` or `id` matches common noise patterns: sidebar, comments, related, social, share, widget, advertisement, cookie, consent, popup, modal, banner, toolbar, newsletter, promo, sponsor.

**Integration**: `web_fetch` calls `extractPage()` instead of `extractContent()` for HTML responses. The result includes a compact metadata header (title, author, date, site name, description) followed by `---` separator and clean Markdown content.

**Design decisions**:
- Separate file from `html-extract.ts` — page-level concerns (metadata, content regions) are distinct from HTML→Markdown conversion.
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

Two modes:
- **`explore`**: Research with read + execution tools (file_read, grep, glob, repo_map, web tools, code_exec, shell, http_request). Max 10 turns.
- **`execute`**: Can modify files and run commands (adds file_edit, file_write, multi_edit, shell@60s). Max 15 turns. Tracks and reports modified files.

Fresh API call per delegation — main context only sees task + final answer. Sub-agent text streams to stderr for live progress visibility. Robustness: prompt caching across turns, tool result truncation (30K cap), circuit breaker on 3 identical failures, and context overflow handling with actionable errors.

**MCP tool integration**: When MCP servers are configured, their tools are automatically available to sub-agents. The `McpManager` is threaded through `DelegateConfig` after MCP initialization. In the delegate loop, tool calls are routed: MCP-namespaced tools (`mcp__*`) go through `McpManager.executeTool()`, built-in tools through the standard runners. This ensures users' external tool servers work consistently across the main loop and delegated tasks.

### Batch Parallel Delegation (`src/tools/batch.ts`)

Scatter-gather orchestrator: takes an array of task descriptions, spawns parallel sub-agents (reusing `runDelegate`), collects all results. Concurrency-limited (default 3, max 5, max 10 tasks). Per-task result budget scales inversely with task count (total 30K). Partial failures don't block other tasks — all results returned with success/error status.

### Sequential Tool Pipe (`src/tools/pipe.ts`)

Inline sequential tool composition — the sequential complement to `batch` (parallel). Chains 2-10 tool invocations with data flow: `$prev` for previous output, `$steps[N]` for any prior step, `$prev.field` for JSON field access, `{{template}}` for inline interpolation. Supports conditional `if` on steps. Stops on first error. Reuses `resolveStepInput`/`evaluateCondition` from module-factory (same semantics as module scripts, but no manifest or persistence needed).

### Parallel Map (`src/tools/map.ts`)

Homogeneous parallel apply — calls `executeTool` directly for each item (no LLM overhead). Complements `batch` (heterogeneous, LLM-powered sub-agents) and `pipe` (sequential chain). Max 50 items, concurrency 5-20. Per-item result budget scales inversely with count (total 30K). Partial failures don't stop other items.

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

### Request-Aware Context Pre-loading (`src/request-analyzer.ts`)

Complements session warmup (which is generic, per-session) with per-request intelligence. When the user sends a message, the analyzer:

1. **Extracts file paths** — regex patterns for relative paths (`./`, `../`), source-directory paths (`src/`, `lib/`, etc.), and standalone filenames with code extensions. Verified on disk with `statSync`.
2. **Extracts search terms** — strips code blocks, URLs, and stop words, then searches the memory store by content keywords (vs session warmup which searches by directory basename only).
3. **Formats a compact context hint** — appended to the user message so the LLM immediately knows which mentioned files exist (with sizes), and has relevant memories without extra tool calls.

Zero LLM cost — pure heuristics and local lookups. Security: all paths resolved relative to cwd, rejects paths outside the working directory.

### Task Router (`src/task-router.ts`)

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

### Scheduler (`src/schedule-parser.ts`, `src/scheduler.ts`, `src/tools/schedule.ts`)

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

### Knowledge Store (`src/knowledge-store.ts`)

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

### Conversation History (`src/history.ts`)

Automatic conversation persistence that lets KOTA resume previous conversations across sessions. Every `AgentSession` auto-saves to `~/.kota/history/` — the agent remembers what you were working on and can pick up where you left off.

**Storage**: Each conversation is stored as `~/.kota/history/<id>.json` with full message history + metadata. An `index.json` file provides fast listing without reading every conversation file.

**ConversationRecord metadata**: id, title (auto-generated from first user message), createdAt, updatedAt, model, messageCount, cwd (project directory), source (`"user"` or `"action"`).

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

**Auto-prune**: Source-aware pruning — user conversations (50 max) and action conversations (20 max) are pruned independently. Autonomous action sessions can never evict user conversations. `ActionExecutor` tags sessions with `historySource: "action"` via `LoopOptions`.

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

### Interactive Code Execution (`src/tools/code-exec.ts`)

Persistent REPL sessions (Python / Node.js) for iterative computation. Wrapper processes use a sentinel-based protocol: code lines are sent via stdin until a sentinel marker, then executed, with a done marker printed to stdout when complete. State (variables, imports) persists across calls within a session. AST-based last-expression extraction (Python) displays return values like IPython. Sessions are managed per-language and cleaned up on agent shutdown.

**Matplotlib auto-capture** (`src/plot-capture.ts`): Python wrapper sets `MPLBACKEND=Agg` and captures open matplotlib figures after each execution (up to 5). Images are saved as temp PNGs, extracted from output via markers, read as base64, and returned as image blocks in the tool result. The agent can see its own charts and iterate on visualizations. Seaborn works automatically (uses matplotlib backend).

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
- Tools with a `group` property follow progressive disclosure (hidden until `enable_tools` is called)
- Ungrouped tools are always available
- Module groups appear in the `enable_tools` description dynamically
- `registerGroup()` supports auto-detect regex patterns for automatic group activation

**Lifecycle**: `discoverPluginModules()` runs during session init. Discovered modules are loaded through `ModuleLoader`, which handles tool registration, dependency ordering, event connections, and cleanup via `unloadAll()`.

### Tool Format Adapters (`src/tool-adapters.ts`)

Plugins don't need to use KOTA's native `ToolDef` format. The adapter layer auto-detects and converts common formats:

**Supported formats**:
- **Native KotaModule**: `{ name, tools: [{ tool, runner }] }` — pass-through
- **Simple**: `{ name, description, parameters, run }` — minimal, one function per tool
- **OpenAI function-calling**: `{ type: "function", function: { name, description, parameters }, run }` — compatible with OpenAI ecosystem tools
- **Vercel AI SDK**: `{ description, parameters, execute }` — compatible with tools created via `tool()` from the Vercel AI SDK. Parameters can be Zod schemas (auto-converted), `jsonSchema()` results, or raw JSON Schema objects. Also detects tool maps: `{ toolName: { execute, parameters }, ... }`
- **Array**: `[simpleTool, openAITool, vercelTool, ...]` — multiple tools from one file, any mix of formats
- **Hybrid KotaModule**: `{ name, tools: [simpleTool, ...], onLoad, onUnload }` — module with lifecycle hooks but simple-format tools

**Zod → JSON Schema conversion**: Vercel AI SDK tools commonly use Zod schemas for parameter validation. The adapter includes a lightweight converter that handles common Zod types (ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray, ZodObject, ZodOptional, ZodDefault, ZodLiteral) without requiring Zod as a dependency. For `jsonSchema()` results from the AI SDK, the embedded JSON Schema is extracted directly.

**Result normalization**: External tool `run`/`execute` functions can return strings, numbers, objects, or `{ content, text }` — all normalized to KOTA's `ToolResult`. Native `{ content: string }` passes through unchanged.

**Programmatic API**: `fromSimple(def)`, `fromOpenAI(def)`, and `fromVercelAI(def, name)` for explicit conversion. `adaptExport(moduleExport, fileName)` for auto-detection (used by `discoverPluginModules()`).

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

**Discovery integration**: `discoverPluginModules()` scans two locations:
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

## Testing

### E2E Tests with Mock Client (`src/mock-client.ts`, `src/e2e.test.ts`)

The mock client enables full agent loop testing without a real API key:

```typescript
import { createMockClient, textResponse, toolUseResponse } from "./mock-client.js";

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
