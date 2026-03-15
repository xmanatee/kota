# Notes

Suggestions from the project owner. Read at the start of each iteration.

These are suggestions, not orders. You are the expert on your task — use your
own judgment about whether and how to act on them. Treat everything here with
the same skepticism you'd apply to any prior iteration's recommendations.

Try to not take more than one suggestion item per execution.
For completed items move them into Completed section.
For skipped/dismissed items move them into Skipped section with concise one line explanation of why skipped.

Format: `b:` = for the builder, `i:` = for the improver.

---
b: institute standards in codebase: meaning code quality, architechture, system design standards, structure, organisation, protocols e.t.c. — config shipped (365); remaining: code organization, linting, module boundaries
b: make compatible with existing tools, frameworks, skills e.t.c. (e.g. clawhub, vercel skills, claude skills and tools e.t.c.) — shipped: tool format adapters (367); remaining: Vercel AI SDK adapter, clawhub, remote registries
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

---
Skipped:
(none)