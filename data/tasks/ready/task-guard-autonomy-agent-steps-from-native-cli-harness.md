---
id: task-guard-autonomy-agent-steps-from-native-cli-harness
title: Guard autonomy agent steps from native CLI harnesses that cannot enforce KOTA tool rails
status: ready
priority: p1
area: architecture
summary: Ensure autonomy agent steps cannot run through native CLI harnesses that bypass KOTA tool guardrails.
created_at: 2026-05-14T04:02:55.300Z
updated_at: 2026-05-14T04:02:55.300Z
---

## Problem

KOTA's shipped default preset is now `codex`, and autonomy workflows resolve
`AUTONOMY_AGENT_HARNESS` from the active preset. The workflow agent-step
executor and autonomy judge path both pass `canUseTool:
createWorkflowAgentGuards()` into every harness run, relying on the
`AgentHarness` protocol contract that adapters either honor guardrails or fail
loudly.

That contract is not currently true for native CLI harnesses. The
`gemini-cli` adapter explicitly rejects `canUseTool` and documents that it is
not an autonomous-builder-equivalent until a guarded tool-control path exists.
The `codex` adapter also shells through a native CLI that owns its tool loop,
but its unsupported-options list and `rejectUnsupportedOptions()` path do not
reject `canUseTool`, `allowedTools`, or `disallowedTools`. Under the current
default preset, a mutating autonomy workflow can therefore run with
commit/daemon-control rails only in prompt text instead of through KOTA's
tool gate.

The cross-preset and live harness-parity tasks are blocked on operator
captures, so they cannot be the first line of defense for this invariant.
KOTA needs a deterministic local guard before any more parity evidence is
trusted.

## Desired Outcome

Autonomy agent steps and autonomy judges refuse to spawn through a harness
that cannot enforce the required KOTA tool rails. Native CLI harnesses remain
available for the surfaces they honestly support, but prompt-only rails are
not silently treated as equivalent to KOTA-enforced `canUseTool` guardrails
for autonomous code-writing workflows.

The adapter declarations, readiness reports, workflow preflight behavior, and
local `AGENTS.md` guidance all agree on the boundary: either a harness routes
KOTA tool calls through `canUseTool`, or it rejects guardrail-dependent runs
before any model process starts.

## Constraints

- Do not add a parallel harness capability matrix. Extend or consume the
  existing `AgentHarness` declaration/readiness/unsupported-option surfaces.
- Do not branch on harness names in the step executor or critic. Branch on a
  protocol-level capability or explicit unsupported option declared by the
  adapter.
- Preserve native `codex` and `gemini-cli` harnesses for supported headless or
  passive use. The fix is an honest boundary, not removing the adapters.
- If a native CLI now exposes a structured pre-tool approval or policy hook
  that can honor `canUseTool`, implement that adapter seam and test it. If it
  cannot, reject the guardrail-dependent options loudly.
- Keep tests deterministic with fake adapters or fake CLI output. No live
  provider auth or network calls are required.
- Do not route this through cost or latency trade-offs. The invariant is
  guardrail correctness.

## Done When

- `codex-agent-harness` either honors `canUseTool` / allowed-disallowed tools
  through a real Codex CLI control surface, or rejects those options loudly
  and reports them in readiness unsupported options. Silent ignore is gone.
- `gemini-cli` and any other native CLI harness that cannot honor KOTA's tool
  gate reports the same boundary through the shared readiness surface.
- Workflow agent steps and autonomy judges fail fast, before spawning a native
  CLI process, when a guardrail-dependent autonomous run resolves to a harness
  that rejects the required tool-control options.
- The shipped default autonomy path cannot silently run a mutating builder,
  explorer, decomposer, improver, inbox-sorter, or pr-reviewer step with only
  prompt-level commit/daemon-control rails.
- Focused tests cover: the Codex adapter boundary, a generic step-executor
  preflight against a fake unsupported harness, the autonomy judge path, and a
  guardrail-capable harness still receiving `canUseTool`.
- `src/core/agent-harness/AGENTS.md` and the native CLI harness `AGENTS.md`
  files remain true after the change.

## Source / Intent

Explorer run `2026-05-14T04-00-23-275Z-explorer-scnh5l` found no actionable or
backlog work. The strategic blocked alternatives were all real
operator-capture blockers:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

This task is chosen instead of more capture work because local source evidence
shows a prerequisite invariant is weaker than the blocked parity tasks assume:
`src/core/workflow/steps/step-executor-agent.ts` and
`src/modules/autonomy/critic.ts` pass `canUseTool`, while
`src/modules/codex-agent-harness/adapter.ts` does not honor or reject it and
`src/modules/gemini-cli-agent-harness/AGENTS.md` already names the same
native-CLI boundary. The watchlist snapshots for Codex and Gemini CLI also
show these native CLI surfaces are active harness targets, so the boundary is
strategic rather than theoretical.

## Initiative

Harness-preset migration: make non-Claude autonomy honest before relying on
cross-preset parity artifacts.

## Acceptance Evidence

- Unit/integration test output showing the Codex/native-CLI unsupported
  guardrail path, the generic workflow-step preflight, and the autonomy judge
  path are covered without live provider calls.
- A `kota doctor --preset codex --skip-connectivity` or equivalent
  readiness-rendering fixture/transcript shows unsupported tool-control
  options when the native CLI path cannot honor them.
- A negative test proves a guardrail-capable harness still receives and applies
  `canUseTool` instead of the preflight blocking all non-Claude adapters.
