# Source Tree

This directory contains KOTA's runtime, workflow, tool, and integration code.

- Keep boundaries explicit and move code into the right domain directory instead of growing ambiguous shared buckets.
- Keep the core small. Protocols, registries, lifecycle, guardrails, and the
  daemon/workflow runtime belong here; general-purpose capabilities should
  prefer `src/extensions/` when they can be owned as swappable units.
- Use local `AGENTS.md` files to understand a subtree before changing it.
- If a directory's role changes, update its `AGENTS.md` alongside the code.

## Key Modules

When you add a new file to `src/` or change what an existing module exports or does, update the entry below so the description stays accurate.

- `loop.ts` — `AgentSession` class and `runAgentLoop` convenience wrapper; public API entry point.
- `loop-constructor.ts` — `initAgentSession` function; contains the full constructor body extracted from `AgentSession`.
- `loop-init.ts` — `AgentLoopState` interface, `runInitExtensions`, `saveToHistoryImpl`, `runClose`.
- `loop-send.ts` — `runSend`; handles prompt dispatch and the agent turn loop.
- `transport.ts` — `AgentEvent` union type, `Transport` interface, `CliTransport` (renders events to stdout/stderr; accepts `verbose` and `showCost` flags), `NullTransport`, `ProxyTransport`, `BufferTransport`; decouples agent I/O from any specific frontend.
- `cost.ts` — `CostTracker` class; accumulates token usage per-model, computes dollar cost, and returns formatted summaries; used by the loop core to track per-turn and session-total cost.
- `guardrails.ts` — policy enforcement: `assess`, `resolvePolicy`, config helpers, and exported types.
- `guardrails-classify.ts` — risk classification: tool lists, pattern constants, and `classifyRisk`.
- `guardrails-audit.ts` — persistent audit trail: appends every guardrail assessment to `.kota/audit.jsonl`; provides `appendAuditEntry`, `queryAuditLog`, and `AuditEntry` type; read by `audit-cli.ts`.
- `file-changes.ts` — `ChangeTracker` class and singleton utilities: records original file content before first modification and supports undo within a session.
- `file-diff.ts` — `simpleDiff` utility: line-based diff formatter for agent context display.
- `log-format.ts` — `resolveLogFormatter`: resolves a log line formatter from config or `LOG_FORMAT` env var; supports `"text"` (default) and `"json"` (newline-delimited JSON for aggregators).
- `provider-types.ts` — the four provider interfaces: `MemoryProvider`, `KnowledgeProvider`, `TaskProvider`, `HistoryProvider`.
- `workflow/payload-validator.ts` — `validatePayloadSchema`: minimal JSON Schema validator (type, required, properties, additionalProperties, items) used to validate trigger payloads against a workflow's optional `inputSchema`, completed run outputs against an optional `outputSchema`, and agent step JSON output against an optional per-step `outputSchema`. Type mismatch and missing-required-field errors include the property description when present in the schema.
- `providers.ts` — `ProviderRegistry` class, singleton accessors, and convenience getters; re-exports interfaces from `provider-types.ts`.
- `cli-history.ts` — REPL/pipe loop helpers: `interactiveMode`, `runPipeLoop`, `resolveRunContinue`, `parseIntOption`, `resolveConversationId`; re-exports `registerHistoryCommands`.
- `cli-history-commands.ts` — `registerHistoryCommands`: registers all `history` subcommands (list, show, resume, delete, clear) on the CLI program.
- `event-bus-types.ts` — `BusEvents` type catalog, `BusEnvelope`, and `BusEventHandler`; lightweight import path for type-only consumers.
- `event-bus.ts` — `EventBus` class, singleton helpers (`initEventBus`, `getEventBus`, `resetEventBus`, `tryEmit`); re-exports types from `event-bus-types.ts`.
- `tool-adapter-types.ts` — `SimpleTool`, `OpenAIFunctionTool`, and `VercelAITool` external format types; lightweight import path for consumers that only need types.
- `tool-adapters.ts` — adapter functions (`fromSimple`, `fromOpenAI`, `fromVercelAI`, `adaptExport`) that convert external tool formats to KOTA's `ToolDef`/`KotaExtension`; re-exports types from `tool-adapter-types.ts`.
- `init-cli.ts` — `registerInitCommand`, `runInit`: `kota init` command that scaffolds a new KOTA project with config, task directories, docs, and `.kota/` runtime dir.
- `approval-queue.ts` — `ApprovalQueue` class and singleton `getApprovalQueue`/`resetApprovalQueue`; file-based store for tool calls awaiting human approval; exports `PendingApproval` type (with `timeoutMs`, `defaultResolution`, `resolutionSource` for expiry, `approvalNote` for optional operator notes on approved items) and `ApprovalStatus` enum.
- `approval-cli.ts` — `registerApprovalCommands`: CLI subcommands for the approval queue (`kota approval list`, `kota approval approve`, `kota approval approve-all`, `kota approval reject`, `kota approval reject-all`, `kota approval count`, `kota approval history`). `approve-all` batch-approves all pending items with optional `--risk` filter, `--note`, and `--yes` bypass. `reject-all` batch-rejects all pending items with optional `--risk` filter, `--reason`, and `--yes` bypass.
- `audit-cli.ts` — `registerAuditCommands`: CLI subcommands for the guardrail audit trail (`kota audit list`, with `--risk`, `--policy`, `-n` filters).
- `task-cli.ts` — `registerTaskCommands`: CLI subcommands for the task store (`kota task`).
- `memory-cli.ts` — `registerMemoryCommands` and `registerKnowledgeCommands`: CLI subcommands for the memory and knowledge stores (`kota memory`, `kota knowledge`); exports `parseImportEntries` used by `kota knowledge import`.
- `extension-cli.ts` — `registerExtensionCommands`: CLI subcommands for inspecting loaded extensions (`kota extension list`, `kota extension inspect <name>`, `kota extension new <name>`). `inspect` prints a Health section (status, restart count, last restart) for foreign extensions that have health data.
- `extension-api.ts` — public re-export surface for extension authors; consumed via `kota/extension` sub-path import; built to `dist/extension-api.js` + `dist/extension-api.d.ts`.
- `workflow-testing/index.ts` — `WorkflowTestHarness` class; lightweight in-process harness for unit-testing workflow definitions without a daemon or real agent; exported via `kota/testing` sub-path import through `workflow-testing/testing-api.ts`.
- `workflow-cli.ts` — `registerWorkflowCommands`: entry point that registers all `kota workflow` subcommands (list, stats, export, show, history, definitions, definition-log, cost, logs, follow, trigger, triggers, validate, control, run, gc).
- `agent-cli.ts` — `registerAgentCommands` and `registerSkillCommands`: CLI subcommands for inspecting registered agents and skills (`kota agent list`, `kota agent inspect <name>`, `kota skill list`).
- `session-cli.ts` — `registerSessionCommands`: CLI subcommands for inspecting active sessions (`kota session list`, `kota session inspect <id>`).
- `webhook-cli.ts` — `registerWebhookCommands`: CLI subcommands for managing inbound webhook secrets (`kota webhook list`, `kota webhook secret generate <workflow>`, `kota webhook secret remove <workflow>`).
- `completion-cli.ts` — `registerCompletionCommands`: `kota completion [bash|zsh]` command; introspects the commander program at runtime and generates a shell completion script covering all subcommands and flags; auto-detects shell from `$SHELL` when no argument is given.
- `events-cli.ts` — `registerEventsCommands`: CLI subcommands for the daemon event bus (`kota events tail`, with `--json` and `--filter` options).
- `doctor-cli.ts` — `registerDoctorCommand`, `runDoctorChecks`, `runDoctorFixes`, and `checkProviderConnectivity`: `kota doctor` health check command; verifies daemon connectivity, config validity, extensions, providers, workflow definitions, disk state, and AI provider API reachability. `--fix` flag applies safe automatic repairs; `--skip-connectivity` skips the live provider probe for offline environments.
- `config-cli.ts` — `registerConfigCommands`: `kota config validate` (prints resolved merged config, warns on unknown keys), `kota config get <key>` (dot-notation read from resolved config, exits non-zero if missing), `kota config set <key> <value>` (writes to project-level `.kota/config.json`, JSON-parses values, warns on unrecognised keys), `kota config schema` (prints path to `schema/kota-config.schema.json`; `--print` outputs schema content).
- `channel.ts` — `ChannelAdapter`, `ChannelDef`, `ChannelWorkflowStatus`, and `ChannelStartContext` types; defines the channel contribution protocol for extensions.
- `foreign-extension.ts` — KEMP (KOTA External Module Protocol) core: transport-agnostic types (`KempTransport`, `KempInbound`, `KempOutbound`), config types (`ForeignExtensionConfig`, `HttpForeignExtensionConfig`), and protocol constants. Entry point for understanding the foreign extension protocol.
- `foreign-extension-loader.ts` — `loadForeignExtensions`: wraps out-of-process KEMP modules as `KotaExtension`; handles init/manifest handshake, proxies tool invocations, manages automatic subprocess restart with exponential backoff and optional ping health checks, and tracks per-extension health state (restartCount, lastRestartAt, status: ok/restarting/dead) exposed via `GET /api/extensions`.
- `foreign-extension-http.ts` — `HttpTransport`: HTTP transport for KEMP; POSTs outbound messages and receives inbound responses; supports optional `Authorization: Bearer` auth.
- `foreign-extension-stdio.ts` — `StdioTransport`: stdio transport for KEMP; spawns a subprocess and exchanges NDJSON over stdin/stdout.
- `repo-tasks.ts` — `getRepoTaskQueueSnapshot`, `REPO_TASK_STATES`, `RepoTaskState`, and `RepoTaskQueueSnapshot`; scans `tasks/` directories and returns counts by state; used by workflow `inspect-queue` and `inspect-ready-queue` steps.
- `repo-worktree.ts` — `assertRepoWorktreeClean`, `getRepoWorktreeStatus`; validates that the git working tree is clean before a workflow agent step runs; used by builder and explorer workflows.
- `task-queue-validation.ts` — `validateTaskQueue`, `assertTaskQueueValid`, `assertTaskQueueRecommendations`, `assertNoHighPriorityBacklogStrandedTasks`, `hasHighPriorityBacklogTasks`; structural and policy checks on the `tasks/` directory; used by builder, explorer, and improver repair-loop gates.
- `workflow-history.ts` — `loadRunsInWindow`, `computeHistoryStats`; reads workflow run metadata from `.kota/runs/` filtered by time window; used by `shared.ts` and dashboard history routes.

## AgentLoopState Cast Pattern

`AgentSession` delegates work to extracted functions via `this as unknown as AgentLoopState`. TypeScript cannot see through this cast, so every private field that an extracted function initializes must carry a `!` definite assignment assertion in the class body (e.g. `private sigintHandler!: () => void`). When adding a new field that an extracted function sets: (1) add it to `AgentLoopState` in `loop-init.ts`, (2) add the `!`-asserted declaration to `AgentSession` in `loop.ts`, (3) initialize it inside the extracted function.
