---
id: task-move-claudeagentsdk-step-options-carve-out-and-its
title: Move claudeAgentSdk step-options carve-out and its validator out of core into module-contributed harness-step-options
status: done
priority: p2
area: architecture
summary: Lift the claude-SDK-specific step carve-out and hardcoded permission/setting-source enum literals out of the core workflow validator into a module-contributed harness-step-options registry so core workflow types and validation stay fully harness-neutral.
created_at: 2026-04-23T23:22:33.168Z
updated_at: 2026-04-24T02:20:12.943Z
---

## Problem

Recent core-shrinking work moved the Claude Agent SDK executor, query/option
shapes, and per-harness wire types out of core into
`src/modules/claude-agent-harness/`. The last visible leak is inside the
neutral workflow surface itself:

- `src/core/workflow/types.ts` declares `WorkflowClaudeSdkStepOptions` plus a
  `claudeAgentSdk?: WorkflowClaudeSdkStepOptions` field on both the step input
  and resolved step shapes. Core workflow types therefore carry a claude-SDK-
  named key and a claude-specific string-literal union for `permissionMode` and
  `settingSources`.
- `src/core/workflow/step-validators/validate-agent-step.ts` hardcodes
  `CLAUDE_AGENT_SDK_HARNESS_NAME = "claude-agent-sdk"`, the valid
  `permissionMode` set, and the valid `settingSources` set. The comment at
  lines 31–36 explicitly calls this duplication out as a trade-off to keep the
  core validator module-free.

The deliberate duplication was a fine step-1 carve-out, but it blocks the
protocol-oriented core direction: core workflow validation still knows one
specific harness name and enum shape. A second harness that ever wants its
own per-step knobs (e.g. an openai-tools reasoning override, a codex adapter
sandbox flag) has no path to declare them without another copy of the same
pattern in core.

## Desired Outcome

Core workflow types and validation are fully harness-neutral. Harness modules
contribute their own step-options schema at load time, and core dispatches:

- `src/core/workflow/types.ts` drops the `claudeAgentSdk` field and the
  `WorkflowClaudeSdkStepOptions` type. The neutral step shape exposes a single
  discriminated passthrough — e.g. `harnessOptions?: { [harnessName: string]:
  unknown }` — that the core validator routes to a registered harness
  validator.
- The core agent-harness registry gains a contribution surface (for example
  `registerHarnessStepOptions(harnessName, validator)` called by each adapter
  module on load, or an optional `validateStepOptions(raw, context)` method on
  `AgentHarness`) so each harness owns the schema of its own carve-out.
- `src/modules/claude-agent-harness/` registers the existing
  `permissionMode` / `settingSources` validator at the new extension point.
  Existing workflow authors keep using `permissionMode` and `settingSources`
  through whatever neutral spelling this task lands on; the claude-specific
  enum literals live in the claude module.
- `src/core/workflow/step-validators/validate-agent-step.ts` drops
  `CLAUDE_AGENT_SDK_HARNESS_NAME`, `VALID_CLAUDE_SDK_SETTING_SOURCES`, and
  `VALID_CLAUDE_SDK_PERMISSION_MODES`. The validator only checks: when a step
  declares harness-specific options, the option key matches the resolved
  harness, and the registered harness's validator accepts the payload.
- Every existing shipped workflow that currently sets `claudeAgentSdk: {...}`
  migrates to the new spelling in the same change.
- Repo AGENTS.md guidance that talks about `claudeAgentSdk` (notably
  `src/core/agent-harness/AGENTS.md` §"Per-step harness-specific options")
  is updated to describe the neutral extension point.

## Constraints

- Do not introduce a parallel registry outside `src/core/agent-harness/`.
  Reuse the existing harness registry or extend it; do not teach
  `src/core/workflow/` about harness-specific shapes via a second table.
- Workflow validation runs after modules are loaded
  (`validateWorkflowDefinitions` is invoked at daemon init). Rely on that
  order; do not add a parallel eager-validation path that bypasses module
  contributions.
- Failing to register a validator for a known harness is a loud error, not a
  silent pass-through. A step that references an unknown harness-options key
  fails validation with a clear message naming the registered harnesses.
- Do not re-introduce silent coercion or optional fallback shapes. Absence of
  the options block on a step means "use the harness default"; presence means
  "validate against the registered schema".
- No legacy/shim paths. Delete `WorkflowClaudeSdkStepOptions` and the hardcoded
  enum sets; do not leave type aliases for compatibility. Workflow authors
  migrate in-repo in the same commit.
- Keep this change a type+validator lift. Do not bundle unrelated runtime
  behavior changes (per-harness autonomy mode, tool policy) into the same
  task.

## Done When

- `src/core/workflow/types.ts` contains no `claudeAgentSdk` field,
  `WorkflowClaudeSdkStepOptions` type, or claude-specific enum literal; the
  new neutral passthrough shape is the single documented surface.
- `src/core/workflow/step-validators/validate-agent-step.ts` contains no
  hardcoded harness name, `permissionMode`, or `settingSources` value; it
  dispatches per-step options through the registered harness.
- `src/modules/claude-agent-harness/` registers a step-options validator at
  load that encodes the current permissionMode / settingSources enums and is
  the only place those literals live.
- Every shipped workflow and test fixture that sets per-step claude options
  uses the new spelling. `pnpm -s test` and the integration tests under
  `src/modules/claude-agent-harness/` and `src/core/workflow/` pass.
- A new or updated test covers the "unknown harness-options key" and "options
  against wrong harness" cases with the loud-error message the validator now
  emits.
- `src/core/agent-harness/AGENTS.md` describes the harness-step-options
  extension point; references to `claudeAgentSdk` elsewhere in docs are either
  removed or updated to the new neutral spelling.
