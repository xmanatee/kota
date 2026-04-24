---
id: task-enforce-the-neutral-protocol-boundary-in-core-with
title: Enforce the neutral-protocol boundary in core with an import guard (Stage 6)
status: done
priority: p2
area: architecture
summary: Implement Stage 6 of the Anthropic SDK type-surface audit: add no-anthropic-imports-in-core guard, upgrade src/core/agent-harness/AGENTS.md to the stronger claim, and add one-line adapter-seam notes to each translating module's AGENTS.md.
created_at: 2026-04-24T06:57:19.793Z
updated_at: 2026-04-24T07:08:02.154Z
---

## Problem

Stages 1–5 of `src/core/agent-harness/anthropic-type-audit.md` have landed.
Every load-bearing tool, message, thinking, and model-response type inside
`src/core/` now speaks the KOTA-owned neutral protocol
(`KotaTool`, `KotaToolInputSchema`, `KotaMessage` + block variants,
`KotaThinkingConfig`, `KotaModelResponse`, `KotaModelUsage`,
`KotaStopReason`, `KotaMessageStream`). `src/modules/model-clients/anthropic.ts`
is the only file in the repo that still imports `@anthropic-ai/sdk` to
satisfy a core contract; every other model-client, agent-harness, and
mcp-server module speaks the neutral types.

What the audit still lacks is a loud failure mode. "Nothing in core imports
`@anthropic-ai/sdk`" is currently a soft claim: a future edit can silently
reintroduce an `Anthropic.*` type into `src/core/` and nothing will stop it
until a reviewer notices. The audit explicitly reserves Stage 6 for
promoting the boundary to an enforced invariant. Two ancillary surfaces
also still point at the Stage-0 world:

- `src/core/agent-harness/AGENTS.md` describes the ownership target in
  terms of what is *still* in flight ("Tool shapes are now `KotaTool` /
  `KotaToolInputSchema` in `message-protocol.ts`; message/thinking shapes
  follow in later stages.") rather than the post-Stage-5 reality.
- The translating module `AGENTS.md` files
  (`claude-agent-harness`, `model-clients` + `model-clients/openai`,
  `openai-tools-agent-harness`, `thin-agent-harness`, `mcp-server`) do
  not state, in their own local scope, that they own the translation
  responsibility at the adapter seam. The one-line statements the audit
  asks for are the durable place for that contract.

## Desired Outcome

The core neutral-protocol claim is an enforced invariant and the
documentation layer matches the post-Stage-5 reality:

- A mechanical import guard under `src/core/agent-harness/` fails loudly
  if any file under `src/core/` imports `@anthropic-ai/sdk` (type import,
  value import, `vi.mock`, or dynamic import). The guard is the canonical
  place future contributors learn the rule; adding a fresh
  `Anthropic.*` import to a core file turns the tree red.
- `src/core/agent-harness/AGENTS.md` states the stronger post-Stage-5
  claim directly — *nothing in core treats Anthropic's SDK type surface
  as its internal protocol* — and cross-references
  `anthropic-type-audit.md` as the historical record. The transitional
  wording ("tool shapes are now neutral; message/thinking shapes follow
  in later stages") disappears because every stage has landed.
- Each translating module names its adapter-seam responsibility in one
  sentence in its local `AGENTS.md`: `model-clients/anthropic` owns
  `KotaMessage`/`KotaTool`/`KotaThinkingConfig`/`KotaModelResponse` ↔
  Anthropic SDK translation; `model-clients/openai` owns the
  `KotaMessage`/`KotaTool` ↔ OpenAI chat-completion translation;
  `claude-agent-harness`, `openai-tools-agent-harness`, and
  `thin-agent-harness` own `KotaTool` ↔ native-loop translation (or
  declare no tool loop for thin); `mcp-server` owns `KotaTool` ↔ MCP
  translation.

## Constraints

- The guard lives under `src/core/agent-harness/` as
  `no-anthropic-imports-in-core.test.ts` (name pinned by the audit).
  It walks `src/core/**/*.ts` from the filesystem at test time — the
  same pattern `src/module-deps.test.ts` uses — and asserts no file
  contains an import/require/`vi.mock` referencing `@anthropic-ai/sdk`.
  Do not implement this as a lint rule or a biome override: the audit
  wants a loud, discoverable unit test, not a silent lint configuration.
- The guard must recognize `import` (type and value), `require(...)`,
  `vi.mock("@anthropic-ai/sdk", ...)`, and dynamic `import(...)` forms.
  The current test-side `vi.mock("@anthropic-ai/sdk", ...)` in
  `src/core/tools/autonomy-mode-boundary.integration.test.ts` is
  load-bearing for that test today; the guard lands alongside the
  removal of that mock (the surrounding test already mocks
  `createModelClient` and `streamMessage`, so the SDK module is never
  loaded). Removing the stale mock is part of this task, not a
  follow-up.
- The audit's cosmetic references to `@anthropic-ai/sdk` inside
  `anthropic-type-audit.md` and the existing `AGENTS.md` are ignored
  by the guard via an extension filter (`.ts` only). Do not add an
  allowlist that could smuggle a real code import past the guard.
- `src/core/agent-harness/AGENTS.md` is updated in the same PR as the
  guard so the stronger claim and the enforcement land together. No
  transitional "now that stages have landed" note — rewrite the
  ownership-target paragraph in its final form and drop the
  stage-in-flight hedges.
- Module `AGENTS.md` additions are exactly one sentence each, scoped to
  the adapter-seam responsibility. Do not duplicate the audit's prose;
  do not enumerate every translation helper the module exports; do not
  restate the core-side claim — link, do not copy.
- No test-only production flag, no optional guard knob, no compat shim.
  If a core file legitimately needed to import `@anthropic-ai/sdk` in
  the future, the right response is to widen the neutral protocol, not
  to add an allowlist.
- No scope creep into module-side cleanups beyond what Stage 6 names.
  The five existing `@anthropic-ai/sdk` references in
  `src/modules/**` — `model-clients/anthropic.ts` (production seam),
  `model-clients/anthropic.test.ts` (seam test),
  `doctor/index.ts` (operator-facing runtime-capability check), and the
  `code-exec.test.ts` string literal — are out of scope. This task is
  about the core boundary.

## Done When

- `src/core/agent-harness/no-anthropic-imports-in-core.test.ts` exists
  and fails with a clear message that names the offending file and
  offending import form when any `src/core/**/*.ts` file imports,
  requires, dynamically imports, or `vi.mock`s `@anthropic-ai/sdk`.
  The test passes on the final commit with no allowlist entries.
- `src/core/tools/autonomy-mode-boundary.integration.test.ts` no longer
  carries the `vi.mock("@anthropic-ai/sdk", …)` block and the test
  still passes — confirmation that the mock was already unreachable
  once the surrounding `createModelClient` / `streamMessage` mocks
  were in place.
- `src/core/agent-harness/AGENTS.md` is rewritten to state the
  stronger post-Stage-5 claim (*nothing in core treats the Anthropic
  SDK type surface as its internal protocol*), cross-references
  `anthropic-type-audit.md` as the historical record, and drops the
  "tool shapes are now neutral; message/thinking shapes follow in
  later stages" hedge. No migration wording remains.
- Each of `src/modules/claude-agent-harness/AGENTS.md`,
  `src/modules/model-clients/AGENTS.md` (plus a line inside the file
  describing `model-clients/anthropic.ts` explicitly),
  `src/modules/model-clients/openai/AGENTS.md` (create if missing),
  `src/modules/openai-tools-agent-harness/AGENTS.md`,
  `src/modules/thin-agent-harness/AGENTS.md`, and
  `src/modules/mcp-server/AGENTS.md` carries exactly one sentence
  naming its adapter-seam translation responsibility
  (`KotaTool`/`KotaMessage`/`KotaThinkingConfig`/`KotaModelResponse`
  ↔ native wire shape, whichever apply to that module).
- `src/core/agent-harness/anthropic-type-audit.md` is updated to mark
  Stage 6 as landed and to drop the "Follow-up tasks" item that seeded
  this task, the same pattern Stages 2–5 used.
- Repo typechecks and the full test suite pass green on the final
  commit of the PR.
