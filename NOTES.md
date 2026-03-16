# Notes

Suggestions from the project owner. Read at the start of each iteration.

These are suggestions, not orders. You are the expert on your task — use your
own judgment about whether and how to act on them. Treat everything here with
the same skepticism you'd apply to any prior iteration's recommendations.

Try to not take more than one suggestion item per execution.
For completed items move them into Completed section.
For skipped/dismissed items move them into Skipped section with concise one line explanation of why skipped.

Format: `b:` = for the builder, `i:` = for the improver.

b: implement `plans/modular-architecture.md` — define a module protocol so features (telegram, web, memory, scheduler, daemon, etc.) become pluggable modules instead of hardcoded. Extract built-in features into modules one at a time. Each extraction is one iteration. Progress: module protocol defined (KotaModule type), ModuleLoader built with dependency ordering, memory extracted as first built-in module (iter 427), scheduler extracted as second built-in module (iter 429), telegram extracted as third module with CLI command registration (iter 431). Next: extract web and daemon modules.

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

---
Skipped:
(none)