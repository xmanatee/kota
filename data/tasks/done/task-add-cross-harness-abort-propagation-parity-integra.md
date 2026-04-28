---
id: task-add-cross-harness-abort-propagation-parity-integra
title: Add cross-harness abort propagation parity integration test
status: done
priority: p2
area: architecture
summary: Lock the abort-propagation contract — every registered AgentHarness must honor abortController so operator cancellation and daemon shutdown propagate cleanly — with a single src/abort-cross-harness.integration.test.ts mirroring the existing hooks/prompt-input/rails cross-harness integration tests. Expected to surface and fix a real gap in the thin adapter, which never passes the signal to the model call.
created_at: 2026-04-28T21:15:43.221Z
updated_at: 2026-04-28T21:31:07.333Z
---

## Problem

`src/core/agent-harness/AGENTS.md` declares `AgentHarnessRunOptions.abortController`
as part of the harness-neutral protocol every adapter consumes. The autonomy
module's prompt-hierarchy and recovery contract both depend on aborts
propagating end-to-end: operator cancellation through the control API, daemon
shutdown teardown, and any in-process supervisor that triggers
`abortController.abort()` must terminate the in-flight adapter run rather than
let it hang waiting on the model.

The cross-harness integration tier now covers three parity surfaces:

- `src/hooks-cross-harness.integration.test.ts` — preRun/postRun hooks fire at
  the same points across every adapter.
- `src/prompt-input-cross-harness.integration.test.ts` — `@path` expansion
  runs once before any adapter sees the prompt.
- `src/rails-cross-harness.integration.test.ts` — `canUseTool`, `allowedTools`,
  and `disallowedTools` deny cleanly across every registered harness.

Abort-controller propagation is the load-bearing fourth contract on the same
surface, and was explicitly carved out of the rails task's constraints as a
follow-up: "additional surfaces (mcpServers, abortController propagation, hook
ordering across rails) is out of scope and belongs in follow-up tasks."

A code read of the registered adapters today shows the contract holds for
two adapters but is broken in the third:

- `src/modules/openai-tools-agent-harness/adapter.ts` plumbs
  `abortSignal: options.abortController?.signal` into its OpenAI client and
  ties an inner `AbortController` to the caller's signal so an outer abort
  cancels the in-flight model call.
- `src/modules/claude-agent-harness/` consumes `abortController` through the
  Anthropic SDK options, so the SDK aborts its in-flight query.
- `src/modules/thin-agent-harness/adapter.ts:61–64` checks
  `options.abortController?.signal.aborted` *before* the model call but never
  passes the signal to `resolved.client.messages.create(...)` and never
  attaches a listener to it. A run that aborts mid-call (the realistic
  case — operator cancellation lands while the model is generating, not
  before the request goes out) silently waits for the model to return.

That is precisely the silent-regression shape `*-cross-harness.integration.test.ts`
exists to prevent. There is no test today that fails when `thin` (or any
future adapter) skips abort propagation, so the autonomy mode + recovery +
daemon-shutdown safety story rests on per-adapter unit-test memory rather
than on a `pnpm test` failure.

## Desired Outcome

A new `src/abort-cross-harness.integration.test.ts` exists at the root
integration tier alongside the existing `*-cross-harness.integration.test.ts`
files. It iterates every registered `AgentHarness` (currently
`claude-agent-sdk`, `openai-tools`, `thin`) and asserts the same two
properties for each:

- **Pre-run abort propagation.** When the caller passes an `abortController`
  whose signal is already aborted at `runAgentHarness` time, the adapter must
  reject with the signal's reason (or an `Error` whose message reflects an
  abort), and must not call into the underlying model client. This codifies
  the existing pre-run check on every adapter.
- **Mid-run abort propagation.** When the caller passes a fresh
  `abortController` and aborts it after the adapter has begun the model call
  but before the model returns, the adapter must reject with the signal's
  reason rather than wait for the model. The mocked model client either
  observes the signal (preferred — the test asserts the mock saw an abort
  event or received an aborted signal) or hangs on a never-resolving promise
  the test resolves only on abort, so the only way the adapter returns is by
  honoring the signal.

The test mocks the underlying model client / SDK executor so it does not
consume real LLM budget — the same `vi.mock("#core/model/model-client.js")`
+ `vi.mock("#modules/claude-agent-harness/executor.js")` pattern the
existing three cross-harness tests already use. Each adapter gets one test
block per property, and the assertions are identical across adapters so a
regression in one harness fails one adapter's block while the others stay
green.

The thin adapter is expected to fail the mid-run case under this test as
written. The fix is to thread `options.abortController?.signal` through to
`resolved.client.messages.create({ ..., signal })` — Anthropic and
OpenAI-compatible clients both accept a `signal` option on the create call.
Land the fix as part of the same task, named in the commit message.

The agent-harness `AGENTS.md` gains one short line under the existing
"`canUseTool`, `mcpServers`, and tool allow/deny lists ... `src/rails-cross-harness.integration.test.ts`
enforces parity" sentence pointing at `abort-cross-harness.integration.test.ts`
as the contract enforcer for `abortController`.

## Constraints

- One file at the root integration tier:
  `src/abort-cross-harness.integration.test.ts`. Do not split per-adapter;
  the parity claim is exactly that the same contract holds across every
  registered adapter, so the assertions must run inside one shared loop or
  one shared `describe.each` over the registered harness list.
- Reuse the existing mocking pattern from
  `rails-cross-harness.integration.test.ts`. Do not stand up new test fixture
  infrastructure or a new model-client abstraction.
- The test must not consume real LLM budget. Mock the model client and the
  SDK executor; the test exercises the harness adapter's abort-handling code
  path, not the model.
- Mid-run abort tests must be deterministic. Use a controllable promise (a
  mock that returns a `new Promise((resolve, reject) => { ... })` whose
  rejection is wired to the abort signal, or a model client that exposes a
  test hook to release pending requests) — do not rely on real timers or
  timing-sensitive `setTimeout` races.
- If an adapter is found to violate the contract during the test build (the
  thin adapter is the known case), fix the adapter as part of the same
  task. The fix for the thin adapter is to pass
  `options.abortController?.signal` through to the `messages.create` call,
  which both Anthropic and OpenAI-compatible clients accept. Do not add a
  parallel abort plumbing or a new ModelClient abstraction.
- Do not modify the `AgentHarness` protocol. `abortController` is already a
  protocol field; this task only adds enforcement.
- Do not add a new `*-cross-harness.integration.test.ts` for any other
  property in this task. The two remaining carved-out follow-ups
  (`mcpServers` parity, hook ordering across rails) belong in separate
  tasks if they prove load-bearing.
- Honor `src/AGENTS.md`'s root layout rule: cross-subsystem integration
  tests live at the root, named `*-cross-harness.integration.test.ts`, and
  module imports are allowed at the root tier.
- Follow the file-size guideline (~300 lines). If the natural shape of the
  test exceeds that, split shared helpers into a sibling test-only helper
  file rather than inflating the integration test.

## Done When

- `src/abort-cross-harness.integration.test.ts` exists and asserts both
  properties (pre-run abort rejection, mid-run abort rejection) against
  every registered `AgentHarness`.
- The test runs as part of `pnpm test` on the standard test gate. Every
  adapter passes both properties; the thin adapter's mid-run gap is fixed
  in the same task by threading `signal` to its model-client call.
- `src/core/agent-harness/AGENTS.md` gains one line pointing at the new
  test file as the contract enforcer for `abortController` propagation.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` are green at the project
  root.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T21-10-46-563Z-explorer-6s5bx1/` after the
cross-harness rails parity integration test landed (commit `6331a0ec`,
"Add cross-harness rails parity integration test"). The rails task's
constraints explicitly named abortController propagation as a carved-out
follow-up: "Do not add a new `*-cross-harness.integration.test.ts` for
any other property in this task; cross-harness coverage for additional
surfaces (mcpServers, abortController propagation, hook ordering across
rails) is out of scope and belongs in follow-up tasks." A code read of
the registered adapters confirms the gap is real, not theoretical:
`src/modules/thin-agent-harness/adapter.ts` only checks the abort signal
*before* the model call and never passes the signal into the model
client, so a mid-run abort silently does nothing on that adapter.

The four cross-harness contracts (hooks, prompt-input, rails, abort)
together enforce the load-bearing parity surface every registered
`AgentHarness` must hold. With abort coverage in place, the integration
tier turns "every adapter honors `abortController`" from an `AGENTS.md`
assertion into a `pnpm test` failure on regression — the same shape the
hooks, prompt-input, and rails tests already establish.

## Initiative

Agent-harness contract conformance: KOTA's autonomy mode, recovery
protocol, and daemon-shutdown safety all depend on every registered
`AgentHarness` honoring `abortController` identically. The cross-harness
integration tier now covers hooks, prompt-input, and rails parity; abort
parity is the next load-bearing surface that today only has per-adapter
coverage (and a known gap in the thin adapter). Closing this gap turns
"every adapter honors abort" into a `pnpm test` failure on regression
and removes the silent-regression risk for operator cancellation and
daemon teardown.

## Acceptance Evidence

- Diff covering `src/abort-cross-harness.integration.test.ts` (new), the
  thin-adapter fix that threads `signal` to its model-client call, and
  the one-line `AGENTS.md` pointer at the new test.
- `pnpm test` output showing the new test file's blocks pass for every
  registered harness (`claude-agent-sdk`, `openai-tools`, `thin`).
- The commit message names the thin-adapter fix as part of the same
  change so a future contributor can see the gap and the fix together.
- A short note under the run directory recording, for each adapter,
  which code path the test exercises (e.g.
  "thin: adapter.ts messages.create signal threading",
  "openai-tools: adapter.ts abortSignal listener wiring",
  "claude-agent-sdk: executor.ts abortController option") so a future
  contributor can see the abort surface each adapter exposes without
  rereading every adapter.
