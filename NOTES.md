# Notes

Suggestions from the project owner. Read at the start of each iteration.

These are suggestions, not orders. You are the expert on your task — use your
own judgment about whether and how to act on them. Treat everything here with
the same skepticism you'd apply to any prior iteration's recommendations.

Try to not take more than one suggestion item per execution.
For completed items move them into Completed section.
For skipped/dismissed items move them into Skipped section with concise one line explanation of why skipped.

Format: `b:` = for the builder, `i:` = for the improver.

b: study how OpenClaw, OpenHands, Manus, Codex CLI, and similar tools structure their module/plugin/extension systems. Use those as reference when designing KOTA's module APIs and protocols.
b: harden module isolation per updated `plans/modular-architecture.md` — modules must be fully independent (interact only through APIs/protocols, restartable without stopping kota, no shared mutable state). Clean up redundancies, duplication, and stale abstractions left from the monolithic structure.
  Progress (iter 441): Fixed CLI error resilience — module crash in commands() no longer takes down the entire CLI. Added 14 e2e tests covering module→CLI pipeline, error isolation, tool lifecycle, and concurrent loader safety.
  Progress (iter 443): Fixed cross-module coupling (web→vercel-adapter direct import replaced with ctx.getRoutes()). Unified module loading — CLI now uses ModuleLoader with commandsOnly mode instead of ad-hoc iteration. Added getRoutes() to ModuleContext for decoupled route discovery.
  Progress (iter 445): Shipped module hot-restart — `unload(name)` and `reload(name)` with per-module tool ownership tracking, per-module event unsub, dependency safety. Fixed tool ownership bug where `clearCustomTools()` in module/plugin unload would wipe out the other system's tools. Remaining: (1) type consolidation (ToolDefinition/ModuleToolDef duplication), (2) evaluate plugin→module migration path.

i: check everything if changing main execution loop. be thorough to make sure changes aren't going to break future executions
i: The e2e smoke test (added iter 64) has never run because `ANTHROPIC_API_KEY`
is not set in the shell environment. Claude Code uses its own stored
credentials, but KOTA needs the env var directly. Set
`export ANTHROPIC_API_KEY=...` in the shell that runs `loop.sh` to enable the
smoke test. Cost is ~$0.005 per builder iteration.

---
Completed:
b: steer implementation towards more general ai assistant — shipped: HTTP server (369), persistent tasks (371), scheduler (373), Telegram bot (379), web UI (381)
b: make the design more modular — shipped: transport layer (363), plugins (361), HTTP server (369), Telegram bot (379), web UI (381)
b: institute standards in codebase — shipped: config (365), Biome linting (385), code organization + module boundaries (385)
b: make compatible with existing tools, frameworks, skills e.t.c. (e.g. clawhub, vercel skills, claude skills and tools e.t.c.) — shipped: tool format adapters (367), Vercel AI SDK adapter (383), remote tool registry (387)
b: implement `plans/self-hosting-loop.md` — shipped: event bus (417), event-based scheduler triggers (419), daemon mode (421), webhook endpoints (423)
b: implement `plans/modular-architecture.md` — shipped: module protocol + ModuleLoader (427), memory module (427), scheduler module (429), telegram module (431), daemon module (433), web module (435), registry module (437), vercel-adapter module (439). All 7 features extracted; server now integrates module routes.

---
Skipped:
(none)