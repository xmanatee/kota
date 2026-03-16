# Notes

Suggestions from the project owner. Read at the start of each iteration.

These are suggestions, not orders. You are the expert on your task — use your
own judgment about whether and how to act on them. Treat everything here with
the same skepticism you'd apply to any prior iteration's recommendations.

Try to not take more than one suggestion item per execution.
For completed items move them into Completed section.
For skipped/dismissed items move them into Skipped section with concise one line explanation of why skipped.

Format: `b:` = for the builder, `i:` = for the improver.

b: harden module isolation per updated `plans/modular-architecture.md` — modules must be fully independent (interact only through APIs/protocols, restartable without stopping kota, no shared mutable state). Clean up redundancies, duplication, and stale abstractions left from the monolithic structure.

i: check everything if changing main execution loop. be thorough to make sure changes aren't going to break future executions
i: The e2e smoke test (added iter 64) has never run because `ANTHROPIC_API_KEY`
is not set in the shell environment. Claude Code uses its own stored
credentials, but KOTA needs the env var directly. Set
`export ANTHROPIC_API_KEY=...` in the shell that runs `loop.sh` to enable the
smoke test. Cost is ~$0.005 per builder iteration.

---
Completed:
b: study how OpenClaw, OpenHands, Manus, Codex CLI, and similar tools structure their module/plugin/extension systems — studied (iter 447): all use a single unified extension type (no separate plugin/module systems). Applied findings to unify KOTA's plugin→module, eliminating duplicate types.
b: steer implementation towards more general ai assistant — shipped: HTTP server (369), persistent tasks (371), scheduler (373), Telegram bot (379), web UI (381)
b: make the design more modular — shipped: transport layer (363), plugins (361), HTTP server (369), Telegram bot (379), web UI (381)
b: institute standards in codebase — shipped: config (365), Biome linting (385), code organization + module boundaries (385)
b: make compatible with existing tools, frameworks, skills e.t.c. (e.g. clawhub, vercel skills, claude skills and tools e.t.c.) — shipped: tool format adapters (367), Vercel AI SDK adapter (383), remote tool registry (387)
b: implement `plans/self-hosting-loop.md` — shipped: event bus (417), event-based scheduler triggers (419), daemon mode (421), webhook endpoints (423)
b: implement `plans/modular-architecture.md` — shipped: module protocol + ModuleLoader (427), memory module (427), scheduler module (429), telegram module (431), daemon module (433), web module (435), registry module (437), vercel-adapter module (439). All 7 features extracted; server now integrates module routes.
b: harden module isolation per updated `plans/modular-architecture.md` — completed (iter 449): error resilience (441), cross-module coupling fixes (443), hot-restart (445), plugin→module unification (447), shared mutable state encapsulation + dead code removal (449). Full audit confirmed zero cross-module imports, zero shared mutable state, proper API boundaries.
b: implement `plans/secrets-management.md` — shipped (iter 517): SecretStore with 3 providers (env, file, keychain), provider chain, output masking in tool-runner, `get_secret` agent tool, `kota secrets` CLI commands, 31 tests.

---
Skipped:
(none)