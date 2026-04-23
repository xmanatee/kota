---
id: task-move-claude-sdk-shaped-step-fields-permissionmode-
title: Move claude-SDK-shaped step fields (permissionMode, settingSources) off the neutral workflow agent-step type
status: done
priority: p2
area: architecture
summary: WorkflowAgentStep still types permissionMode and settingSources directly from @anthropic-ai/claude-agent-sdk wire types (SDKPermissionMode, SDKSettingSource); pass them through a harness-specific options carve-out so the neutral step protocol no longer advertises claude-only fields.
created_at: 2026-04-23T22:13:58.727Z
updated_at: 2026-04-23T22:34:11.223Z
---

## Problem

The agent-harness neutrality work made `autonomyMode` the canonical
supervision field, added `effort` as the canonical reasoning control, moved
the Claude-SDK executor into the adapter module, and wired openai-tools / thin
adapters through the registry. Two claude-SDK-only fields still live on the
neutral `WorkflowAgentStep` and `WorkflowAgentStepResolved` types in
`src/core/workflow/types.ts`:

- `permissionMode: SDKPermissionMode`
- `settingSources?: SDKSettingSource[]`

Both are imported directly from `@anthropic-ai/claude-agent-sdk` through
`src/core/agent-harness/sdk-types.ts`, and both are behaviorally claude-SDK-
only:

- `settingSources` is "a claude-agent-sdk concept" per
  `validate-agent-step.ts`; the openai-tools and thin adapters reject it at
  the boundary.
- `permissionMode` is the claude-SDK's permission-gate enum (`default` /
  `acceptEdits` / `dontAsk` / `bypassPermissions`); `autonomyMode` already
  describes the neutral supervision posture and the autonomy workflows only
  ever set `permissionMode: "bypassPermissions"` through `AgentDef.tools`.

Because both fields are typed on the neutral step shape, every autonomy
workflow definition carries them, the validator imports the claude wire
types into core (`validate-agent-step.ts`, `types.ts`), the run-store
helpers thread them through, and adapters that cannot honor them re-check
and reject at their boundary. This keeps the workflow protocol coupled to
the claude-agent-sdk's wire shape and contradicts the
`src/core/agent-harness/AGENTS.md` intent that "only the claude-agent-
harness adapter constructs values of this shape."

## Desired Outcome

- `WorkflowAgentStep` and `WorkflowAgentStepResolved` in
  `src/core/workflow/types.ts` no longer reference `SDKPermissionMode` or
  `SDKSettingSource`. The neutral shape keeps `autonomyMode`, `effort`,
  `allowedTools`, `disallowedTools`, and the output-format fields.
- Claude-SDK-specific per-step passthrough (for the rare step that needs to
  override the adapter's defaults) lives in a harness-specific options
  field — e.g. an opaque `harnessOptions?: Record<string, unknown>` that the
  claude adapter reads and every other adapter is free to ignore or reject,
  or an explicit `claudeAgentSdk?: { permissionMode?: ...; settingSources?: ...; }`
  on the adapter's own options shape. Pick one mechanism and document it;
  do not ship both.
- The claude-agent-harness adapter owns the default-to-`bypassPermissions`
  and default-to-`["project"]` behavior that the autonomy workflows rely on.
  Autonomy workflow definitions stop restating these fields when the defaults
  already match.
- The workflow step validator no longer imports claude wire types. Validation
  of any per-harness override flows through the harness registry (harnesses
  that advertise support for the override validate it; harnesses that do not
  reject it loudly, as they already do).
- The core run-store helpers (`run-store-helpers.ts`) and repair-loop paths
  stop threading `settingSources` / `permissionMode` as typed fields on the
  step record they persist or resume.

## Constraints

- Keep the behavior of the claude-agent-sdk harness identical for autonomy
  workflows. The adapter's existing default (`settingSources: ["project"]`,
  `permissionMode: "bypassPermissions"`) must still take effect unless the
  step's harness-specific options override it.
- Do not introduce a second adapter-capability registry. Neutral step fields
  should go through the existing harness registry; claude-specific options
  should be an adapter-scoped concept.
- `thinkingEnabled` / `thinkingBudget` are already semi-subsumed by `effort`
  and already rejected by openai-tools; leaving those fields where they are
  is acceptable for this task. If the same passthrough mechanism naturally
  absorbs them, include them; otherwise call out the remaining leak in a
  follow-up task rather than expanding scope.
- No behavior change to the openai-tools or thin adapters' existing
  rejection of these options.
- `settingSources` continues to match `SDKSettingSource`'s three allowed
  values ("project" / "local" / "user") at the adapter boundary; do not
  broaden the set while moving it.
- Do not touch the `SDKMessage` run-store stream in the same task — that is
  a separate leak with a different blast radius. This task is scoped to
  per-step options.

## Done When

- `src/core/workflow/types.ts` has no `import ... from "#core/agent-harness/sdk-types.js"` and no `SDKPermissionMode` / `SDKSettingSource` uses.
- `src/core/workflow/step-validators/validate-agent-step.ts` no longer
  validates `permissionMode` / `settingSources` against claude-SDK enums
  directly on the neutral step shape.
- `src/modules/claude-agent-harness/adapter.ts` is the single place that
  reads and applies these per-step options, via the agreed passthrough.
- Every autonomy workflow definition keeps its effective behavior (a
  `pnpm build` + `pnpm test` run is green, and the harness-parity scenarios
  continue to exercise both claude and openai-tools adapters end-to-end).
- `src/modules/openai-tools-agent-harness/autonomy-harness-neutral.integration.test.ts`
  still passes; the neutral-step story now lives up to its name because
  the step record handed to a non-claude adapter no longer carries claude
  wire-typed fields.
- The scoped `AGENTS.md` files (`src/core/agent-harness/AGENTS.md`,
  `src/modules/claude-agent-harness/AGENTS.md`, and
  `src/core/workflow/steps/AGENTS.md` if it mentions these fields) are
  updated to describe the new passthrough, with no stale references to
  claude-SDK-typed step fields.
