# KOTA Verification Baseline and Exhaustive Disposition Manifest

This document establishes the frozen baseline, the single admission model, non-overlapping validation portfolios, and the exhaustive disposition manifest for every test family and large test/support file in the KOTA repository.

---

## 1. Frozen Baseline Summary

The baseline is frozen using the reproducible counting recipe `python3 scripts/count-verification-loc.py`.

- **Total Executable Test Files**: 1,353
- **Total Executable Test LOC**: 334,805
- **Total Authored Test-Support Files**: 298
- **Total Authored Test-Support LOC**: 26,305
- **Exclusions (Generated / Vendored)**:
  - `eval_harness_initial_snapshots`: 196 files, 11,567 LOC
  - `generated_daemon_client_bindings`: 24 files, 2,867 LOC
  - `generated_schemas`: 3 files, 6,438 LOC
  - **Total Exclusions**: 223 files, 20,872 LOC

---

## 2. Verification Admission Model

Every verification mechanism admitted or retained in KOTA must satisfy the 6-dimension admission model:

1. **Consumer**: Who relies on the behavior (e.g., human operator, API client, protocol peer, autonomous agent, runtime kernel).
2. **Production Owner**: The single subsystem or module that owns the domain behavior.
3. **Public Stimulus**: The public API call, CLI command, wire message, or typed event that invokes the behavior.
4. **Observable Oracle**: The observable result, persisted state mutation, emitted event, wire response, or process effect that proves success.
5. **Distinct Failure**: The concrete, distinct defect or regression caught that no existing structural mechanism catches.
6. **Cadence**: The dedicated, non-overlapping validation portfolio that runs the check.

### Alternative Proof Mechanisms

Tests are not the sole proof mechanism. The following architectural mechanisms are primary alternatives:

- **Strict Types**: Eliminates entire classes of null, undefined, invalid variant, and missing field errors at compile time.
- **Schemas & Decoders**: Validates and normalizes untrusted boundary inputs with clear rejection messages.
- **Generators**: Structural cross-language bindings (e.g. Swift/TypeScript clients from daemon routes) eliminate manual transport boilerplate.
- **Registries & Immutability**: Single-point capability and tool registration prevents duplicate or mismatched runtime handlers.
- **Static Inspection**: Biome linting and project references catch architectural violations and module cycle risks.
- **Runtime Probes & Journeys**: Proves real operator experiences and CLI/UI workflows without artificial test mocks.

> **Policy**: When an architectural mechanism (type, schema, generator, or invariant) proves a behavior, **no new test is required**.

---

## 3. Validation Cadence Portfolios

Validation portfolios have **explicit membership and no accidental overlap**:

| Cadence Portfolio | Command | Scope & Membership | Purpose |
| :--- | :--- | :--- | :--- |
| **deterministic fast** | `pnpm check:fast` | `pnpm typecheck && pnpm lint && pnpm validate-tasks` | Typechecking production and test sources, Biome linting, and task queue integrity. |
| **owner behavior** | `pnpm test:owner` | `src/**/*.test.ts` (excluding CLI, eval, integration, protocol, resilience) | Fast, isolated unit and component behavior owned by individual modules or core subsystems. |
| **protocol** | `pnpm test:protocol` | MCP client/server protocol, OAuth endpoint/redirect policy, ACP wire formats | Wire compatibility, framing, JSON-RPC, SSE, OAuth, and external interoperability. |
| **resilience** | `pnpm test:resilience` | `foreign-module-resilient.test.ts`, `module-error-resilience.integration.test.ts` | Process crash/hang recovery, restart limits, and failure isolation. |
| **component integration** | `pnpm test:integration` | `src/**/*.integration.test.ts` (excluding CLI, resilience) | Multi-subsystem integration, SQLite persistence, and runtime host boundaries. |
| **evaluation** | `pnpm test:eval` | `src/modules/eval-harness/**/*.test.ts` | Eval-harness behavior and replay-backed workflow smoke fixtures without live LLM calls. |
| **CLI** | `pnpm test:cli` | `src/cli.test.ts`, `src/module-cli-commands.integration.test.ts` | CLI subcommands, argument parsing, interactive mode, and daemon client execution. |
| **broad confidence / release** | `pnpm check` | Full build + all non-overlapping test partitions | Release validation, CI gates, and high-risk runtime changes. |

---

## 4. Exhaustive Test Family Inventory & Disposition (115 Families)

| # | Family | Production Owner | Cadence | Files | Baseline LOC | Disposition | Rationale / Target Architecture |
| :- | :--- | :--- | :--- | -: | -: | :---: | :--- |
| 1 | `modules/autonomy` | modules: autonomy | owner / integration | 138 | 31,511 | `CONSOLIDATE` | Retain deterministic queue admission, promoter, and critic calibration; consolidate repetitive synthetic run metadata and report snapshots. |
| 2 | `core/workflow` | core: workflow | owner / integration | 110 | 29,990 | `CONSOLIDATE` | Retain essential step execution, retry, pause/resume, and admission invariants; consolidate repetitive foreach/step permutation fixtures. |
| 3 | `src/root-integration` | src/root: cross-cutting integration | integration | 95 | 26,690 | `CONSOLIDATE` | Consolidate multi-subsystem cross-store scenarios into focused behavioral boundary tests; eliminate redundant end-to-end loops. |
| 4 | `modules/eval-harness` | modules: eval-harness | eval | 83 | 16,940 | `CONSOLIDATE` | Retain high-signal smoke fixtures and real-failure replays; prune deterministic test duplicates and synthetic SWE-bench fixtures. |
| 5 | `core/daemon` | core: daemon | owner / integration | 69 | 16,602 | `CONSOLIDATE` | Retain canonical multi-scope registry, SSE event buffer, and daemon lifecycle; consolidate duplicate control route tests. |
| 6 | `core/mcp` | core: mcp | protocol / owner | 13 | 14,988 | `CONSOLIDATE` | Consolidate verbose mock tables and redundant JSON-RPC frame tests into strict schema decoders and lean wire compatibility suites. |
| 7 | `core/tools` | core: tools | owner | 60 | 12,746 | `KEEP` | Retain tool execution runtime, guardrail enforcement, and delegate adapters with minimal overhead. |
| 8 | `modules/telegram` | modules: telegram | owner | 29 | 11,075 | `CONSOLIDATE` | Consolidate polling, bot lifecycle, and inbound message translation; remove duplicate mock session fixtures. |
| 9 | `modules/workflow-ops` | modules: workflow-ops | owner | 33 | 10,636 | `CONSOLIDATE` | Consolidate dry-run, simulation engine, and graph explanation tests; rely on core workflow runtime contracts. |
| 10 | `modules/mcp-server` | modules: mcp-server | protocol / owner | 10 | 8,847 | `CONSOLIDATE` | Consolidate server handler unit tests and streamable HTTP transports; remove redundant manual serialization assertions. |
| 11 | `clients/mobile` | clients/mobile | owner (client) | 37 | 8,615 | `REPLACE` | Replace handwritten model decoders and redundant component tests with generated bindings and shared UI behavior vectors. |
| 12 | `modules/approval-queue` | modules: approval-queue | owner | 37 | 8,444 | `CONSOLIDATE` | Consolidate approval lifecycle state and queue tests with centralized approval service in core. |
| 13 | `core/modules` | core: modules | owner / resilience | 35 | 7,955 | `CONSOLIDATE` | Retain module discovery, dependency resolution, and foreign-module resilience; consolidate redundant fixture loading tests. |
| 14 | `core/loop` | core: loop | owner | 18 | 6,405 | `CONSOLIDATE` | Retain agent session loop, turn lifecycle, and context pipeline; consolidate repetitive token/context tests. |
| 15 | `modules/daemon-ops` | modules: daemon-ops | owner | 31 | 5,724 | `CONSOLIDATE` | Consolidate daemon status and ops commands; prune duplicate CLI output formatting tests. |
| 16 | `modules/execution` | modules: execution | owner | 23 | 5,052 | `KEEP` | Retain sandboxed code and computer execution tool tests. |
| 17 | `modules/harness-parity` | modules: harness-parity | owner / eval | 17 | 4,548 | `KEEP` | Retain cross-preset runtime parity and neutral protocol shape verifications. |
| 18 | `modules/filesystem` | modules: filesystem | owner | 17 | 4,380 | `KEEP` | Retain safe file read/write/edit and workspace restriction tests. |
| 19 | `core/agent-harness` | core: agent-harness | protocol / owner | 29 | 4,302 | `KEEP` | Retain neutral agent harness protocol, SDK types, and registry dispatch. |
| 20 | `modules/web-access` | modules: web-access | owner | 7 | 3,923 | `CONSOLIDATE` | Consolidate outbound HTTP request, web search, and fetch wrappers; enforce shared outbound-http transport. |
| 21 | `modules/model-clients` | modules: model-clients | owner | 18 | 3,555 | `CONSOLIDATE` | Retain provider client implementations and model pricing provider; consolidate mock stream parsing. |
| 22 | `modules/slack-channel` | modules: slack-channel | owner | 19 | 3,357 | `CONSOLIDATE` | Consolidate Slack event adapter and channel routing; eliminate duplicate mock session tests. |
| 23 | `modules/repo-tasks` | modules: repo-tasks | owner | 20 | 3,288 | `CONSOLIDATE` | Consolidate task collection, parsing, and mutation semantics; remove redundant CLI rendering tests. |
| 24 | `modules/history` | modules: history | owner | 10 | 3,158 | `CONSOLIDATE` | Consolidate conversation history store and scope management. |
| 25 | `modules/openai-tools-agent-harness` | modules: openai-tools-agent-harness | owner | 12 | 3,153 | `CONSOLIDATE` | Consolidate OpenAI tool calling loop and scaffolded adapter tests. |
| 26 | `modules/knowledge` | modules: knowledge | owner | 14 | 2,996 | `CONSOLIDATE` | Consolidate structured knowledge store and lifecycle. |
| 27 | `clients/web` | clients/web | owner (client) | 16 | 2,415 | `REPLACE` | Replace manual wire parsing with generated daemon client bindings and shared UI surface tests. |
| 28 | `modules/tracing` | modules: tracing | owner | 7 | 2,320 | `KEEP` | Retain structured tracer and diagnostic event emission tests. |
| 29 | `clients/apple` | clients/apple | owner (client) | 9 | 2,212 | `REPLACE` | Replace manual Swift models with generated daemon client bindings; retain native connection diagnostics. |
| 30 | `modules/answer` | modules: answer | owner | 10 | 2,210 | `CONSOLIDATE` | Consolidate synthesis and cited-answer pipeline tests. |
| 31 | `modules/webhook` | modules: webhook | owner | 9 | 1,829 | `KEEP` | Retain inbound webhook verification and signature check tests. |
| 32 | `modules/composition` | modules: composition | owner | 9 | 1,815 | `KEEP` | Retain multi-module composition and capability provider tests. |
| 33 | `core/config` | core: config | owner | 14 | 1,791 | `KEEP` | Retain config schema, layered loading, and secrets resolution tests. |
| 34 | `core/server` | core: server | owner | 12 | 1,788 | `KEEP` | Retain core HTTP server and middleware tests. |
| 35 | `modules/browser` | modules: browser | owner | 12 | 1,690 | `KEEP` | Retain browser automation and screenshot capture tests. |
| 36 | `modules/google-workspace` | modules: google-workspace | owner | 7 | 1,677 | `KEEP` | Retain Google Workspace integration tool tests. |
| 37 | `core/manifest` | core: manifest | owner | 6 | 1,636 | `KEEP` | Retain module manifest parser and factory tests. |
| 38 | `modules/gemini-agent-harness` | modules: gemini-agent-harness | owner | 9 | 1,624 | `KEEP` | Retain Gemini SDK harness adapter tests. |
| 39 | `core/model` | core: model | owner | 7 | 1,585 | `KEEP` | Retain model registry, routing, and pricing dispatch tests. |
| 40 | `modules/a2a-channel` | modules: a2a-channel | owner | 9 | 1,585 | `KEEP` | Retain agent-to-agent channel protocol tests. |
| 41 | `modules/agent-client-protocol` | modules: agent-client-protocol | protocol | 3 | 1,566 | `KEEP` | Retain ACP wire protocol and SSE transport tests. |
| 42 | `modules/recall` | modules: recall | owner | 10 | 1,563 | `CONSOLIDATE` | Consolidate recall provider and query resolution tests. |
| 43 | `modules/architect` | modules: architect | owner | 5 | 1,526 | `KEEP` | Retain architectural analysis and codebase map generation tests. |
| 44 | `modules/memory` | modules: memory | owner | 7 | 1,468 | `CONSOLIDATE` | Consolidate agent memory store and lifecycle tests. |
| 45 | `core/events` | core: events | owner | 5 | 1,385 | `KEEP` | Retain event bus, scoped event definitions, and event journal tests. |
| 46 | `modules/codex-agent-harness` | modules: codex-agent-harness | owner | 7 | 1,372 | `KEEP` | Retain Codex CLI harness adapter tests. |
| 47 | `modules/retract` | modules: retract | owner | 7 | 1,372 | `CONSOLIDATE` | Consolidate memory/knowledge retraction pipeline tests. |
| 48 | `modules/gemini-cli-agent-harness` | modules: gemini-cli-agent-harness | owner | 5 | 1,355 | `KEEP` | Retain Gemini CLI harness adapter tests. |
| 49 | `modules/capture` | modules: capture | owner | 7 | 1,352 | `CONSOLIDATE` | Consolidate knowledge capture pipeline tests. |
| 50 | `modules/system` | modules: system | owner | 5 | 1,334 | `KEEP` | Retain system information tools and environment probes. |
| 51 | `modules/doctor` | modules: doctor | owner | 4 | 1,273 | `KEEP` | Retain diagnostic and health check tests. |
| 52 | `modules/owner-questions` | modules: owner-questions | owner | 5 | 1,265 | `CONSOLIDATE` | Consolidate owner question queue and resolution tests. |
| 53 | `modules/voice` | modules: voice | owner | 5 | 1,183 | `KEEP` | Retain voice synthesis and transcription interface tests. |
| 54 | `modules/setup` | modules: setup | owner | 4 | 1,144 | `KEEP` | Retain setup requirements and interactive wizard tests. |
| 55 | `modules/git` | modules: git | owner | 5 | 1,086 | `KEEP` | Retain Git tool operations and sandbox restriction tests. |
| 56 | `modules/vercel-agent-harness` | modules: vercel-agent-harness | owner | 7 | 1,056 | `KEEP` | Retain Vercel AI SDK harness adapter tests. |
| 57 | `modules/claude-agent-harness` | modules: claude-agent-harness | owner | 4 | 1,043 | `KEEP` | Retain Claude Agent SDK harness adapter tests. |
| 58 | `modules/resource-discovery` | modules: resource-discovery | owner | 6 | 1,033 | `KEEP` | Retain resource discovery provider tests. |
| 59 | `modules/config` | modules: config | owner | 4 | 1,026 | `KEEP` | Retain module-level config resolution tests. |
| 60 | `modules/github` | modules: github | owner | 2 | 1,006 | `KEEP` | Retain GitHub API client and issue operations. |
| 61 | `modules/module-manager` | modules: module-manager | owner | 4 | 942 | `KEEP` | Retain module installation and management tests. |
| 62 | `modules/linear` | modules: linear | owner | 2 | 930 | `KEEP` | Retain Linear integration tests. |
| 63 | `modules/antigravity-cli-agent-harness` | modules: antigravity-cli-agent-harness | owner | 9 | 883 | `KEEP` | Retain Antigravity CLI adapter tests. |
| 64 | `modules/github-webhook` | modules: github-webhook | owner | 1 | 875 | `KEEP` | Retain GitHub webhook parsing and signature validation. |
| 65 | `modules/skill-ops` | modules: skill-ops | owner | 4 | 875 | `KEEP` | Retain skill operations and lifecycle tests. |
| 66 | `modules/secrets` | modules: secrets | owner | 4 | 863 | `KEEP` | Retain secret store and resolution tests. |
| 67 | `modules/inbound-signals` | modules: inbound-signals | owner | 1 | 815 | `KEEP` | Retain signal ingestion and event emission tests. |
| 68 | `core/outbound-http` | core: outbound-http | owner | 4 | 778 | `KEEP` | Retain outbound HTTP transport, trust profiles, and redirection policy tests. |
| 69 | `modules/agent-ops` | modules: agent-ops | owner | 4 | 776 | `KEEP` | Retain agent operations and status reporting tests. |
| 70 | `core/util` | core: util | owner | 8 | 744 | `KEEP` | Retain shared string, path, and async utilities tests. |
| 71 | `modules/push-notification` | modules: push-notification | owner | 3 | 730 | `KEEP` | Retain push notification provider tests. |
| 72 | `modules/rendering` | modules: rendering | owner | 4 | 684 | `KEEP` | Retain UI rendering and terminal formatting tests. |
| 73 | `modules/guardrails-audit` | modules: guardrails-audit | owner | 4 | 683 | `KEEP` | Retain guardrail audit and policy enforcement tests. |
| 74 | `modules/webhook-channel` | modules: webhook-channel | owner | 3 | 671 | `KEEP` | Retain webhook channel adapter tests. |
| 75 | `modules/commands` | modules: commands | owner | 2 | 616 | `KEEP` | Retain slash command catalog and registration tests. |
| 76 | `modules/mcp-registry` | modules: mcp-registry | owner | 3 | 594 | `KEEP` | Retain MCP registry discovery and configuration tests. |
| 77 | `modules/web` | modules: web | owner | 4 | 569 | `KEEP` | Retain web browsing and scraping tool tests. |
| 78 | `modules/cli` | modules: cli | cli | 4 | 558 | `KEEP` | Retain CLI terminal interface tests. |
| 79 | `modules/sqlite-memory` | modules: sqlite-memory | owner | 2 | 537 | `KEEP` | Retain SQLite memory persistence tests. |
| 80 | `modules/social` | modules: social | owner | 2 | 529 | `KEEP` | Retain social media integration tool tests. |
| 81 | `modules/working-memory` | modules: working-memory | owner | 2 | 515 | `KEEP` | Retain working memory scratchpad tests. |
| 82 | `modules/injection-defense` | modules: injection-defense | owner | 3 | 496 | `KEEP` | Retain prompt injection defense and payload screening tests. |
| 83 | `modules/channel-opportunity-reference` | modules: channel-opportunity-reference | owner | 1 | 486 | `KEEP` | Retain channel reference specification tests. |
| 84 | `modules/prompt-templates` | modules: prompt-templates | owner | 2 | 474 | `KEEP` | Retain prompt template rendering tests. |
| 85 | `modules/scheduler` | modules: scheduler | owner | 4 | 470 | `KEEP` | Retain scheduler persistence and timer tests. |
| 86 | `modules/jira` | modules: jira | owner | 1 | 464 | `KEEP` | Retain Jira integration tool tests. |
| 87 | `modules/read-document` | modules: read-document | owner | 2 | 410 | `KEEP` | Retain document parsing and extraction tests. |
| 88 | `modules/history-semantic` | modules: history-semantic | owner | 1 | 366 | `KEEP` | Retain semantic history search tests. |
| 89 | `modules/vercel-adapter` | modules: vercel-adapter | owner | 2 | 362 | `KEEP` | Retain Vercel deployment adapter tests. |
| 90 | `modules/transcription-whisper` | modules: transcription-whisper | owner | 2 | 354 | `KEEP` | Retain Whisper audio transcription tests. |
| 91 | `modules/memory-semantic` | modules: memory-semantic | owner | 2 | 342 | `KEEP` | Retain semantic memory vector search tests. |
| 92 | `modules/semantic-index` | modules: semantic-index | owner | 3 | 319 | `KEEP` | Retain semantic index persistence and lifecycle tests. |
| 93 | `modules/tool-retry` | modules: tool-retry | owner | 2 | 315 | `KEEP` | Retain tool retry middleware tests. |
| 94 | `core/evidence` | core: evidence | owner | 2 | 311 | `KEEP` | Retain evidence retention and redaction policy tests. |
| 95 | `modules/notebook` | modules: notebook | owner | 1 | 303 | `KEEP` | Retain Jupyter notebook execution tests. |
| 96 | `modules/tasks-semantic` | modules: tasks-semantic | owner | 1 | 299 | `KEEP` | Retain semantic task search tests. |
| 97 | `modules/slack` | modules: slack | owner | 1 | 296 | `KEEP` | Retain Slack API client tests. |
| 98 | `modules/email` | modules: email | owner | 2 | 288 | `KEEP` | Retain email transport and notification tests. |
| 99 | `modules/tool-cache` | modules: tool-cache | owner | 1 | 279 | `KEEP` | Retain tool result cache tests. |
| 100 | `modules/knowledge-semantic` | modules: knowledge-semantic | owner | 1 | 276 | `KEEP` | Retain semantic knowledge search tests. |
| 101 | `core/agents` | core: agents | owner | 1 | 273 | `KEEP` | Retain core agent definition and delegation prompt tests. |
| 102 | `modules/thin-agent-harness` | modules: thin-agent-harness | owner | 2 | 256 | `KEEP` | Retain thin agent harness adapter tests. |
| 103 | `core/execution` | core: execution | owner | 1 | 217 | `KEEP` | Retain execution protocol tests. |
| 104 | `modules/init` | modules: init | owner | 1 | 184 | `CONSOLIDATE` | Consolidate legacy init with scope onboarding. |
| 105 | `modules/owner-decisions` | modules: owner-decisions | owner | 3 | 179 | `KEEP` | Retain owner decision store and CLI tests. |
| 106 | `modules/notification` | modules: notification | owner | 1 | 165 | `KEEP` | Retain notification hub provider tests. |
| 107 | `core/prompt-input` | core: prompt-input | owner | 1 | 135 | `KEEP` | Retain prompt input @-reference expansion tests. |
| 108 | `modules/repo-ai-checks` | modules: repo-ai-checks | owner | 1 | 135 | `KEEP` | Retain repo AI checks workflow tests. |
| 109 | `modules/voice-whisper-local` | modules: voice-whisper-local | owner | 1 | 132 | `KEEP` | Retain local Whisper speech-to-text tests. |
| 110 | `core/file-tracking` | core: file-tracking | owner | 1 | 117 | `KEEP` | Retain file change tracking tests. |
| 111 | `modules/completion` | modules: completion | owner | 1 | 110 | `KEEP` | Retain shell completion generator tests. |
| 112 | `modules/voice-openai-tts` | modules: voice-openai-tts | owner | 1 | 98 | `KEEP` | Retain OpenAI TTS speech synthesis tests. |
| 113 | `core/channels` | core: channels | owner | 1 | 97 | `KEEP` | Retain core channel protocol types tests. |
| 114 | `modules/transcription` | modules: transcription | owner | 1 | 95 | `KEEP` | Retain base transcription provider tests. |
| 115 | `modules/registry` | modules: registry | owner | 1 | 70 | `KEEP` | Retain module registry discovery tests. |

---

## 5. Exhaustive Large Test and Support File Disposition (91 Files > 500 LOC)

### Large Executable Test Files (89 Files)

| # | File Path | Production Owner | Cadence | Baseline LOC | Disposition | Rationale / Target Architecture |
| :- | :--- | :--- | :--- | -: | -: | :--- |
| 1 | `src/core/mcp/client.test.ts` | core: mcp | protocol | 8,386 | `CONSOLIDATE` | Consolidate 8.3k LOC suite by replacing duplicate serialization & timeout permutations with strict MCP protocol schema tests. |
| 2 | `src/modules/mcp-server/server.test.ts` | modules: mcp-server | protocol | 6,338 | `CONSOLIDATE` | Consolidate 6.3k LOC suite by standardizing JSON-RPC method dispatch and eliminating redundant capability matrices. |
| 3 | `src/core/mcp/manager.test.ts` | core: mcp | owner | 4,609 | `CONSOLIDATE` | Consolidate 4.6k LOC manager suite by testing lifecycle and tool aggregation through canonical manager interfaces. |
| 4 | `src/modules/telegram/status-poll.test.ts` | modules: telegram | owner | 2,935 | `CONSOLIDATE` | Consolidate 2.9k LOC status poll test by replacing mock timer matrices with focused polling state tests. |
| 5 | `src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` | modules: autonomy | owner | 2,887 | `CONSOLIDATE` | Consolidate 2.8k LOC progress reviewer workflow test by pruning redundant synthetic evidence permutations. |
| 6 | `src/workflow-validation.integration.test.ts` | src/root: workflow validation | integration | 2,455 | `CONSOLIDATE` | Consolidate 2.4k LOC validation suite into focused validator error tests and pure schema checks. |
| 7 | `src/core/daemon/daemon-control.test.ts` | core: daemon | owner | 2,219 | `CONSOLIDATE` | Consolidate 2.2k LOC daemon control test by grouping route verifications under standard endpoint decoders. |
| 8 | `src/core/modules/module-loader.test.ts` | core: modules | owner | 1,977 | `CONSOLIDATE` | Consolidate 1.9k LOC module loader test by focusing on load ordering, cycle rejection, and lifecycle hooks. |
| 9 | `src/modules/telegram/bot.test.ts` | modules: telegram | owner | 1,814 | `CONSOLIDATE` | Consolidate 1.8k LOC bot suite by testing message handling without redundant session store mocks. |
| 10 | `src/modules/agent-client-protocol/index.test.ts` | modules: agent-client-protocol | protocol | 1,440 | `KEEP` | Retain 1.4k LOC ACP protocol contract tests as canonical protocol reference. |
| 11 | `src/modules/workflow-ops/routes/workflow-routes.test.ts` | modules: workflow-ops | owner | 1,436 | `CONSOLIDATE` | Consolidate 1.4k LOC route tests by using shared route decoders. |
| 12 | `src/modules/harness-parity/scenario.test.ts` | modules: harness-parity | owner | 1,343 | `KEEP` | Retain 1.3k LOC harness parity scenario tests as core neutral adapter proof. |
| 13 | `src/core/workflow/steps/step-executor-foreach.test.ts` | core: workflow | owner | 1,305 | `CONSOLIDATE` | Consolidate 1.3k LOC foreach step test by testing iteration and error handling on representative small collections. |
| 14 | `src/core/workflow/run-executor.test.ts` | core: workflow | owner | 1,235 | `CONSOLIDATE` | Consolidate 1.2k LOC run executor test by focusing on phase progression and error propagation. |
| 15 | `src/modules/web-access/http-request.test.ts` | modules: web-access | owner | 1,225 | `CONSOLIDATE` | Consolidate 1.2k LOC HTTP request tests by delegating trust profile and retry tests to core outbound-http. |
| 16 | `src/modules/workflow-ops/execution/trial.test.ts` | modules: workflow-ops | owner | 1,214 | `CONSOLIDATE` | Consolidate 1.2k LOC trial execution suite into shared simulation engine verifications. |
| 17 | `src/core/workflow/run-state-database.test.ts` | core: workflow | owner | 1,174 | `KEEP` | Retain 1.1k LOC SQLite database migration and transaction tests as authoritative operational store proof. |
| 18 | `src/modules/mcp-server/streamable-http.test.ts` | modules: mcp-server | protocol | 1,122 | `CONSOLIDATE` | Consolidate 1.1k LOC streamable HTTP test by testing SSE framing and session teardown directly. |
| 19 | `src/workflow-step-executor-agent.integration.test.ts` | src/root: workflow integration | integration | 1,113 | `CONSOLIDATE` | Consolidate 1.1k LOC agent step integration test into focused step executor tests. |
| 20 | `src/core/tools/tool-adapters.test.ts` | core: tools | owner | 1,055 | `KEEP` | Retain 1.0k LOC tool adapter schema wrapping and execution tests. |
| 21 | `src/modules/autonomy/evaluator-calibration.test.ts` | modules: autonomy | owner | 1,039 | `KEEP` | Retain 1.0k LOC evaluator calibration window and contradiction detection tests. |
| 22 | `src/modules/openai-tools-agent-harness/adapter.test.ts` | modules: openai-tools-agent-harness | owner | 1,034 | `KEEP` | Retain 1.0k LOC OpenAI tools harness adapter and streaming tests. |
| 23 | `src/core/daemon/daemon-chat.integration.test.ts` | core: daemon | integration | 961 | `CONSOLIDATE` | Consolidate 961 LOC daemon chat integration test with standard session host tests. |
| 24 | `src/modules/eval-harness/memory-lifecycle-aging.test.ts` | modules: eval-harness | eval | 945 | `CONSOLIDATE` | Consolidate 945 LOC memory aging eval test by pruning synthetic decay cycles. |
| 25 | `src/modules/doctor/doctor.test.ts` | modules: doctor | owner | 894 | `KEEP` | Retain 894 LOC doctor diagnostic health check suite. |
| 26 | `src/modules/github-webhook/github-webhook.test.ts` | modules: github-webhook | owner | 875 | `KEEP` | Retain 875 LOC GitHub webhook signature and event parsing tests. |
| 27 | `src/modules/workflow-ops/daemon-client.test.ts` | modules: workflow-ops | owner | 861 | `CONSOLIDATE` | Consolidate 861 LOC daemon client test into shared generated client bindings. |
| 28 | `src/modules/autonomy/run-outcome-aggregation.test.ts` | modules: autonomy | owner | 853 | `CONSOLIDATE` | Consolidate 853 LOC outcome aggregation test by testing aggregation logic without huge mock arrays. |
| 29 | `src/modules/architect/architect.test.ts` | modules: architect | owner | 842 | `KEEP` | Retain 842 LOC architecture map extraction tests. |
| 30 | `src/modules/workflow-ops/execution/dry-run.test.ts` | modules: workflow-ops | owner | 820 | `CONSOLIDATE` | Consolidate 820 LOC dry-run execution tests into engine validation suite. |
| 31 | `src/modules/inbound-signals/inbound-signals.test.ts` | modules: inbound-signals | owner | 815 | `KEEP` | Retain 815 LOC inbound signal ingestion and batching tests. |
| 32 | `src/modules/eval-harness/proactive-cross-session-intent-resolution.test.ts` | modules: eval-harness | eval | 810 | `CONSOLIDATE` | Consolidate 810 LOC cross-session eval into focused smoke replay. |
| 33 | `src/modules/model-clients/openai-model-client.test.ts` | modules: model-clients | owner | 806 | `KEEP` | Retain 806 LOC OpenAI model client transport and error mapping tests. |
| 34 | `src/core/workflow/event-batches.test.ts` | core: workflow | owner | 802 | `KEEP` | Retain 802 LOC event batching and debounce lifecycle tests. |
| 35 | `src/modules/web-access/web-fetch.test.ts` | modules: web-access | owner | 794 | `CONSOLIDATE` | Consolidate 794 LOC fetch wrapper into outbound-http core client. |
| 36 | `src/core/workflow/run-coordinator.test.ts` | core: workflow | owner | 786 | `KEEP` | Retain 786 LOC run coordinator concurrency and capacity gating tests. |
| 37 | `src/core/modules/registry.test.ts` | core: modules | owner | 738 | `KEEP` | Retain 738 LOC module registry and capability provider resolution tests. |
| 38 | `src/core/loop/loop.test.ts` | core: loop | owner | 734 | `KEEP` | Retain 734 LOC agent turn loop and streaming lifecycle tests. |
| 39 | `src/modules/autonomy/workflows/blocked-promoter/workflow.test.ts` | modules: autonomy | owner | 733 | `KEEP` | Retain 733 LOC blocked task promotion and dependency resolution tests. |
| 40 | `src/modules/workflow-ops/simulation/engine.test.ts` | modules: workflow-ops | owner | 732 | `CONSOLIDATE` | Consolidate 732 LOC simulation engine tests into core workflow simulator. |
| 41 | `src/modules/filesystem/file-read.test.ts` | modules: filesystem | owner | 730 | `KEEP` | Retain 730 LOC safe file reading and size restriction tests. |
| 42 | `src/conversational-agent-tools.integration.test.ts` | src/root: conversational integration | integration | 714 | `CONSOLIDATE` | Consolidate 714 LOC conversational tools test into component tool loop tests. |
| 43 | `src/modules/tracing/tracer.test.ts` | modules: tracing | owner | 713 | `KEEP` | Retain 713 LOC structured tracer and span recording tests. |
| 44 | `src/modules/repo-tasks/cli.test.ts` | modules: repo-tasks | owner | 707 | `CONSOLIDATE` | Consolidate 707 LOC tasks CLI test into core task collection tests. |
| 45 | `src/modules/history/cli.test.ts` | modules: history | owner | 707 | `CONSOLIDATE` | Consolidate 707 LOC history CLI test into history store tests. |
| 46 | `src/modules/autonomy/report/aggregate.test.ts` | modules: autonomy | owner | 696 | `CONSOLIDATE` | Consolidate 696 LOC report aggregation tests by simplifying metric calculations. |
| 47 | `src/core/workflow/dead-letter-queue.test.ts` | core: workflow | owner | 689 | `KEEP` | Retain 689 LOC dead letter queue retention and retry tests. |
| 48 | `src/modules/eval-harness/predicates.test.ts` | modules: eval-harness | eval | 689 | `KEEP` | Retain 689 LOC eval harness predicate matching tests. |
| 49 | `src/core/loop/context.test.ts` | core: loop | owner | 684 | `KEEP` | Retain 684 LOC context window assembly and truncation tests. |
| 50 | `src/core/daemon/scheduler.test.ts` | core: daemon | owner | 672 | `KEEP` | Retain 672 LOC daemon task scheduler and cron trigger tests. |
| 51 | `src/modules/gemini-cli-agent-harness/adapter.test.ts` | modules: gemini-cli-agent-harness | owner | 669 | `KEEP` | Retain 669 LOC Gemini CLI adapter tests. |
| 52 | `src/modules/execution/computer-use.test.ts` | modules: execution | owner | 655 | `KEEP` | Retain 655 LOC computer use action execution tests. |
| 53 | `src/modules/telegram/inbound-signal.test.ts` | modules: telegram | owner | 652 | `CONSOLIDATE` | Consolidate 652 LOC inbound signal mapping into telegram bot handler. |
| 54 | `src/modules/workflow-ops/graph/explain.test.ts` | modules: workflow-ops | owner | 644 | `CONSOLIDATE` | Consolidate 644 LOC graph explanation tests into step validator suite. |
| 55 | `src/core/workflow/integration-queue.test.ts` | core: workflow | owner | 639 | `KEEP` | Retain 639 LOC integration queue writer serialization and rebase tests. |
| 56 | `src/core/loop/context-pipeline.test.ts` | core: loop | owner | 633 | `KEEP` | Retain 633 LOC context pipeline middleware tests. |
| 57 | `src/modules/codex-agent-harness/adapter.test.ts` | modules: codex-agent-harness | owner | 628 | `KEEP` | Retain 628 LOC Codex harness adapter execution tests. |
| 58 | `src/core/loop/verify-tracker.test.ts` | core: loop | owner | 623 | `KEEP` | Retain 623 LOC turn verification tracker tests. |
| 59 | `src/workflow-run-executor-parallel.integration.test.ts` | src/root: workflow integration | integration | 615 | `CONSOLIDATE` | Consolidate 615 LOC parallel execution integration test into run executor tests. |
| 60 | `src/modules/knowledge/store.test.ts` | modules: knowledge | owner | 614 | `KEEP` | Retain 614 LOC knowledge store persistence and search tests. |
| 61 | `src/core/tools/guardrails.test.ts` | core: tools | owner | 608 | `KEEP` | Retain 608 LOC tool guardrail risk classification tests. |
| 62 | `src/delegate-tool.integration.test.ts` | src/root: tool integration | integration | 607 | `CONSOLIDATE` | Consolidate 607 LOC delegate integration test into core delegation tests. |
| 63 | `src/core/workflow/repair-loop.test.ts` | core: workflow | owner | 602 | `KEEP` | Retain 602 LOC workflow repair loop and check evaluation tests. |
| 64 | `src/modules/autonomy/workflows/explorer/watchlist.test.ts` | modules: autonomy | owner | 593 | `KEEP` | Retain 593 LOC explorer watchlist tracking and source cooldown tests. |
| 65 | `src/cli.test.ts` | src/root: cli | cli | 591 | `KEEP` | Retain 591 LOC CLI top-level argument and subcommand parsing tests. |
| 66 | `src/modules/daemon-ops/status-cli.test.ts` | modules: daemon-ops | owner | 591 | `CONSOLIDATE` | Consolidate 591 LOC status CLI test into daemon status route tests. |
| 67 | `src/modules/eval-harness/interference-heavy-recall.test.ts` | modules: eval-harness | eval | 578 | `CONSOLIDATE` | Consolidate 578 LOC recall eval into focused smoke replay. |
| 68 | `src/modules/autonomy/workflows/attention-digest/step.test.ts` | modules: autonomy | owner | 573 | `KEEP` | Retain 573 LOC attention digest aggregation tests. |
| 69 | `src/modules/setup/index.test.ts` | modules: setup | owner | 572 | `KEEP` | Retain 572 LOC setup wizard requirement satisfaction tests. |
| 70 | `src/e2e.test.ts` | src/root: e2e | integration | 566 | `CONSOLIDATE` | Consolidate 566 LOC broad e2e test into focused product journey tests. |
| 71 | `src/modules/filesystem/file-edit.test.ts` | modules: filesystem | owner | 566 | `KEEP` | Retain 566 LOC file patch and replace tests. |
| 72 | `src/modules/github/github.test.ts` | modules: github | owner | 566 | `KEEP` | Retain 566 LOC GitHub integration operations. |
| 73 | `src/modules/web-access/web-search.test.ts` | modules: web-access | owner | 561 | `KEEP` | Retain 561 LOC web search provider tests. |
| 74 | `src/init.test.ts` | src/root: init | owner | 554 | `CONSOLIDATE` | Consolidate 554 LOC init test with scope onboarding suite. |
| 75 | `src/modules/autonomy/workflows/github-mention-intake/workflow.test.ts` | modules: autonomy | owner | 554 | `KEEP` | Retain 554 LOC GitHub mention intake workflow tests. |
| 76 | `src/modules/autonomy/workflows/dispatcher/workflow.test.ts` | modules: autonomy | owner | 553 | `KEEP` | Retain 553 LOC dispatcher queue-shape event emission tests. |
| 77 | `clients/mobile/src/__tests__/CaptureScreen.test.tsx` | clients/mobile | owner (client) | 549 | `REPLACE` | Replace 549 LOC CaptureScreen component test with shared UI behavior vectors. |
| 78 | `src/modules/execution/code-exec.test.ts` | modules: execution | owner | 547 | `KEEP` | Retain 547 LOC code execution sandbox tests. |
| 79 | `src/core/manifest/module-factory.test.ts` | core: manifest | owner | 545 | `KEEP` | Retain 545 LOC module factory instantiation tests. |
| 80 | `src/core/daemon/daemon-multi-scope-isolation.test.ts` | core: daemon | owner | 545 | `KEEP` | Retain 545 LOC multi-scope directory isolation tests. |
| 81 | `src/core/events/event-journal.test.ts` | core: events | owner | 540 | `KEEP` | Retain 540 LOC event journal persistence and replay tests. |
| 82 | `src/core/workflow/runtime-dispatch.test.ts` | core: workflow | owner | 536 | `KEEP` | Retain 536 LOC workflow dispatch routing tests. |
| 83 | `src/capture-answer-pipeline.integration.test.ts` | src/root: pipeline integration | integration | 529 | `CONSOLIDATE` | Consolidate 529 LOC capture-answer pipeline test into focused module tests. |
| 84 | `src/modules/history/daemon-client.test.ts` | modules: history | owner | 523 | `CONSOLIDATE` | Consolidate 523 LOC history daemon client test with generated bindings. |
| 85 | `src/core/workflow/steps/step-context-scope-policy.test.ts` | core: workflow | owner | 513 | `KEEP` | Retain 513 LOC step scope isolation policy tests. |
| 86 | `clients/apple/Tests/KotaSharedTests/DaemonConnectionDiagnosticTests.swift` | clients/apple | owner (client) | 509 | `KEEP` | Retain 509 LOC native Swift connection diagnostic tests. |
| 87 | `src/core/workflow/run-executor-scope-policy.test.ts` | core: workflow | owner | 508 | `KEEP` | Retain 508 LOC run executor scope restriction tests. |
| 88 | `src/cross-store-scope-isolation.integration.test.ts` | src/root: store integration | integration | 504 | `CONSOLIDATE` | Consolidate 504 LOC cross-store test into unit store tests. |
| 89 | `src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts` | core: workflow | owner | 502 | `KEEP` | Retain 502 LOC agent trajectory diagnostic recording tests. |

### Large Authored Test-Support Files (2 Files)

| # | File Path | Production Owner | Cadence | Baseline LOC | Disposition | Rationale / Target Architecture |
| :- | :--- | :--- | :--- | -: | -: | :--- |
| 1 | `clients/mobile/src/__tests__/__fixtures__/ui-behavior-vectors.generated.json` | clients/mobile | owner (client) | 1,011 | `KEEP` | Retain 1011 LOC generated UI behavior vectors as canonical fixture. |
| 2 | `src/modules/autonomy/workflows/runtime-health-auditor/runtime-health-audit-control-coverage-test-support.ts` | modules: autonomy | owner | 538 | `CONSOLIDATE` | Consolidate 538 LOC test support by unifying control coverage helper. |
