---
id: task-add-cross-harness-mcpservers-parity-integration-te
title: Add cross-harness mcpServers parity integration test
status: done
priority: p2
area: architecture
summary: Lock the mcpServers contract — claude-agent-sdk forwards through to the SDK executor (preserving caller servers and merging owner-questions when askOwner is set); openai-tools and thin both reject loudly with explicit messages — with a single src/mcp-servers-cross-harness.integration.test.ts mirroring the rails and abort cross-harness tests.
created_at: 2026-04-28T21:49:00.659Z
updated_at: 2026-04-28T21:56:42.370Z
---

## Problem

`src/core/agent-harness/AGENTS.md` declares `mcpServers` as part of the
harness-neutral protocol every adapter consumes. The three registered
adapters today implement asymmetric, but each load-bearing, behavior:

- `src/modules/claude-agent-harness/adapter.ts` forwards
  `options.mcpServers` through to `executeWithAgentSDK`. When
  `askOwner` is also set, `mergeOwnerQuestionsMcpServer` adds the
  in-process owner-questions MCP server to the caller-supplied map
  *without overwriting any existing entry under the same name*. A
  caller that already wired their own owner-questions server (modules
  may do this) keeps theirs; otherwise the adapter adds the default.
  This is the only adapter that hosts MCP servers, and the merge
  behavior is the only place callers can see whether the adapter
  silently overwrote their server map.
- `src/modules/openai-tools-agent-harness/adapter.ts:45–50` rejects
  non-empty `mcpServers` with `'The "openai-tools" agent harness does
  not host MCP servers...'`. There is one unit-test for the rejection
  in `adapter.test.ts:469–478` but no integration-tier parity guard.
- `src/modules/thin-agent-harness/adapter.ts:26–30` rejects non-empty
  `mcpServers` with `'The "thin" agent harness is text-only; drop
  mcpServers...'`. There is no test (unit or integration) for this
  rejection today — `grep "mcpServers" thin-agent-harness/` shows the
  rejection path is enforced only by the source code.

The cross-harness integration tier now covers four parity surfaces:

- `src/hooks-cross-harness.integration.test.ts` — preRun/postRun hooks
  fire at the same points across adapters.
- `src/prompt-input-cross-harness.integration.test.ts` — `@path`
  expansion runs once before any adapter sees the prompt.
- `src/rails-cross-harness.integration.test.ts` — `canUseTool`,
  `allowedTools`, and `disallowedTools` deny cleanly across every
  registered harness.
- `src/abort-cross-harness.integration.test.ts` — `abortController`
  pre-run and mid-run propagation across every registered harness.

`mcpServers` parity was the explicitly carved-out follow-up from the
abort task: "additional surfaces (mcpServers, abortController
propagation, hook ordering across rails) is out of scope and belongs
in follow-up tasks." Abort coverage just landed; mcpServers is the
remaining load-bearing carve-out.

Without an integration-tier parity test, the next adapter that adds
`mcpServers` support — or a refactor that silently coerces an empty
map past the rejection guard, or a regression that drops the
owner-questions merge — will only fail per-adapter unit-test memory,
not `pnpm test` at the integration tier. The owner-questions-merge
behavior in particular is a real footgun: a regression that overwrote
caller-supplied servers would be invisible to anyone running the
adapter without an owner-questions module, and would silently drop
operator-supplied tool surfaces in the autonomy loop.

## Desired Outcome

A new `src/mcp-servers-cross-harness.integration.test.ts` exists at
the root integration tier alongside the existing
`*-cross-harness.integration.test.ts` files. It iterates every
registered `AgentHarness` (currently `claude-agent-sdk`,
`openai-tools`, `thin`) and asserts the contract for each adapter:

- **claude-agent-sdk forwards mcpServers through to the SDK
  executor unchanged when `askOwner` is unset.** A caller-supplied
  `mcpServers` map (e.g. `{ foo: { type: "stdio", command: "bar" } }`)
  arrives at `executeWithAgentSDK`'s options argument with the same
  entries, no additions, no removals. The mocked executor sees the
  exact map.
- **claude-agent-sdk merges the owner-questions MCP server into a
  caller-supplied map without overwriting existing entries** when
  `askOwner: { source: "..." }` is set. The merged map contains both
  the caller's server and the owner-questions server keyed under
  `KOTA_OWNER_QUESTIONS_MCP_SERVER`. If the caller already supplied
  an entry under that key, the adapter must keep the caller's entry
  (the existing
  `mergeOwnerQuestionsMcpServer` contract); the test asserts this with
  a sentinel command/value the merge would replace if the contract
  broke.
- **openai-tools rejects non-empty `mcpServers` loudly** with the
  existing "does not host MCP servers" message. The adapter must not
  call into the underlying model client (`messagesStream` /
  `messagesCreate` are not invoked).
- **thin rejects non-empty `mcpServers` loudly** with the existing
  "text-only; drop mcpServers" message. The adapter must not call
  into the underlying model client.
- **Empty `mcpServers` (the literal `{}`) is treated as "unset" by
  every adapter** — claude-agent-sdk forwards an empty/undefined map
  through, and openai-tools and thin do not reject. This locks the
  shared "non-empty" contract in the rejection guards and prevents a
  regression that, e.g., changed `Object.keys(...).length > 0` to
  truthy-check the map itself.

The test mocks the underlying model client and SDK executor with the
same `vi.mock("#core/model/model-client.js")` +
`vi.mock("#modules/claude-agent-harness/executor.js")` pattern the
existing four cross-harness tests use, so it consumes no real LLM
budget.

The agent-harness `AGENTS.md` gains one short addition under the
existing parity-pointer sentence: "...
`src/abort-cross-harness.integration.test.ts` (for `abortController`
pre-run and mid-run propagation), and
`src/mcp-servers-cross-harness.integration.test.ts` (for the
forward / reject / merge contract) enforce parity."

## Constraints

- One file at the root integration tier:
  `src/mcp-servers-cross-harness.integration.test.ts`. Do not split
  per-adapter; the parity claim is exactly that the contract holds
  across every registered adapter, so the assertions must run inside
  one shared loop or one shared `describe.each` over the registered
  harness list.
- Reuse the existing mocking pattern from
  `rails-cross-harness.integration.test.ts` and
  `abort-cross-harness.integration.test.ts`. Do not stand up new test
  fixture infrastructure or a new model-client abstraction.
- The test must not consume real LLM budget. Mock the model client
  and the SDK executor; the test exercises the adapter's `mcpServers`
  handling, not the model.
- The owner-questions merge assertion must use the actual
  `KOTA_OWNER_QUESTIONS_MCP_SERVER` constant as the test key, not a
  hardcoded duplicate string. Import it from
  `#modules/claude-agent-harness/kota-tools-mcp.js` so a rename of
  the constant breaks the test and not silently the production
  contract.
- Do not modify the `AgentHarness` protocol. `mcpServers` is already
  a protocol field; this task only adds enforcement.
- Do not modify any adapter unless the test surfaces a real gap. If
  a gap is surfaced, fix the adapter as part of the same task and
  name the fix in the commit message.
- Honor `src/AGENTS.md`'s root layout rule: cross-subsystem
  integration tests live at the root, named
  `*-cross-harness.integration.test.ts`, and module imports are
  allowed at the root tier.
- Follow the file-size guideline (~300 lines). If the natural shape
  exceeds that, split shared helpers into a sibling test-only helper
  file rather than inflating the integration test.
- Do not add a new `*-cross-harness.integration.test.ts` for any
  other property in this task. The remaining carved-out follow-up
  ("hook ordering across rails") belongs in a separate task if it
  proves load-bearing.

## Done When

- `src/mcp-servers-cross-harness.integration.test.ts` exists and
  asserts the contract — forward, reject, and owner-questions merge
  — against every registered `AgentHarness`.
- The test runs as part of `pnpm test` on the standard test gate.
  Every adapter passes its contract block; any adapter gap surfaced
  by the test is fixed in the same task.
- `src/core/agent-harness/AGENTS.md` gains one short addition
  pointing at the new test file as the contract enforcer for
  `mcpServers`.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` are green at the
  project root.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T21-47-20-350Z-explorer-iidzv9/` after the
cross-harness abort propagation parity test landed (commit
`8adbc8dc`, "Add cross-harness abort propagation parity integration
test"). The abort task's constraints explicitly named mcpServers
parity as a carved-out follow-up: "Do not add a new
`*-cross-harness.integration.test.ts` for any other property in this
task. The two remaining carved-out follow-ups (`mcpServers` parity,
hook ordering across rails) belong in separate tasks if they prove
load-bearing." A code read of the registered adapters confirms the
contract is real and asymmetric:

- `claude-agent-harness/adapter.ts:159–161` forwards `mcpServers`
  through and merges owner-questions on top of the caller-supplied
  map without overwriting existing entries
  (`mergeOwnerQuestionsMcpServer` lines 103–124).
- `openai-tools-agent-harness/adapter.ts:45–50` rejects loudly.
- `thin-agent-harness/adapter.ts:26–30` rejects loudly with no
  existing test (unit or integration) covering the rejection path.

The five cross-harness contracts (hooks, prompt-input, rails, abort,
mcpServers) together enforce the load-bearing parity surface every
registered `AgentHarness` must hold. With mcpServers coverage in
place, the integration tier turns "every adapter handles
`mcpServers` per its declared contract" from an `AGENTS.md` assertion
into a `pnpm test` failure on regression — the same shape the four
existing cross-harness tests already establish — and locks the
owner-questions merge behavior so a refactor cannot silently drop
caller-supplied servers.

## Initiative

Agent-harness contract conformance: KOTA's autonomy mode and
module-owned tool registration both depend on every registered
`AgentHarness` honoring `mcpServers` per its declared contract — a
silent coercion or merge regression in any adapter would either
silently drop operator-supplied tool surfaces or replace
caller-supplied servers with a default. The cross-harness
integration tier now covers hooks, prompt-input, rails, and abort
parity; mcpServers parity is the next load-bearing surface that
today only has per-adapter coverage (and a known coverage gap on
the thin adapter's rejection path). Closing this gap turns "every
adapter handles mcpServers per its declared contract" into a
`pnpm test` failure on regression and removes the silent-regression
risk for module-contributed MCP servers and the owner-questions
merge.

## Acceptance Evidence

- Diff covering `src/mcp-servers-cross-harness.integration.test.ts`
  (new), any adapter fix the test surfaces, and the one-line
  `AGENTS.md` pointer addition at the new test.
- `pnpm test` output showing the new test file's blocks pass for
  every registered harness (`claude-agent-sdk`, `openai-tools`,
  `thin`) including both the empty-map and non-empty-map cases for
  claude-agent-sdk, both rejection cases for openai-tools and thin,
  and the owner-questions merge case.
- A short note under the run directory recording, for each adapter,
  which code path the test exercises (e.g.
  "claude-agent-sdk: adapter.ts mergeOwnerQuestionsMcpServer +
  executor passthrough", "openai-tools: adapter.ts
  rejectClaudeSpecificOptions mcpServers branch", "thin: adapter.ts
  rejectUnsupportedToolOptions mcpServers branch") so a future
  contributor can see the mcpServers surface each adapter exposes
  without rereading every adapter.
