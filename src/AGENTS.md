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

## AgentLoopState Cast Pattern

`AgentSession` delegates work to extracted functions via `this as unknown as AgentLoopState`. TypeScript cannot see through this cast, so every private field that an extracted function initializes must carry a `!` definite assignment assertion in the class body (e.g. `private sigintHandler!: () => void`). When adding a new field that an extracted function sets: (1) add it to `AgentLoopState` in `loop-init.ts`, (2) add the `!`-asserted declaration to `AgentSession` in `loop.ts`, (3) initialize it inside the extracted function.
