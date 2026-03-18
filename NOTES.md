# Notes

Suggestions from the project owner. Read at the start of each iteration.

These are suggestions, not orders. You are the expert on your task — use your
own judgment about whether and how to act on them. Treat everything here with
the same skepticism you'd apply to any prior iteration's recommendations.

Try to not take more than one suggestion item per execution.
For completed items move them into Completed section.
For skipped/dismissed items move them into Skipped section with concise one line explanation of why skipped.

Format: `b:` = for the builder, `i:` = for the improver.
b: development standards should include
 - avoiding adding logic or overridable params in production code purely for testing.... production code should instead be well designed and architechtured to be testable...
b: ideally prompts aren't just in the js files... probably better to allow them to be in codebase as markdown files... maybe with ability to even add template params in them... generally the tool should feel very comfortable working with markdowns with yaml frontmatter.
  → Progress (iter 661): Built `PromptStore` + `prompt_template` tool — markdown prompt files in `.kota/prompts/` with YAML front matter and `{{variable}}` substitution. 4 actions (list/get/render/create), auto-variable detection, 45 tests.
  → Progress (iter 665): Wired PromptStore into delegate tool — `prompt` + `prompt_vars` parameters let users customize sub-agent system prompts via `.kota/prompts/` templates. 7 new tests (4212 total). Next: module integration (prompt templates via ctx.storage), session warmup loading.
b: ideally kota respects and reads AGENTS.md and CLAUDE.md files if it finds it on the path to files... similarly to how claude code and agents e.t.c. work
  → Progress (iter 663): Built `src/instruction-files.ts` — discovers AGENTS.md and CLAUDE.md by walking up from cwd (root-first), resolves `@path.md` cross-references (depth 3, circular-safe), truncates at 8KB/file. Wired into loop.ts system prompt + delegate config. 19 tests. Next: subdirectory-scoped loading (only load child AGENTS.md when active in subtree), file-watcher integration for cache invalidation.
b: ideally modules are isolated and self-contained even more... to the point that it should be possiblee to have modules written in other languages... e.g. rust... and it should be possible to load, unload, reload modules in runtime. The architechture and API and protocols should allow for that.
b: explore the following interesting articles and resources... maybe they could be base for improvements... but maybe some of them are already irrelevant and everything is great already:
 - https://glthr.com/XML-fundamental-to-Claude
 - https://www.bengubler.com/posts/2026-02-25-introducing-helm
 - https://arxiv.org/abs/2511.18423
 - https://github.com/martian-engineering/lossless-claw
 - https://github.com/wu-yc/LabClaw
 - https://github.com/open-pencil/open-pencil
 - https://github.com/andrewyng/context-hub
 - https://github.com/RightNow-AI/openfang
 - https://github.com/resemble-ai/chatterbox
 - https://github.com/alinaqi/claude-bootstrap
 - https://github.com/here-build/foundation
 - https://justin.abrah.ms/blog/2026-01-05-wrapping-my-head-around-gas-town.html
 - https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/
b: institute standards in codebase: proper structure, codestyle, work approach with stages for work e.t.c. ideally some of that should be automated through linters or tests... the rest is approach which could be changed in prompts... instead of having a single DESIGN doc establish a strucure with directories and write the design for every system/component there. it sohuldn't be detailed! concise and high-level.. implementation details can be checked in code when needed. Also these docs must be kept up to date!
  → Progress (iter 641): Created 3 domain-based subdirectories (memory/, scheduler/, server/) with per-directory README.md docs. Moved 15 source files from flat src/ root. Each README has concise file table + dependency graph. Next: more clusters (context/, model/), codestyle automation.
i: improver shouldn't overoptimise things that aren't broken (e.g. reading files or smth like that)
i: improver must optimise both improver and builder for quality and creativity and quality. Not for speed or cost or anything close to that! it shouldn't optimize scripts if some steps are repeated all the time. instead it should make sure both improver and builder know what to look at and how to research and how do things.
b: i want the agent to support both  @anthropic-ai/sdk and @anthropic-ai/claude-agent-sdk.. if i run it without anthropic keys it should just claude code backend...
  → Progress (iter 609): Built ModelClient abstraction — `ModelClient` interface + `AnthropicModelClient` default implementation. All 7 LLM call sites (loop, streaming, architect, delegate, compaction, context) now accept `ModelClient` instead of `Anthropic` directly. Mock clients and tests updated. 9 new tests.
  → Progress (iter 611): Built `OpenAIModelClient` — connects to any OpenAI-compatible API. 36 new tests.
  → Progress (iter 613): Wired multi-provider into CLI and config. `--model ollama/llama3`, `--provider`, `--base-url` flags + config `modelProvider`. 5 built-in presets (openai, ollama, groq, together, lmstudio). 23 new tests.
  → Progress (iter 633): Built adaptive model routing — delegate sub-agents auto-select model tier (fast/balanced/capable) based on task complexity. Config: `modelTiers` in config.json. 29 new tests.
  → Progress (iter 637): Built Agent SDK backend (`src/agent-sdk/`) — `kota run --provider agent-sdk "task"` delegates to Claude Code's full agent runtime via `@anthropic-ai/claude-agent-sdk` (optional peer dep). Dynamic import, graceful fallback. 10 new tests.
  → Progress (iter 639): Wired Agent SDK as delegate backend — `delegate-agent-sdk.ts` routes execute+coding/debugging/automation at capable tier through Claude Code's full runtime. Model router auto-selects backend. `DelegateConfig.backend` for manual override. `CostTracker.addRawCost()` for SDK cost tracking. 20 new tests. Next: interactive mode support, integration test with real SDK, agent-sdk for batch parallel delegations.
b: i might be wrong, but it feels like "modules" are just files now which still import stuff from core still... e.g. vercel stuf isn't self-contained isolated vercel stuff, but file with command definitions which imports stuff from core where vercel stuff is defined... that was not the original idea for modularizing... modularization should've enabled plug-n-play tools, skills, channels (e.g. telegram, whatsapp, web, e.t.c.), memory systems. So that i could swap one memory module for another and it would work. or I could enable web frontend module and then could access the assistant from web. Or could ask the assistant to develop some new functionality and assitant would implement it as module, install it without runtime and make it available... so original idea behind modules was ACTUAL self-contained and extendable functionality for the assistant. Lots of existing mechanisms could probably be expressed as modules if the protocol and API for modules was defined well enough... That would need an extensive research and system design/architechture...
  → Progress (iter 535): Built Module SDK — modules now receive scoped storage (`.kota/modules/<name>/`), per-module config (`config.modules.<name>`), and prompt section contributions. 4 modules use promptSection.
  → Progress (iter 537): Built `module_factory` tool — agent can now create full modules at runtime from JSON manifests with multiple tools, prompt sections, and metadata. Manifests persist to `.kota/modules/<name>/manifest.json` and auto-load on startup. 47 tests. Next: migrate memory/knowledge into modules using `ctx.storage`, module event handlers via manifest, module templates.
  → Progress (iter 539): Built MCP server mode (`kota mcp-server`) — exposes all KOTA tools via Model Context Protocol over stdio. Any MCP-compatible host (Claude Code, Cursor, VS Code) can now use KOTA's tools natively. This is the "channels" dimension of modularization — instead of building one integration at a time, MCP makes every compatible host a KOTA frontend automatically. 20 tests.
  → Progress (iter 549): Extended ModuleContext with `log`, `getSecret()`, `listTools()`, and tools-as-function pattern. Tool runners can now access services via context closure instead of importing core singletons. Secrets module refactored as proof of concept. 16 new tests.
  → Progress (iter 551): Added `ctx.events` proxy (`emit`/`on`/`once`) and `ctx.createSession()` factory to ModuleContext. Modules can now emit/subscribe to bus events and spawn agent sessions without importing core singletons. Dependency injection avoids circular imports. 14 new tests.
  → Progress (iter 553): Added `eventHandlers` to module manifests — agent-created modules can now subscribe to bus events and run code when they fire. Combined with new `notify` tool, enables end-to-end automation (e.g., module reacts to schedule.fire, checks condition, sends desktop notification). 24 new tests. Next: migrate TelegramBot and Daemon to use ctx.events/ctx.createSession(), add event filter support to manifest handlers.
  → Progress (iter 559): Wired knowledge store CRUD to event bus — `knowledge.create`, `knowledge.update`, `knowledge.delete` events. Completes the data→events→actions pipeline: knowledge changes now trigger module event handlers. 7 new tests.
  → Progress (iter 561): Built self-registering tool registry — each tool exports co-located risk/group metadata. Guardrails and module-factory auto-derive from registry. Adding a new tool: 5 files instead of 8+. Next: break circular dep to derive tool-groups too, extend ToolDef with risk for module tools.
  → Progress (iter 563): Built provider system — typed interfaces (MemoryProvider, KnowledgeProvider) and ProviderRegistry. Modules can register as providers via `ctx.registerProvider()`, config selects active provider per service type. Memory and knowledge tools now resolve via registry. 24 new tests.
  → Progress (iter 653): Added TaskProvider and HistoryProvider — all four core service types now pluggable. Tools (todo, conversation-recall) and session warmup resolve via provider registry. +8 tests. Next: SchedulerProvider, provider discovery CLI, built-in alternative providers.
  → Progress (iter 575): Added `scripts` to module manifests — named, on-demand tool-call sequences that compose existing tools. `module_factory(action:"run")` executes scripts and returns results. This is the "scripts" capability — modules can now define reusable automation without code. 14 new tests.
b: having implemented events and tasks e.t.c. let's implement some kind storage/data layer which ideally should be text based... probably smth like markdown with the YAML front matter... And there should be all the capabilities for assistant to add or edit all these files and use them for tasks or event driven execution... then having scheduler and modular system and all of that I'd want you to implement the builder/improver loop in some form... (btw also probably modules should support defining their own tools, scripts, logs or smth ...) I see at as some backlog for builder and builder should execute whenever there's spare cycles (i.e. there's nothing to do) and improver should execute whenever there's nothing todo and there's any new data to base improvements on... Generally be sceptical and aim for making it a sound architechture and design, but ideally i want this flow to be supported...
  → Progress (iter 531): Built the file-based Knowledge Store — markdown+YAML front matter entries in .kota/data/, with agent tool, session warmup recall, and 29 tests. Foundation for event-driven execution and module data is now in place. Next: CLI commands, event triggers, module data namespacing.
  → Progress (iter 581): Built module persistent logging — `ModuleLogStore` with JSONL files per module, auto-logging from `ctx.log`, step handlers, and scripts. Agent queries via `module_factory(action:"logs")`. Completes the "tools, scripts, logs" trifecta from the modularization request. 30 new tests.
b: it should also be properly tested somehow... maybe with e2e tests... we could mock some stuff like llms with responces but should check that event based system works as expected... maybe reserch whether it's possible to mock claude code stuff when using anthropic-sdk.
  → Progress (iter 533): Built mock Anthropic client (`src/mock-client.ts`) and 15 E2E tests (`src/e2e.test.ts`) covering the full agent loop, tool execution, event bus, observation masking, and circuit breaker — all without a real API key.
  → Progress (iter 625): Added 11 advanced E2E tests (`src/e2e-advanced.test.ts`): 4 delegate tests (explore/execute/error paths), 2 architect mode tests (single+multi-file plan-execute), 5 scheduled action tests (ActionExecutor pipeline, concurrency, Scheduler integration). Next: event-triggered schedule E2E tests, module event handler E2E tests.
  → Progress (iter 645): Added 13 event-driven pipeline E2E tests (`src/e2e-events.test.ts`): step handler execution, $prev/$payload/$steps[N] resolution, conditional steps, error isolation, schedule.fire + knowledge.create typed events, multi-handler, full Scheduler→event→handler pipeline. Next: code-based event handler E2E tests (REPL path).
i: check everything if changing main execution loop. be thorough to make sure changes aren't going to break future executions
i: The e2e smoke test (added iter 64) has never run because `ANTHROPIC_API_KEY`
is not set in the shell environment. Claude Code uses its own stored
credentials, but KOTA needs the env var directly. Set
`export ANTHROPIC_API_KEY=...` in the shell that runs `loop.sh` to enable the
smoke test. Cost is ~$0.005 per builder iteration.
b: improve the source structure... it should be really well structured with core, modules, features, e.t.c. think of the right grouping and structure and organisation and implement it. it shouldn't be more than 15 files in a directory... there should be a nice file/module structure
  → Progress (iter 641): Moved 15 source files into 3 domain directories (memory/ 6 files, scheduler/ 6 files, server/ 3 files) with barrel exports and READMEs. src/ root reduced from 73 to 58 non-test source files. Next: more clusters to get each dir under 15 files.
  → Progress (iter 667): Added data/ (6 files: csv-preview, json-preview, html-extract, html-page-extract, plot-capture, code-wrappers) and model/ (5 files: model-client, model-router, provider-factory, streaming, mock-client). Root reduced from 61→51 non-test source files. Next: security/ (guardrails, secrets), events/ (event-bus, file-watcher), context/ (context, system-prompt, observation-masking) to reach ≤15 target.
i: introduce rght mechanisms for things TODO, progress tracking, owner NOTES e.t.c. everything must be convenient and efficient... but at the same time it shouldn't be restrictive on agents! Agents shouldn't be just injected some "important" stuff ... they must be trusted, but they must be directed to look in the the right places and things....

---
Completed:
i: simplify parse-log.py trend output — shipped (iter 632): trimmed from 22 signals to 9 actionable metrics. Cut calls, cost, ctx/turn, errors, sweep, re-edit, verify reruns, subsystems, domains, severity, rotation, mutation check, DESIGN.md lines, depth coverage. Kept: tests, research, rework, work diversity, domain concentration, owner priorities, top neglected.
b: clean up re-export facades left from file splits — shipped (iter 999): deleted 3 facade files (module-factory.ts, openai-model-client.ts, tools/module-factory.ts) + 1 backward-compat re-export in server.ts. Updated 12 consumers to import from actual source modules.
b: study how OpenClaw, OpenHands, Manus, Codex CLI, and similar tools structure their module/plugin/extension systems — studied (iter 447): all use a single unified extension type (no separate plugin/module systems). Applied findings to unify KOTA's plugin→module, eliminating duplicate types.
b: steer implementation towards more general ai assistant — shipped: HTTP server (369), persistent tasks (371), scheduler (373), Telegram bot (379), web UI (381)
b: make the design more modular — shipped: transport layer (363), plugins (361), HTTP server (369), Telegram bot (379), web UI (381)
b: institute standards in codebase — shipped: config (365), Biome linting (385), code organization + module boundaries (385)
b: make compatible with existing tools, frameworks, skills e.t.c. (e.g. clawhub, vercel skills, claude skills and tools e.t.c.) — shipped: tool format adapters (367), Vercel AI SDK adapter (383), remote tool registry (387)
b: implement `plans/self-hosting-loop.md` — shipped: event bus (417), event-based scheduler triggers (419), daemon mode (421), webhook endpoints (423)
b: implement `plans/modular-architecture.md` — shipped: module protocol + ModuleLoader (427), memory module (427), scheduler module (429), telegram module (431), daemon module (433), web module (435), registry module (437), vercel-adapter module (439). All 7 features extracted; server now integrates module routes.
b: harden module isolation per updated `plans/modular-architecture.md` — completed (iter 449): error resilience (441), cross-module coupling fixes (443), hot-restart (445), plugin→module unification (447), shared mutable state encapsulation + dead code removal (449). Full audit confirmed zero cross-module imports, zero shared mutable state, proper API boundaries.
b: implement `plans/secrets-management.md` — shipped (iter 517): SecretStore with 3 providers (env, file, keychain), provider chain, output masking in tool-runner, `get_secret` agent tool, `kota secrets` CLI commands, 31 tests.
b: consider observation masking for context management — shipped (iter 523): always-on masking of ALL old tool outputs beyond rolling window of 10 messages. Based on JetBrains NeurIPS 2025 research. Replaces reactive pruning (budget-gated, read-only tools only) with proactive masking (every turn, all tools). 24 tests.

---
Skipped:
(none)