---
id: task-split-workflowvalidationts-into-per-concern-siblin
title: Split workflow/validation.ts into per-concern sibling files
status: done
priority: p1
area: core
summary: Collapse src/core/workflow/validation.ts (497 lines) into a thin dispatcher plus per-concern sibling files (workflow shape checks, step-id collection, restart-step constraints, trigger self-loop checks, definition assembly) so each file owns one concern, matching the per-concern sibling split pattern that landed for the surrounding daemon and workflow-runtime clusters.
created_at: 2026-05-06T02:48:48.421Z
updated_at: 2026-05-06T02:59:19.134Z
---

## Problem

`src/core/workflow/validation.ts` is now the largest non-test, non-types
file in `src/core/` at 497 lines after the recent McpServer (841 → 197),
ModuleLoader (814 → split), Daemon (666 → 215), step-executor-agent
(603 → 249), WorkflowRuntime (591 → split), run-store-helpers (527 →
split), and daemon-control-chat (453 → split) anchors collapsed.
The file bundles five orthogonal concerns into one declaration:

- Step-type dispatcher (`validateStep`, lines ~46–130): a routing
  function that dispatches to the per-step-type validators already
  living in `validation-steps.ts`. Pure dispatch, no validation logic
  of its own.
- Workflow registration helpers (`registerWorkflowDefinition`,
  `describeContribution`, lines ~132–155): tiny wrappers used during
  module loading.
- Top-level workflow shape and step-id checks (lines ~162–260 inside
  `validateWorkflowDefinitions`): name uniqueness across contributing
  modules, non-empty triggers/steps, `defaultAutonomyMode` validation,
  and `collectStepIds` recursion across `parallel` / `branch` /
  `foreach` step trees for global step-id uniqueness.
- Restart-step constraints (lines ~262–323): single-restart rule, last-
  step position, required-step references resolve, type-compatibility
  for required steps (tool/code/parallel only).
- Trigger-step self-reference plus cross-workflow checks (lines ~325–
  358): trigger steps cannot reference their own workflow; warnings for
  unknown referenced workflows and for `waitFor: "queued"` paired with
  an `outputSchema`.
- Definition assembly (lines ~360–497): the inline IIFEs that build
  `webhookRateLimit`, `notify`, `tags`, the `triggers` array (with the
  `workflow.completed` self-loop check via `matchesFilter`), and the
  `runtime.recovered` ↔ `recoveryCapable` consistency check.

The shape repeats the architectural-anchor pattern explorer keeps
finding across `src/core/`: one file accreting orthogonal validation
concerns over time. The neighbour `validation-primitives.ts`,
`validation-steps.ts`, and `validation-trigger.ts` siblings already
establish the per-concern naming convention; the remaining concerns in
`validation.ts` map cleanly onto new siblings of the same shape.

## Desired Outcome

`validation.ts` shrinks to a thin orchestrator (well under 200 lines)
that imports per-concern siblings and re-exports the public surface
(`validateWorkflowDefinitions`, `registerWorkflowDefinition`,
`WorkflowDefinitionError`, `WorkflowValidationOptions`). New focused
siblings own each concern:

- `validation-step-dispatch.ts` — `validateStep` (the type dispatcher)
  and the `WorkflowStepInput` → step-type routing logic. Pure dispatch
  to `validation-steps.ts`.
- `validation-shape.ts` — top-level workflow-shape checks: name
  uniqueness across contributing modules (with `describeContribution`),
  triggers/steps non-empty, `defaultAutonomyMode` validation, and
  `moduleRoot` absolute-path enforcement.
- `validation-step-ids.ts` — `collectStepIds` recursion across
  `parallel` / `branch` / `foreach` step trees plus duplicate-id
  detection.
- `validation-restart.ts` — restart-step constraints (single-restart,
  last-step position, required-step reference resolution, type
  compatibility for required steps).
- `validation-trigger-references.ts` — trigger-step self-reference
  rejection, unknown-workflow warnings, and `waitFor: "queued"` +
  `outputSchema` warnings (all about how trigger steps reference other
  workflows; complements the existing `validation-trigger.ts` which
  validates the trigger-event shape itself).
- `validation-assembly.ts` — the per-definition assembly IIFEs
  (`webhookRateLimit`, `notify`, `tags`, the `triggers` array including
  the `workflow.completed` self-loop check via `matchesFilter`, and the
  `runtime.recovered` ↔ `recoveryCapable` consistency check).

`registerWorkflowDefinition` stays in the orchestrator file (it is the
public registration entry point, ~5 lines, no concern of its own).

## Constraints

- One mechanism: continue the existing `validation-*.ts` per-concern
  sibling pattern in `src/core/workflow/`. Do not introduce a new
  directory layer or a parallel validation registry.
- No backwards-compatibility re-export shim beyond the orchestrator
  itself: the orchestrator's public surface
  (`validateWorkflowDefinitions`, `registerWorkflowDefinition`,
  `WorkflowDefinitionError`, `WorkflowValidationOptions`) must stay
  callable from existing import sites without churn, but no parallel
  `validation-shape.ts → validation.ts` re-export aliases.
- Keep public export names unchanged. The split is internal.
- Companion tests follow the code: split or rename
  `validation.test.ts` (and any sibling tests) so each test file
  collocates with its subject (e.g. `validation-shape.test.ts`,
  `validation-step-ids.test.ts`, `validation-restart.test.ts`,
  `validation-trigger-references.test.ts`,
  `validation-assembly.test.ts`). Per-concern coverage stays at
  parity; do not delete tests during the move.
- `src/strict-types-policy-baseline.json` may shift entries from
  `validation.ts` to the new sibling files but must not gain net new
  `unknown` / `Record<string, unknown>` / `as unknown` usages.
- Update `src/core/workflow/AGENTS.md` to name the per-concern
  validation-split convention if it does not already (replace any
  existing `validation.ts` reference rather than appending — the file
  has limited budget).
- No test-only flags or hooks introduced just to make the split
  easier; use existing public APIs.
- Each new sibling stays well under 300 lines.

## Done When

- `src/core/workflow/validation.ts` is reduced to a thin orchestrator
  (< 200 lines) that delegates to the new siblings.
- `validation-step-dispatch.ts`, `validation-shape.ts`,
  `validation-step-ids.ts`, `validation-restart.ts`,
  `validation-trigger-references.ts`, and `validation-assembly.ts`
  exist with the symbol assignments described above; each stays well
  under 300 lines.
- All public callers of `validateWorkflowDefinitions` and
  `registerWorkflowDefinition` continue to work without import-site
  churn; no other module imports the new siblings directly unless that
  module owns a concern that legitimately belongs there.
- `pnpm typecheck` and `pnpm test` pass.
- `src/core/workflow/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) names the per-concern validation-split convention.

## Source / Intent

Continuation of the architectural-anchor split cluster that landed
McpServer (841 → 197 via per-feature handlers), ModuleLoader (814 →
split via per-load-phase handlers), Daemon (666 → 215 via per-lifecycle
siblings), step-executor-agent (603 → 249 via per-phase siblings),
WorkflowRuntime (591 → split via per-lifecycle phases), run-store-
helpers (527 → split via state-schema / legacy-migration / snapshot
siblings), the daemon-control unified route registry, and daemon-
control-chat (453 → split via DaemonChatPool / chat-handlers
siblings) on the most recent autonomy runs. `validation.ts` is now the
next-largest non-test, non-types file in `src/core/` and the largest
remaining workflow-runtime entry point with substantive logic. The
existing `validation-primitives.ts` / `validation-steps.ts` /
`validation-trigger.ts` siblings already establish the per-concern
naming convention, so the split has an established landing pattern.

## Initiative

Minimal-core / module-first architecture: shrink the largest core
files into focused per-concern siblings so each new workflow-validation
rule has a clear landing seam instead of a monolith to grow.

## Acceptance Evidence

- `wc -l` recorded for `validation.ts` (497) before and for the
  orchestrator and each new sibling after, captured in the commit
  message body.
- New file list and per-symbol relocation captured in the commit
  message body.
- `pnpm typecheck` and `pnpm test` transcripts clean (covered by the
  builder repair-loop checks; the commit message references the
  validation gates that ran).
- `grep` search confirming the orchestrator's public surface
  (`validateWorkflowDefinitions`, `registerWorkflowDefinition`) is
  unchanged at every existing import site.
- `src/core/workflow/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) lists the per-concern validation convention.
