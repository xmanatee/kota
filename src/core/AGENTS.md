# Core

This directory contains KOTA's kernel: the runtime substrate that modules plug
into.

- Keep `src/core/` small and protocol-oriented.
- Core owns the agent/session loop, workflow runtime, daemon runtime, event
  bus, tool runtime, and module lifecycle.
- General-purpose product capabilities should prefer `src/modules/` unless they
  are truly shared runtime primitives.
- Do not add operator-facing feature code here when it can live in a module.

## Subtrees

- `agents/` — core agent and skill definition types plus system-prompt
  primitives.
- `channels/` — core channel protocol types.
- `config/` — configuration schema, layered loading, secrets management, and
  secret providers.
- `daemon/` — daemon host, control API, scheduler persistence, and live runtime
  state.
- `events/` — typed event catalog and event bus.
- `loop/` — `AgentSession`, turn execution, context assembly, transport,
  dynamic state, and module-contributed pre-send hooks that run once before
  the main turn loop.
- `model/` — `ModelClient` interface, registry, adaptive routing, and streaming.
  Provider implementations live in `src/modules/model-clients/`.
- `modules/` — module protocol, discovery, loading, lifecycle, storage, and
  foreign-module support.
- `tools/` — core tool runtime and the remaining truly core-hosted tools.
- `workflow/` — workflow definitions, validation, execution, runtime, and
  repair-loop mechanics.
- `agent-harness/` — neutral `AgentHarness` protocol and registry plus the
  `SDK*` wire-type declarations (`sdk-types.ts`) the workflow runtime, run
  stores, and step executors consume. Workflow agent steps, the repair loop,
  the agent-harness delegate backend, and the CLI all dispatch through this
  registry. Adapters (claude-agent-sdk, thin, codex, gemini, etc.) ship as
  modules and register on load. Steps inherit the active preset's harness
  unless `KotaConfig.defaultAgentHarness` or a per-step `harness` pins a
  different adapter. The Claude Agent SDK executor primitive and
  owner-questions MCP bridge live inside
  `src/modules/claude-agent-harness/`, not here.
- `prompt-input/` — harness-neutral user-prompt preprocessing
  (`@path` reference expansion). Every CLI path calls it before handing a
  prompt to `AgentHarness.run`, so every adapter receives the same
  already-expanded text.
- New non-test source should land in `src/core/<subtree>/` or `src/modules/<name>/`,
  not as another loose `src/*.ts` file.

## Strict Types Policy

`any` is forbidden in production TypeScript and is enforced by Biome's
`noExplicitAny` and `noImplicitAnyLet` rules. The same rules are intentionally
relaxed for `*.test.ts`, `*.integration.test.ts`, and `*.integration.ts`
fixtures so test scaffolding can mock partial shapes without ceremony.

`unknown` (and the JSON-shaped alias `Record<string, unknown>`) is the right
type for untrusted input at a system boundary:

- JSON parse and disk-fixture loaders.
- HTTP/SSE/JSON-RPC frames before they have been shaped.
- External SDK adapter inputs and their raw event passthrough.
- Caught errors (`catch (err: unknown)`).
- Schema/decoder entry points whose only job is to narrow.

Inside trusted domain code — agent loops, workflow execution, event handlers,
business logic — values are expected to already carry their precise type. A
`Record<string, unknown>` that flows past a decoder is a missing decoder.

The mechanical guard for this policy is
`src/strict-types-policy.integration.test.ts`. It scans every production
`.ts` file under `src/` and counts the three boundary patterns (`: unknown`,
`Record<string, unknown>`, `as unknown`) per file, ratcheting against the
committed baseline:

- A new file appearing with boundary patterns fails the test.
- An existing file's count climbing past its baseline fails the test.
- A reduction passes silently and the operator can regenerate via
  `STRICT_TYPES_REGENERATE=1 pnpm test src/strict-types-policy.integration.test.ts`.

When a runtime parser legitimately needs `unknown`, expose a typed decoder
beside it (e.g. `parseQuietHours`, `decodeRootsListResult`,
`decodeGitHubIssueList`) that returns either a precise shape or a
discriminated `{ ok: false; error: string }` result. Downstream consumers
must depend on the typed result, not on the raw boundary value.
