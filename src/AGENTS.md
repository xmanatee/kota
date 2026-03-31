# Source Tree

This directory contains KOTA's runtime, workflow, tool, and integration code.

- Keep boundaries explicit and move code into the right domain directory instead of growing ambiguous shared buckets.
- Use local `AGENTS.md` files to understand a subtree before changing it.
- If a directory's role changes, update its `AGENTS.md` alongside the code.

## Key Modules

- `loop.ts` — `AgentSession` class and `runAgentLoop` convenience wrapper; public API entry point.
- `loop-constructor.ts` — `initAgentSession` function; contains the full constructor body extracted from `AgentSession`.
- `loop-init.ts` — `AgentLoopState` interface, `runInitExtensions`, `saveToHistoryImpl`, `runClose`.
- `loop-send.ts` — `runSend`; handles prompt dispatch and the agent turn loop.
- `guardrails.ts` — policy enforcement: `assess`, `resolvePolicy`, config helpers, and exported types.
- `guardrails-classify.ts` — risk classification: tool lists, pattern constants, and `classifyRisk`.
- `file-changes.ts` — `ChangeTracker` class and singleton utilities: records original file content before first modification and supports undo within a session.
- `file-diff.ts` — `simpleDiff` utility: line-based diff formatter for agent context display.
- `log-format.ts` — `resolveLogFormatter`: resolves a log line formatter from config or `LOG_FORMAT` env var; supports `"text"` (default) and `"json"` (newline-delimited JSON for aggregators).
- `provider-types.ts` — the four provider interfaces: `MemoryProvider`, `KnowledgeProvider`, `TaskProvider`, `HistoryProvider`.
- `providers.ts` — `ProviderRegistry` class, singleton accessors, and convenience getters; re-exports interfaces from `provider-types.ts`.
- `cli-history.ts` — REPL/pipe loop helpers: `interactiveMode`, `runPipeLoop`, `resolveRunContinue`, `parseIntOption`, `resolveConversationId`; re-exports `registerHistoryCommands`.
- `cli-history-commands.ts` — `registerHistoryCommands`: registers all `history` subcommands (list, show, resume, delete, clear) on the CLI program.
- `event-bus-types.ts` — `BusEvents` type catalog, `BusEnvelope`, and `BusEventHandler`; lightweight import path for type-only consumers.
- `event-bus.ts` — `EventBus` class, singleton helpers (`initEventBus`, `getEventBus`, `resetEventBus`, `tryEmit`); re-exports types from `event-bus-types.ts`.
- `tool-adapter-types.ts` — `SimpleTool`, `OpenAIFunctionTool`, and `VercelAITool` external format types; lightweight import path for consumers that only need types.
- `tool-adapters.ts` — adapter functions (`fromSimple`, `fromOpenAI`, `fromVercelAI`, `adaptExport`) that convert external tool formats to KOTA's `ToolDef`/`KotaExtension`; re-exports types from `tool-adapter-types.ts`.
- `init-cli.ts` — `registerInitCommand`, `runInit`: `kota init` command that scaffolds a new KOTA project with config, task directories, docs, and `.kota/` runtime dir.
- `approval-cli.ts` — `registerApprovalCommands`: CLI subcommands for the approval queue (`kota approval`).
- `task-cli.ts` — `registerTaskCommands`: CLI subcommands for the task store (`kota task`).
- `memory-cli.ts` — `registerMemoryCommands` and `registerKnowledgeCommands`: CLI subcommands for the memory and knowledge stores (`kota memory`, `kota knowledge`).
- `extension-cli.ts` — `registerExtensionCommands`: CLI subcommands for inspecting loaded extensions (`kota extension list`, `kota extension inspect <name>`, `kota extension new <name>`).
- `extension-api.ts` — public re-export surface for extension authors; consumed via `kota/extension` sub-path import; built to `dist/extension-api.js` + `dist/extension-api.d.ts`.
- `workflow-cli.ts` — `registerWorkflowCommands`: entry point that registers all `kota workflow` subcommands (list, stats, export, show, history, definitions, cost, logs, follow, trigger, control, run, gc).
- `agent-cli.ts` — `registerAgentCommands` and `registerSkillCommands`: CLI subcommands for inspecting registered agents and skills (`kota agent list`, `kota agent inspect <name>`, `kota skill list`).
- `session-cli.ts` — `registerSessionCommands`: CLI subcommands for inspecting active sessions (`kota session list`, `kota session inspect <id>`).
- `webhook-cli.ts` — `registerWebhookCommands`: CLI subcommands for managing inbound webhook secrets (`kota webhook list`, `kota webhook secret generate <workflow>`, `kota webhook secret remove <workflow>`).
- `doctor-cli.ts` — `registerDoctorCommand` and `runDoctorChecks`: `kota doctor` health check command; verifies daemon connectivity, config validity, extensions, providers, workflow definitions, and disk state.
- `config-cli.ts` — `registerConfigCommands`: `kota config validate` command; prints resolved merged config and warns about unknown top-level keys.
- `channel.ts` — `ChannelAdapter`, `ChannelDef`, `ChannelWorkflowStatus`, and `ChannelStartContext` types; defines the channel contribution protocol for extensions.
- `foreign-extension.ts` — KEMP (KOTA External Module Protocol) core: transport-agnostic types (`KempTransport`, `KempInbound`, `KempOutbound`), config types (`ForeignExtensionConfig`, `HttpForeignExtensionConfig`), and protocol constants. Entry point for understanding the foreign extension protocol.
- `foreign-extension-loader.ts` — `loadForeignExtensions`: wraps out-of-process KEMP modules as `KotaExtension`; handles init/manifest handshake, proxies tool invocations, and manages automatic subprocess restart with exponential backoff and optional ping health checks.
- `foreign-extension-http.ts` — `HttpTransport`: HTTP transport for KEMP; POSTs outbound messages and receives inbound responses; supports optional `Authorization: Bearer` auth.
- `foreign-extension-stdio.ts` — `StdioTransport`: stdio transport for KEMP; spawns a subprocess and exchanges NDJSON over stdin/stdout.

## AgentLoopState Cast Pattern

`AgentSession` delegates work to extracted functions via `this as unknown as AgentLoopState`. TypeScript cannot see through this cast, so every private field that an extracted function initializes must carry a `!` definite assignment assertion in the class body (e.g. `private sigintHandler!: () => void`). When adding a new field that an extracted function sets: (1) add it to `AgentLoopState` in `loop-init.ts`, (2) add the `!`-asserted declaration to `AgentSession` in `loop.ts`, (3) initialize it inside the extracted function.
