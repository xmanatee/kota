---
id: task-add-cross-harness-rails-parity-integration-test-fo
title: Add cross-harness rails parity integration test for canUseTool, allowedTools, and disallowedTools
status: done
priority: p2
area: architecture
summary: Lock the agent-harness rails contract — every registered adapter must honor canUseTool denial, allowedTools, and disallowedTools — with a single src/rails-cross-harness.integration.test.ts that exercises every registered AgentHarness, mirroring the existing hooks-cross-harness and prompt-input-cross-harness integration tests.
created_at: 2026-04-28T20:39:06.375Z
updated_at: 2026-04-28T20:50:33.131Z
---

## Problem

`src/core/agent-harness/AGENTS.md` declares that every registered adapter
must honor `canUseTool`, `mcpServers`, and tool allow/deny lists. The
autonomy module's prompt-hierarchy contract (`src/modules/autonomy/AGENTS.md`)
treats these rails as load-bearing: the SDK system + core rails layer is
where the daemon enforces tool gating, and `createAgentCommitGuard` and
`createDaemonHostControlGuard` rely on `canUseTool` denials propagating
back to the agent loop so it can adapt rather than be torn down.

Today the cross-harness integration tier covers two parity surfaces:

- `src/hooks-cross-harness.integration.test.ts` — preRun/postRun hooks
  fire at the same points across every adapter.
- `src/prompt-input-cross-harness.integration.test.ts` — `@path`
  expansion runs once before any adapter sees the prompt.

The tool-gating rails — `canUseTool`, `allowedTools`, `disallowedTools` —
are tested only inside per-adapter unit suites
(`src/modules/thin-agent-harness/adapter.test.ts`,
`src/modules/openai-tools-agent-harness/adapter.test.ts`,
`src/modules/claude-agent-harness/executor.test.ts`). A new harness
adapter (or a regression in an existing one) could silently skip a rail
and the autonomy mode + approval-queue + tool-risk guardrails would
quietly fail on that adapter, with no test failing the standard
`pnpm test` gate. The agent-commit-guard cascade described in
`src/modules/autonomy/workflows/AGENTS.md` then loses its enforcement
on the affected adapter.

## Desired Outcome

A new `src/rails-cross-harness.integration.test.ts` exists at the root
integration tier alongside the existing `*-cross-harness.integration.test.ts`
files. It iterates every registered `AgentHarness` (currently
`claude-agent-sdk`, `openai-tools`, `thin`) and asserts the same three
rails for each:

- A `canUseTool` callback that returns `{ behavior: "deny", message: "..." }`
  must block the tool from running and route the denial back into the
  agent's tool-result stream so the agent can adapt. A bare `deny`
  (no `interrupt: true`) must NOT abort the session — this is the
  contract `createAgentCommitGuard` relies on.
- `allowedTools` must restrict the harness to exactly the listed tools.
  An attempt to call a tool that is not on the allow list must surface
  the same denial signal as `canUseTool`.
- `disallowedTools` must block the named tools regardless of any
  allow-list overlap, and the denial must propagate back to the agent.

The test mocks the underlying model client / SDK executor so it does
not consume real LLM budget — the same `vi.mock("#core/model/model-client.js")`
+ `vi.mock("#modules/claude-agent-harness/executor.js")` pattern the
existing two cross-harness tests already use is the correct shape.
Each adapter gets one test block per rail, and the assertions are
identical across adapters so a regression in one harness fails one
adapter's block while the others stay green — the test surfaces which
rail and which adapter is broken.

The agent-harness `AGENTS.md` gains one short line under the existing
"Every adapter must honor `canUseTool`, `mcpServers`, and tool allow/
deny lists" sentence pointing at `rails-cross-harness.integration.test.ts`
as the contract enforcer, so a future adapter author finds the gate
they have to clear without reading the whole module tree.

## Constraints

- One file at the root integration tier: `src/rails-cross-harness.integration.test.ts`.
  Do not split per-adapter; the parity claim is exactly that the same
  contract holds across every registered adapter, so the assertions
  must run inside one shared loop or one shared describe.each over the
  registered harness list.
- Reuse the existing mocking pattern from `hooks-cross-harness.integration.test.ts`.
  Do not stand up a new test fixture infrastructure or a new model-client
  abstraction.
- The test must not consume real LLM budget. Mock the model client and
  the SDK executor; the test exercises the harness adapter's
  rails-handling code path, not the model.
- Do not modify the `AgentHarness` protocol or the registered adapters
  themselves except to fix any rail violation the new test surfaces.
  If an adapter is found to violate a rail, fix the adapter as part of
  the same task and record the fix in the task's commit message.
- Do not add a new `*-cross-harness.integration.test.ts` for any other
  property in this task; cross-harness coverage for additional surfaces
  (mcpServers, abortController propagation, hook ordering across rails)
  is out of scope and belongs in follow-up tasks.
- Honor `src/AGENTS.md`'s root layout rule: cross-subsystem integration
  tests live at the root, named `*-cross-harness.integration.test.ts`,
  and core tests must not import from `#modules/*` — this test lives at
  the root, so module imports are allowed.
- Follow the file-size guideline (~300 lines). If the natural shape of
  the test exceeds that, split shared helpers into a sibling test-only
  helper file rather than inflating the integration test.

## Done When

- `src/rails-cross-harness.integration.test.ts` exists and asserts the
  three rails (canUseTool denial propagation, allowedTools enforcement,
  disallowedTools blocking) against every registered `AgentHarness`.
- The test runs as part of `pnpm test` on the standard test gate. Every
  adapter passes every rail; if any adapter is found to violate a rail,
  the adapter is fixed in the same task.
- `src/core/agent-harness/AGENTS.md` gains one line pointing at the new
  test file as the contract enforcer.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` are green at the
  project root.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T20-31-10-955Z-explorer-sgy0m2/` after the
harness-parity scenarios pack landed its fifth fixture
(`rename-across-files`, commit 4cdfcd19). The recent done queue is
dominated by harness-parity scenario fanout (4 of the last 5 commits
are scenario or scenario-seeding work). Continuing in that thread
collapses the queue into one repeated kind of local work, which
explorer's `AGENTS.md` rules out.

The pivot target is the agent-harness rails contract — a property the
autonomy module's prompt-hierarchy and `createAgentCommitGuard` design
explicitly depends on, but which today has no cross-adapter test.
Adding parity coverage here protects KOTA's safety rails against silent
regressions when a new harness adapter lands or when an existing one
changes its tool-handling code path. The `hooks-cross-harness` and
`prompt-input-cross-harness` files already establish the integration-tier
parity pattern; this task extends it to rails.

## Initiative

Agent-harness rails conformance: KOTA's autonomy mode, approval-queue,
agent-commit-guard, and daemon-host-control-guard all depend on every
registered `AgentHarness` honoring the canUseTool / allowedTools /
disallowedTools contract identically. The cross-harness integration
tier already covers hooks and prompt-input parity; rails parity is the
remaining surface that today only has per-adapter coverage. Closing
this gap turns "every adapter honors the rails" from an `AGENTS.md`
assertion into a `pnpm test` failure on regression.

## Acceptance Evidence

- Diff covering `src/rails-cross-harness.integration.test.ts` (new) and
  the one-line `AGENTS.md` pointer at it.
- `pnpm test` output showing the new test file's blocks pass for every
  registered harness (`claude-agent-sdk`, `openai-tools`, `thin`).
- If any adapter required a rail fix, the commit message names the
  violation and the file the fix lives in.
- A short note under the run directory recording, for each adapter,
  which code path the new test exercises (e.g. "thin: adapter.ts
  applyToolGate", "openai-tools: adapter.ts dispatchTool",
  "claude-agent-sdk: executor.ts canUseTool option") so a future
  contributor can see the rails surface each adapter exposes without
  rereading every adapter.
