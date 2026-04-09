# Source Tree

This directory contains KOTA's runtime, workflow, tool, and integration code.

- Keep boundaries explicit and move code into the right domain directory instead of growing ambiguous shared buckets.
- Keep the core small. Protocols, registries, lifecycle, guardrails, and the
  daemon/workflow runtime belong here; general-purpose capabilities should
  prefer `src/modules/` when they can be owned as swappable units.
- Use local `AGENTS.md` files to understand a subtree before changing it.
- If a directory's role changes, update its `AGENTS.md` alongside the code.
- When you add a new root-level `*-cli.ts` file under `src/`, add a matching
  `*-cli.test.ts` unless the command is truly trivial.

## Key Modules

When you add a new file to `src/` or change what an existing module exports or does, update the entry below so the description stays accurate.

- `loop.ts` — `AgentSession` class and `runAgentLoop` convenience wrapper; public API entry point.
- `loop-constructor.ts` — `initAgentSession` function; contains the full constructor body extracted from `AgentSession`.
- `loop-init.ts` — `AgentLoopState` interface, `runInitModules`, `saveToHistoryImpl`, `runClose`.
- `loop-send.ts` — `runSend`; handles prompt dispatch and the agent turn loop.
- `transport.ts` — `AgentEvent` union type, `Transport` interface, `CliTransport` (renders events to stdout/stderr; accepts `verbose` and `showCost` flags), `NullTransport`, `ProxyTransport`, `BufferTransport`; decouples agent I/O from any specific frontend.
- `cost.ts` — `CostTracker` class; accumulates token usage per-model, computes dollar cost, and returns formatted summaries; used by the loop core to track per-turn and session-total cost.
- `dynamic-state.ts` — `registerDynamicStateProvider`, `collectDynamicState`, `resetDynamicStateProviders`; module-level registry for per-turn system-prompt state contributors; modules register via `ctx.registerDynamicStateProvider()`; `loop-send.ts` calls `collectDynamicState()` each turn.
- `model/model-client.ts` — `ModelClient` interface, `ProviderFactoryOptions`, `ResolvedProvider`, and the registry (`registerModelClientFactory`, `createModelClient`); implementations live in the `model-clients` module.
- `modules/model-clients/index.ts` — `KotaModule` that owns `AnthropicModelClient`, `OpenAIModelClient`, and `createModelClientImpl`; registers the factory with the core registry at module load time so `createModelClient` resolves to real implementations at runtime.
- `guardrails.ts` — policy enforcement: `assess`, `resolvePolicy`, config helpers, and exported types.
- `guardrails-classify.ts` — risk classification: tool lists, pattern constants, `classifyRisk`, and `getToolMcpAnnotations` (derives MCP `tools/list` annotation hints from guardrail risk tier).
- `tool-groups.ts` — tool-group activation machinery: `TOOL_GROUPS` (runtime-populated group registry, starts empty), `CORE_TOOL_NAMES`, `enableGroup`, `filterTools`, `registerCustomGroup` (called by module loader and `tools/index.ts` to populate groups at runtime), `deregisterToolsFromGroups` (called on module unload), `detectToolGroups` (auto-detects needed groups from a prompt), `enableToolsTool`/`runEnableTools` (the `enable_tools` agent tool).
- `file-changes.ts` — `ChangeTracker` class and singleton utilities: records original file content before first modification and supports undo within a session.
- `file-diff.ts` — `simpleDiff` utility: line-based diff formatter for agent context display.
- `log-format.ts` — `resolveLogFormatter`: resolves a log line formatter from config or `LOG_FORMAT` env var; supports `"text"` (default) and `"json"` (newline-delimited JSON for aggregators).
- `provider-types.ts` — the four provider interfaces: `MemoryProvider`, `KnowledgeProvider`, `TaskProvider`, `HistoryProvider`.
- `workflow/payload-validator.ts` — `validatePayloadSchema`: minimal JSON Schema validator (type, required, properties, additionalProperties, items) used to validate trigger payloads against a workflow's optional `inputSchema`, completed run outputs against an optional `outputSchema`, and agent step JSON output against an optional per-step `outputSchema`. Type mismatch and missing-required-field errors include the property description when present in the schema.
- `modules/providers/index.ts` — `ProviderRegistry` class, singleton accessors (`initProviderRegistry`, `getProviderRegistry`, `resetProviderRegistry`), `registerDefaultProviders`, and convenience getters (`getMemoryProvider`, `getKnowledgeProvider`, `getTaskProvider`, `getHistoryProvider`); re-exports provider interfaces from `provider-types.ts`.
- `cli-history.ts` — REPL/pipe loop helpers: `interactiveMode`, `runPipeLoop`, `resolveRunContinue`, `parseIntOption`, `resolveConversationId`; re-exports `registerHistoryCommands`.
- `cli-history-commands.ts` — `registerHistoryCommands`: registers all `history` subcommands (list, show, resume, delete, clear) on the CLI program.
- `event-bus-types.ts` — `BusEvents` type catalog, `BusEnvelope`, and `BusEventHandler`; lightweight import path for type-only consumers.
- `event-bus.ts` — `EventBus` class, singleton helpers (`initEventBus`, `getEventBus`, `resetEventBus`, `tryEmit`); re-exports types from `event-bus-types.ts`.
- `modules/notifications/index.ts` — `KotaModule` for the notifications module; re-exports `NotificationGate`, `QuietHoursConfig`, `subscribeModuleCrashAlert`, and related helpers from the module's sub-modules.
- `modules/notifications/module-crash-alert.ts` — `subscribeModuleCrashAlert`: subscribes to `module.restarted` events, tracks restart timestamps in a per-module rolling window, and emits `module.crash.alert` when the threshold is crossed; at most one alert per module per window (cooldown = windowMs). Config via `ModuleCrashAlertOptions`. Owned by the `notifications` module.
- `modules/notifications/notification-gate.ts` — `NotificationGate` class, `QuietHoursConfig` type, `isWithinQuietHours`, `msUntilQuietHoursEnd`, `validateQuietHours`; patches `bus.emit` to hold non-critical channel events (`workflow.attention.digest`, `workflow.budget.*`) during configured quiet hours and releases them as a batched digest when the window ends; critical events (`workflow.failure.alert`, `module.crash.alert`) bypass the gate when `allowCritical` is set (default true). Owned by the `notifications` module.
- `tool-adapter-types.ts` — `SimpleTool`, `OpenAIFunctionTool`, and `VercelAITool` external format types; lightweight import path for consumers that only need types.
- `tool-adapters.ts` — adapter functions (`fromSimple`, `fromOpenAI`, `fromVercelAI`, `adaptExport`) that convert external tool formats to KOTA's `ToolDef`/`KotaModule`; re-exports types from `tool-adapter-types.ts`.
- `init-cli.ts` — `registerInitCommand`, `runInit`: `kota init` command that scaffolds a new KOTA project with config, `data/inbox/`, `data/tasks/`, docs, and `.kota/` runtime dir.
- `tool-runner.ts` — `executeToolCalls`: runs tool blocks in parallel with guardrail assessment, MCP routing, verbose logging, and result truncation; passes conversation messages to capture operator context on queued approvals. `extractApprovalContext`: extracts last N text-bearing turns from messages as a plain string for `PendingApproval.context`. `FailureTracker`: detects identical and diverse consecutive tool failures and triggers circuit-break guidance. `ToolResultEntry` type.
- `modules/approval-queue/queue.ts` — `ApprovalQueue` class and singleton `getApprovalQueue`/`resetApprovalQueue`; file-based store for tool calls awaiting human approval; exports `PendingApproval` type (with `timeoutMs`, `defaultResolution`, `resolutionSource` for expiry, `approvalNote` for optional operator notes, `context` for last few conversation turns captured at enqueue time) and `ApprovalStatus` enum. Owned by the `approval-queue` module.
- `modules/approval-queue/cli.ts` — `registerApprovalCommands`: CLI subcommands for the approval queue (`kota approval list`, `kota approval approve`, `kota approval approve-all`, `kota approval reject`, `kota approval reject-all`, `kota approval count`, `kota approval history`). `approve-all` batch-approves all pending items with optional `--risk` filter, `--note`, and `--yes` bypass. `reject-all` batch-rejects all pending items with optional `--risk` filter, `--reason`, and `--yes` bypass.
- `modules/guardrails-audit/cli.ts` — `registerAuditCommands`: CLI subcommands for the guardrail audit trail (`kota audit list`, with `--risk`, `--policy`, `-n` filters). Owned by the `guardrails-audit` module.
- `modules/repo-tasks/cli.ts` — `registerTaskCommands`: CLI subcommands for the task store (`kota task`). Owned by the `repo-tasks` module.
- `modules/memory/cli.ts` and `modules/knowledge/cli.ts` — `registerMemoryCommands` and `registerKnowledgeCommands`: CLI subcommands for the memory and knowledge stores (`kota memory`, `kota knowledge`). Owned by the respective modules.
- `modules/module-manager/index.ts` — owns the `kota module` CLI surface (`list`, `inspect`, `new`). Uses `ctx.getModuleSummaries()` for live data. Scaffold generators in `modules/module-manager/scaffolds.ts`.
- `module-api.ts` — public re-export surface for module authors; consumed via `kota/module` sub-path import; built to `dist/module-api.js` + `dist/module-api.d.ts`.
- `workflow-testing/index.ts` — `WorkflowTestHarness` class; lightweight in-process harness for unit-testing workflow definitions without a daemon or real agent; exported via `kota/testing` sub-path import through `workflow-testing/testing-api.ts`.
- `module-testing/index.ts` — `ModuleTestHarness` class; lightweight in-process harness for unit-testing `KotaModule` definitions (load, tool call, dynamic state, teardown) without a daemon; exported via `kota/testing` through `workflow-testing/testing-api.ts`.
- `modules/autonomy/workflows/<name>/workflow.ts` — source of truth for each autonomy workflow; may also export a named agent used by that workflow.
- `modules/autonomy/index.ts` — contributes the autonomy workflows and their paired agents by discovering `modules/autonomy/workflows/` at runtime.
- `modules/workflow/index.ts` — `kota workflow` CLI surface.
- `modules/agents/index.ts` — `kota agent` inspection surface for agents contributed by loaded modules.
- `modules/skills/index.ts` — `kota skill list` CLI surface for inspecting registered skills.
- `webhook-cli.ts` — `registerWebhookCommands`: CLI subcommands for managing inbound webhook secrets (`kota webhook list`, `kota webhook secret generate <workflow>`, `kota webhook secret remove <workflow>`).
- `completion-cli.ts` — `registerCompletionCommands`: `kota completion [bash|zsh]` command; introspects the commander program at runtime and generates a shell completion script covering all subcommands and flags; auto-detects shell from `$SHELL` when no argument is given.
- `config-warnings.ts` — `KNOWN_CONFIG_KEYS` set and `warnUnknownConfigKeys(projectDir, warn)`: shared utility that checks `.kota/config.json` for unknown top-level keys and calls `warn` for each one; used by daemon startup, `kota serve`, and `kota config validate`.
- `channel.ts` — `ChannelAdapter`, `ChannelDef`, `ChannelWorkflowStatus`, and `ChannelStartContext` types; defines the channel contribution protocol for modules.
- `foreign-module.ts` — KEMP (KOTA External Module Protocol) core: transport-agnostic types (`KempTransport`, `KempInbound`, `KempOutbound`), config types (`ForeignModuleConfig`, `HttpForeignModuleConfig`), and protocol constants. Entry point for understanding the foreign module protocol.
- `module-loader.ts` — `ModuleLoader` class: registers and lifecycle-manages all in-process modules; handles topo-sorted loading, tool/workflow/channel registration, skill content aggregation, provider activation, and `getModuleSummaries()` (used by `GET /api/modules` and `kota module list`). Load failures are tracked in-memory and included in `getModuleSummaries()` with `loadError` set, so operators can see failed modules alongside loaded ones.
- `foreign-module-loader.ts` — `loadForeignModules`: wraps out-of-process KEMP modules as `KotaModule`; handles init/manifest handshake, proxies tool invocations, manages automatic subprocess restart with exponential backoff and optional ping health checks, and tracks per-module health state (restartCount, lastRestartAt, status: ok/restarting/dead) exposed via `GET /api/modules`.
- `foreign-module-http.ts` — `HttpTransport`: HTTP transport for KEMP; POSTs outbound messages and receives inbound responses; supports optional `Authorization: Bearer` auth.
- `foreign-module-stdio.ts` — `StdioTransport`: stdio transport for KEMP; spawns a subprocess and exchanges NDJSON over stdin/stdout.
- `module-discovery.ts` — `discoverModules`: scans `.kota/modules/<name>/` for user-authored modules; supports manifest-based (`manifest.json`), single-file code (`index.js`/`index.mjs`), and packaged (`package.json` with `main`) variants in a unified discovery path.
- `registry.ts` — `installTool`, `removeTool`, `listTools`, `updateTool`, `loadManifest`, `saveManifest`: manages installed modules tracked in `.kota/tools.json`; delegates per-source install mechanics to `registry-installers.ts`.
- `registry-installers.ts` — `installNpm`, `installUrl`, `installGithub`, `getNpmVersion`, `resolveInstalledPackageName`, `resolveNpmEntry`: per-source-type install mechanics; all installs land under `.kota/modules/<name>/`.
- `repo-tasks.ts` — `getRepoTaskQueueSnapshot`, `REPO_TASK_STATES`, `RepoTaskState`, and `RepoTaskQueueSnapshot`; scans `data/tasks/` plus `data/inbox/` and returns queue counts; used by workflow `inspect-queue` and `inspect-ready-queue` steps.
- `repo-worktree.ts` — `assertRepoWorktreeClean`, `getRepoWorktreeStatus`, `getRepoHeadSha`; validates that the git working tree is clean before a workflow agent step runs; `getRepoHeadSha` returns the current HEAD commit SHA and is used by the builder workflow's intermediate-commit detection gate.
- `task-queue-validation.ts` — `validateTaskQueue`, `assertTaskQueueValid`, `assertTaskQueueRecommendations`, and related queue-policy helpers; structural and policy checks on `data/tasks/`; used by builder, explorer, improver, and inbox-sorter repair-loop gates.
- `workflow-history.ts` — `loadRunsInWindow`, `computeHistoryStats`; reads workflow run metadata from `.kota/runs/` filtered by time window; used by `shared.ts` and dashboard history routes.

## AgentLoopState Cast Pattern

`AgentSession` delegates work to extracted functions via `this as unknown as AgentLoopState`. TypeScript cannot see through this cast, so every private field that an extracted function initializes must carry a `!` definite assignment assertion in the class body (e.g. `private sigintHandler!: () => void`). When adding a new field that an extracted function sets: (1) add it to `AgentLoopState` in `loop-init.ts`, (2) add the `!`-asserted declaration to `AgentSession` in `loop.ts`, (3) initialize it inside the extracted function.
