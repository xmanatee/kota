# Source Tree

This directory contains KOTA's runtime, workflow, tool, and integration code.

- Keep boundaries explicit and move code into the right domain directory instead of growing ambiguous shared buckets.
- Keep the core small. Protocols, registries, lifecycle, guardrails, and the
  daemon/workflow runtime belong here; general-purpose capabilities should
  prefer `src/extensions/` when they can be owned as swappable units.
- Use local `AGENTS.md` files to understand a subtree before changing it.
- If a directory's role changes, update its `AGENTS.md` alongside the code.
- When you add a new root-level `*-cli.ts` file under `src/`, add a matching
  `*-cli.test.ts` unless the command is truly trivial.

## Key Modules

When you add a new file to `src/` or change what an existing module exports or does, update the entry below so the description stays accurate.

- `loop.ts` — `AgentSession` class and `runAgentLoop` convenience wrapper; public API entry point.
- `loop-constructor.ts` — `initAgentSession` function; contains the full constructor body extracted from `AgentSession`.
- `loop-init.ts` — `AgentLoopState` interface, `runInitExtensions`, `saveToHistoryImpl`, `runClose`.
- `loop-send.ts` — `runSend`; handles prompt dispatch and the agent turn loop.
- `transport.ts` — `AgentEvent` union type, `Transport` interface, `CliTransport` (renders events to stdout/stderr; accepts `verbose` and `showCost` flags), `NullTransport`, `ProxyTransport`, `BufferTransport`; decouples agent I/O from any specific frontend.
- `cost.ts` — `CostTracker` class; accumulates token usage per-model, computes dollar cost, and returns formatted summaries; used by the loop core to track per-turn and session-total cost.
- `dynamic-state.ts` — `registerDynamicStateProvider`, `collectDynamicState`, `resetDynamicStateProviders`; module-level registry for per-turn system-prompt state contributors; extensions register via `ctx.registerDynamicStateProvider()`; `loop-send.ts` calls `collectDynamicState()` each turn.
- `guardrails.ts` — policy enforcement: `assess`, `resolvePolicy`, config helpers, and exported types.
- `guardrails-classify.ts` — risk classification: tool lists, pattern constants, `classifyRisk`, and `getToolMcpAnnotations` (derives MCP `tools/list` annotation hints from guardrail risk tier).
- `tool-groups.ts` — tool-group activation machinery: `TOOL_GROUPS` (runtime-populated group registry, starts empty), `CORE_TOOL_NAMES`, `enableGroup`, `filterTools`, `registerCustomGroup` (called by extension loader and `tools/index.ts` to populate groups at runtime), `deregisterToolsFromGroups` (called on extension unload), `detectToolGroups` (auto-detects needed groups from a prompt), `enableToolsTool`/`runEnableTools` (the `enable_tools` agent tool).
- `guardrails-audit.ts` — thin re-export shim; state ownership is in `extensions/guardrails-audit/store.ts`. Existing imports from `tools/audit.ts` and `server/audit-routes.ts` continue to work via this shim.
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
- `extension-crash-alert.ts` — `subscribeExtensionCrashAlert`: subscribes to `extension.restarted` events, tracks restart timestamps in a per-extension rolling window, and emits `extension.crash.alert` when the threshold is crossed; at most one alert per extension per window (cooldown = windowMs). Config via `ExtensionCrashAlertOptions`.
- `notification-gate.ts` — `NotificationGate` class, `QuietHoursConfig` type, `isWithinQuietHours`, `msUntilQuietHoursEnd`, `validateQuietHours`; patches `bus.emit` to hold non-critical channel events (`workflow.attention.digest`, `workflow.budget.*`) during configured quiet hours and releases them as a batched digest when the window ends; critical events (`workflow.failure.alert`, `extension.crash.alert`) bypass the gate when `allowCritical` is set (default true).
- `tool-adapter-types.ts` — `SimpleTool`, `OpenAIFunctionTool`, and `VercelAITool` external format types; lightweight import path for consumers that only need types.
- `tool-adapters.ts` — adapter functions (`fromSimple`, `fromOpenAI`, `fromVercelAI`, `adaptExport`) that convert external tool formats to KOTA's `ToolDef`/`KotaExtension`; re-exports types from `tool-adapter-types.ts`.
- `init-cli.ts` — `registerInitCommand`, `runInit`: `kota init` command that scaffolds a new KOTA project with config, task directories, docs, and `.kota/` runtime dir.
- `tool-runner.ts` — `executeToolCalls`: runs tool blocks in parallel with guardrail assessment, MCP routing, verbose logging, and result truncation; passes conversation messages to capture operator context on queued approvals. `extractApprovalContext`: extracts last N text-bearing turns from messages as a plain string for `PendingApproval.context`. `FailureTracker`: detects identical and diverse consecutive tool failures and triggers circuit-break guidance. `ToolResultEntry` type.
- `extensions/approval-queue/queue.ts` — `ApprovalQueue` class and singleton `getApprovalQueue`/`resetApprovalQueue`; file-based store for tool calls awaiting human approval; exports `PendingApproval` type (with `timeoutMs`, `defaultResolution`, `resolutionSource` for expiry, `approvalNote` for optional operator notes, `context` for last few conversation turns captured at enqueue time) and `ApprovalStatus` enum. Owned by the `approval-queue` extension.
- `extensions/approval-queue/cli.ts` — `registerApprovalCommands`: CLI subcommands for the approval queue (`kota approval list`, `kota approval approve`, `kota approval approve-all`, `kota approval reject`, `kota approval reject-all`, `kota approval count`, `kota approval history`). `approve-all` batch-approves all pending items with optional `--risk` filter, `--note`, and `--yes` bypass. `reject-all` batch-rejects all pending items with optional `--risk` filter, `--reason`, and `--yes` bypass.
- `extensions/guardrails-audit/cli.ts` — `registerAuditCommands`: CLI subcommands for the guardrail audit trail (`kota audit list`, with `--risk`, `--policy`, `-n` filters). Owned by the `guardrails-audit` extension.
- `extensions/repo-tasks/cli.ts` — `registerTaskCommands`: CLI subcommands for the task store (`kota task`). Owned by the `repo-tasks` extension.
- `extensions/memory/cli.ts` and `extensions/knowledge/cli.ts` — `registerMemoryCommands` and `registerKnowledgeCommands`: CLI subcommands for the memory and knowledge stores (`kota memory`, `kota knowledge`). Owned by the respective extensions.
- `extensions/extension-manager/index.ts` — owns the `kota extension` CLI surface (`list`, `inspect`, `new`). Registered as a built-in extension; uses `ctx.getExtensionSummaries()` for live data. Scaffold generators in `extensions/extension-manager/scaffolds.ts`.
- `extension-api.ts` — public re-export surface for extension authors; consumed via `kota/extension` sub-path import; built to `dist/extension-api.js` + `dist/extension-api.d.ts`.
- `workflow-testing/index.ts` — `WorkflowTestHarness` class; lightweight in-process harness for unit-testing workflow definitions without a daemon or real agent; exported via `kota/testing` sub-path import through `workflow-testing/testing-api.ts`.
- `extension-testing/index.ts` — `ExtensionTestHarness` class; lightweight in-process harness for unit-testing `KotaExtension` definitions (load, tool call, dynamic state, teardown) without a daemon; exported via `kota/testing` through `workflow-testing/testing-api.ts`.
- `workflow-cli.ts` — `registerWorkflowCommands`: entry point that registers all `kota workflow` subcommands (list, stats, export, show, history, definitions, definition-log, cost, logs, follow, trigger, triggers, validate, control, run, gc, resume-run, retry, replay, prune).
- `extensions/agents/index.ts` — built-in agent definitions (`BUILTIN_AGENTS`), agent registry (`registerAgent`, `getAgent`, `listAgents`), and the `kota agent` CLI surface (`list`, `inspect <name>`). Registered as a built-in extension.
- `extensions/skills/index.ts` — `kota skill list` CLI surface for inspecting registered skills. Registered as a built-in extension.
- `session-cli.ts` — `registerSessionCommands`: CLI subcommands for inspecting active sessions (`kota session list`, `kota session inspect <id>`).
- `webhook-cli.ts` — `registerWebhookCommands`: CLI subcommands for managing inbound webhook secrets (`kota webhook list`, `kota webhook secret generate <workflow>`, `kota webhook secret remove <workflow>`).
- `completion-cli.ts` — `registerCompletionCommands`: `kota completion [bash|zsh]` command; introspects the commander program at runtime and generates a shell completion script covering all subcommands and flags; auto-detects shell from `$SHELL` when no argument is given.
- `events-cli.ts` — `registerEventsCommands`: CLI subcommands for the daemon event bus (`kota events tail`, with `--json` and `--filter` options).
- `doctor-cli.ts` — `registerDoctorCommand`, `runDoctorChecks`, `runDoctorFixes`, and `checkProviderConnectivity`: `kota doctor` health check command; verifies daemon connectivity, config validity, extensions, providers, workflow definitions, disk state, and AI provider API reachability. `--fix` flag applies safe automatic repairs; `--skip-connectivity` skips the live provider probe for offline environments.
- `config-warnings.ts` — `KNOWN_CONFIG_KEYS` set and `warnUnknownConfigKeys(projectDir, warn)`: shared utility that checks `.kota/config.json` for unknown top-level keys and calls `warn` for each one; used by daemon startup, `kota serve`, and `kota config validate`.
- `config-cli.ts` — `registerConfigCommands`: `kota config validate` (prints resolved merged config, warns on unknown keys), `kota config get <key>` (dot-notation read from resolved config, exits non-zero if missing), `kota config set <key> <value>` (writes to project-level `.kota/config.json`, JSON-parses values, warns on unrecognised keys), `kota config schema` (prints path to `schema/kota-config.schema.json`; `--print` outputs schema content).
- `channel.ts` — `ChannelAdapter`, `ChannelDef`, `ChannelWorkflowStatus`, and `ChannelStartContext` types; defines the channel contribution protocol for extensions.
- `foreign-extension.ts` — KEMP (KOTA External Module Protocol) core: transport-agnostic types (`KempTransport`, `KempInbound`, `KempOutbound`), config types (`ForeignExtensionConfig`, `HttpForeignExtensionConfig`), and protocol constants. Entry point for understanding the foreign extension protocol.
- `extension-loader.ts` — `ExtensionLoader` class: registers and lifecycle-manages all in-process extensions; handles topo-sorted loading, tool/workflow/channel registration, skill content aggregation, provider activation, and `getExtensionSummaries()` (used by `GET /api/extensions` and `kota extension list`). Load failures are tracked in-memory and included in `getExtensionSummaries()` with `loadError` set, so operators can see failed extensions alongside loaded ones.
- `foreign-extension-loader.ts` — `loadForeignExtensions`: wraps out-of-process KEMP modules as `KotaExtension`; handles init/manifest handshake, proxies tool invocations, manages automatic subprocess restart with exponential backoff and optional ping health checks, and tracks per-extension health state (restartCount, lastRestartAt, status: ok/restarting/dead) exposed via `GET /api/extensions`.
- `foreign-extension-http.ts` — `HttpTransport`: HTTP transport for KEMP; POSTs outbound messages and receives inbound responses; supports optional `Authorization: Bearer` auth.
- `foreign-extension-stdio.ts` — `StdioTransport`: stdio transport for KEMP; spawns a subprocess and exchanges NDJSON over stdin/stdout.
- `extension-discovery.ts` — `discoverExtensions`: scans `.kota/extensions/<name>/` for user-authored extensions; supports manifest-based (`manifest.json`), single-file code (`index.js`/`index.mjs`), and packaged (`package.json` with `main`) variants in a unified discovery path.
- `registry.ts` — `installTool`, `removeTool`, `listTools`, `updateTool`, `loadManifest`, `saveManifest`: manages installed extensions tracked in `.kota/tools.json`; delegates per-source install mechanics to `registry-installers.ts`.
- `registry-installers.ts` — `installNpm`, `installUrl`, `installGithub`, `getNpmVersion`, `resolveInstalledPackageName`, `resolveNpmEntry`: per-source-type install mechanics; all installs land under `.kota/extensions/<name>/`.
- `repo-tasks.ts` — `getRepoTaskQueueSnapshot`, `REPO_TASK_STATES`, `RepoTaskState`, and `RepoTaskQueueSnapshot`; scans `tasks/` directories and returns counts by state; used by workflow `inspect-queue` and `inspect-ready-queue` steps.
- `repo-worktree.ts` — `assertRepoWorktreeClean`, `getRepoWorktreeStatus`, `getRepoHeadSha`; validates that the git working tree is clean before a workflow agent step runs; `getRepoHeadSha` returns the current HEAD commit SHA and is used by the builder workflow's intermediate-commit detection gate.
- `task-queue-validation.ts` — `validateTaskQueue`, `assertTaskQueueValid`, `assertTaskQueueRecommendations`, `assertNoHighPriorityBacklogStrandedTasks`, `hasHighPriorityBacklogTasks`; structural and policy checks on the `tasks/` directory; used by builder, explorer, and improver repair-loop gates.
- `workflow-history.ts` — `loadRunsInWindow`, `computeHistoryStats`; reads workflow run metadata from `.kota/runs/` filtered by time window; used by `shared.ts` and dashboard history routes.

## AgentLoopState Cast Pattern

`AgentSession` delegates work to extracted functions via `this as unknown as AgentLoopState`. TypeScript cannot see through this cast, so every private field that an extracted function initializes must carry a `!` definite assignment assertion in the class body (e.g. `private sigintHandler!: () => void`). When adding a new field that an extracted function sets: (1) add it to `AgentLoopState` in `loop-init.ts`, (2) add the `!`-asserted declaration to `AgentSession` in `loop.ts`, (3) initialize it inside the extracted function.
