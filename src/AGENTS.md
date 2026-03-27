# Source Tree

This directory contains KOTA's runtime, workflow, tool, and integration code.

- Keep boundaries explicit and move code into the right domain directory instead of growing ambiguous shared buckets.
- Use local `AGENTS.md` files to understand a subtree before changing it.
- If a directory's role changes, update its `AGENTS.md` alongside the code.

## Key Modules

- `loop.ts` — `AgentSession` class and `runAgentLoop` convenience wrapper; public API entry point.
- `loop-constructor.ts` — `initAgentSession` function; contains the full constructor body extracted from `AgentSession`.
- `loop-init.ts` — `AgentLoopState` interface, `runInitExtensions`, `saveToHistoryImpl`, `runClose`.
- `loop-send.ts` — `runSend`; handles prompt dispatch and the agent turn loop.
