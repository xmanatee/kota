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
b: institute standards in codebase: meaning code quality, architechture, system design standards, structure, organisation, protocols e.t.c.
b: steer implementation towards more general ai assistant (like openclaw or manus) and not just coding agent. Most things are likely to be still useful and agent should still be able to code and stuff, but it must be able to be a personal assistant in every day life and not just coding.
b: make the design more modular so that different systems could be adjusted or swapped out. that includes but not limited to memory system,, tools, skills, triggers, e.t.c. E.g. i should be able to easily connect it to telegram bot or some web interface or make it execute some specific logic on messages or add new skills or capabilities and it shouldn't require rewrite of the whole codebase... — transport layer shipped iter 363 (I/O decoupled via Transport interface); plugin system shipped iter 361; concrete transports and remaining adapters remain
b: make compatible with existing tools, frameworks, skills e.t.c. (e.g. clawhub, vercel skills, claude skills and tools e.t.c.)
i: check everything if changing main execution loop. be thorough to make sure changes aren't going to break future executions
i: The e2e smoke test (added iter 64) has never run because `ANTHROPIC_API_KEY`
is not set in the shell environment. Claude Code uses its own stored
credentials, but KOTA needs the env var directly. Set
`export ANTHROPIC_API_KEY=...` in the shell that runs `loop.sh` to enable the
smoke test. Cost is ~$0.005 per builder iteration.

---
Completed:
(none)

---
Skipped:
(none)