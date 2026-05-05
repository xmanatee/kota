---
id: task-split-step-executor-agent-into-per-phase-sibling-f
title: Split step-executor-agent into per-phase sibling files
status: ready
priority: p1
area: core
summary: Split src/core/workflow/steps/step-executor-agent.ts (603 lines) into per-phase sibling files (prompt build, tool scoping, telemetry, JSON extraction) so the orchestrator drops well under the 300-line guideline
created_at: 2026-05-05T23:53:05.179Z
updated_at: 2026-05-05T23:53:05.179Z
---

## Problem

`src/core/workflow/steps/step-executor-agent.ts` is 603 lines — the largest
non-test file in `src/core/` after the recent McpServer
(`mcp-server.ts` 841 → 197), ModuleLoader (`module-loader.ts` 814 → split
across per-load-phase siblings), and Daemon (`daemon.ts` 666 → 215) splits
collapsed the previous-largest architectural anchors. The file packs
five distinct concerns into one module:

- **Prompt build** (lines 104–194). `shouldExposeOutput`,
  `getExposedStepOutputs`, and `buildAgentPrompt` together own the
  trigger-event header, exposed-step-output block formatting, ask-owner
  surfacing, and JSON-output trailer. Prompt construction is the only
  reason these helpers exist; they have no other call sites in the file
  besides `executeAgentStep`.
- **Tool telemetry** (lines 196–249). `makeToolTelemetryTracker` and
  `writeToolTelemetryArtifact` own the per-tool start/finish accounting,
  the pending-call map, the error-message truncation, the empty-call
  short-circuit, and the `<runDir>/steps/<stepId>.tool-telemetry.json`
  serialisation. Telemetry is independent of prompt build, tool scoping,
  and JSON extraction.
- **Tool scoping** (lines 251–329). `includeAskOwnerTool`,
  `excludeAskOwnerTool`, the `PASSIVE_ALLOWED_TOOLS` whitelist,
  `resolvePassiveAllowedTools`, and `resolveAgentToolScope` together own
  every autonomy-mode → allowed/disallowed tool decision (autonomous,
  supervised, passive). The five names appear nowhere else in the file
  besides one call inside the run-attempt closure.
- **Run-attempt orchestration** (lines 331–562). `executeAgentStep` mints
  the prompt, builds the system prompt, snapshots pre-step mutated paths,
  runs the agent through `runAgentHarness`, classifies `isError` results
  and thrown exceptions through `classifyAgentRuntimeFailure`, drives the
  retry loop with the classifier predicate, writes the telemetry artifact
  on success, and finishes by enforcing `writeScope` against the diff.
  This is the orchestration body — every other helper in the file is a
  delegate it calls.
- **JSON output extraction** (lines 564–603). `JsonSchemaValidationError`
  and `extractJsonOutput` own the fenced-block regex, the `JSON.parse`
  failure path, and the `validatePayloadSchema` integration for steps
  with `outputFormat: "json"`. JSON extraction is an output-shape
  concern, not an orchestration concern.

The file is the largest non-test file in `src/core/` today and the
shape repeats the same monolith pattern the recent McpServer / ModuleLoader
/ Daemon splits already addressed for their respective subsystems. The
sibling directory already establishes the per-step-kind seam
(`step-executor-approval.ts`, `step-executor-await-event.ts`,
`step-executor-branch.ts`, `step-executor-foreach.ts`,
`step-executor-parallel.ts`, `step-executor-trigger.ts`,
`step-executor-retry.ts`, `agent-write-scope.ts`) — agent-step internals
are the only step kind that bundles prompt build + telemetry + tool
scoping + run orchestration + JSON extraction into one file instead of
splitting by phase.

## Desired Outcome

`src/core/workflow/steps/step-executor-agent.ts` is a thin orchestrator:
the public surface (`AgentStepResult`, `AgentStepConfig`,
`WorkflowStepOutput`, the `AgentStepRuntimeError` /
`classifyAgentRuntimeFailure` / `DEFAULT_AGENT_STEP_RETRY` / `withRetry`
re-exports), the `resolveAgentModel` and `resolvePromptContextStartDir`
helpers used at orchestration time, and the `executeAgentStep` function
itself. The orchestrator delegates each phase to a per-phase sibling file
in the same directory (builder picks the exact partition; this names the
shape, not the seam). The intended seam is per phase, not arbitrary:

- `step-executor-agent-prompt.ts` — prompt build. Owns
  `shouldExposeOutput`, `getExposedStepOutputs`, `buildAgentPrompt`, and
  any exposed-output / trigger-payload formatting. The orchestrator calls
  `buildAgentPrompt(definition, step, metadata, trigger, projectDir,
  priorStepOutputs, askOwnerToolName)` once.
- `step-executor-agent-telemetry.ts` — tool telemetry. Owns
  `makeToolTelemetryTracker(telemetry, onMessage)` and
  `writeToolTelemetryArtifact(stepId, metadata, projectDir, telemetry)`.
  The orchestrator instantiates one `ToolTelemetry` per step, threads
  `makeToolTelemetryTracker` into `runAgentHarness` when the harness
  emits an agent-message stream, and calls
  `writeToolTelemetryArtifact` on success.
- `step-executor-agent-tool-scope.ts` — tool scoping. Owns
  `includeAskOwnerTool`, `excludeAskOwnerTool`, `PASSIVE_ALLOWED_TOOLS`,
  `resolvePassiveAllowedTools`, and the public
  `resolveAgentToolScope(mode, allowedTools, disallowedTools,
  askOwnerToolName)` entry point. The orchestrator calls
  `resolveAgentToolScope` once per attempt to derive the
  `runAgentHarness` allowed/disallowed lists.
- `step-executor-agent-json.ts` — JSON output extraction. Owns
  `JsonSchemaValidationError` and `extractJsonOutput(stepId, text,
  outputSchema)`. The orchestrator calls `extractJsonOutput` only when
  `step.outputFormat === "json"` and re-throws the
  `JsonSchemaValidationError` so the existing retry classifier picks it
  up.
- `step-executor-agent.ts` — orchestration. Owns
  `executeAgentStep`, `resolveAgentModel`, `resolvePromptContextStartDir`,
  the `AgentStepResult` / `AgentStepConfig` / `WorkflowStepOutput` types,
  and the existing re-exports of `AgentStepRuntimeError`,
  `classifyAgentRuntimeFailure`, `DEFAULT_AGENT_STEP_RETRY`, and
  `withRetry`. The orchestrator stays under the 300-line guideline
  (target: ≤ 250 lines).

The split is per phase, not arbitrary. Each new file has one reason to
change (one phase concern) and one set of dependencies. The orchestrator
calls each phase function once and is no longer the home for any helper
that exists solely to support a single phase.

## Constraints

- Keep agent-step behaviour byte-identical for every observable
  surface. Prompt text, the trigger-payload block, the exposed-step
  block format, the ask-owner sentence, the JSON-output trailer
  sentence, the tool-telemetry artifact path
  (`<runDir>/steps/<stepId>.tool-telemetry.json`) and JSON shape (the
  `summary` plus per-tool `calls`/`successes`/`failures`/`totalMs`/
  `avgMs`/`lastError` fields), the passive-mode unsafe-tool error text
  ("Passive agent steps may only allow read-only tools; disallowed
  here: …"), the supervised-mode error text ("Workflow agent steps
  cannot use supervised autonomyMode because tool calls cannot be
  routed through KOTA approvals"), the JSON-extraction error text
  ("…outputFormat is \"json\" but no fenced JSON block was found in
  the response", "…outputFormat is \"json\" but the fenced block
  contains invalid JSON"), and the writeScope-violation artifact and
  thrown error all stay unchanged.
- Existing tests in `src/core/workflow/steps/` and the wider
  `src/core/workflow/` test surface must pass without edits to
  assertions about agent-step behaviour, log-line text, or artifact
  output.
- Use plain functions. Do not introduce a parallel `BasePhase`
  abstraction, a phase registry, or a second public DSL. The
  orchestrator is the one entry point and per-phase files expose
  typed functions it calls.
- The `JsonSchemaValidationError` class is part of the public retry
  classifier surface (the `shouldRetry` predicate inside
  `executeAgentStep` checks `instanceof JsonSchemaValidationError`).
  Keep it exported from the new JSON file and re-exported from the
  orchestrator if any external consumer imports it from
  `step-executor-agent.ts` today. No alias re-export, deprecation
  shim, or compatibility comment — verify imports first, then commit
  to a single canonical export site.
- The pre-step `listWorkflowMutatedPaths` snapshot, the post-step
  diff, and the `findWriteScopeViolations` /
  `writeWriteScopeViolationArtifact` / `AgentWriteScopeViolationError`
  pipeline stay in the orchestrator. WriteScope enforcement is the
  whole-step contract, not a phase, and lives where the
  `runAgentHarness` call site can pair pre/post snapshots without
  threading them through helpers.
- The `runAgentHarness` call, the `AgentStepRuntimeError`
  classification of `isError` results, and the retry loop with the
  classifier-driven `shouldRetry` predicate stay in the orchestrator.
  Run-attempt orchestration is the whole reason the file exists.
- No backwards-compatibility shim, alias re-exports, deprecated
  function stubs, or "moved to X" comments. Delete the old definitions
  cleanly. Importers across the repo update to the new home (or keep
  importing from the orchestrator if it re-exports the symbol).
- Drop ad-hoc cleanup (e.g. unused imports, redundant intermediate
  variables) the split exposes. Do not leave dead code in the
  orchestrator.
- Per the "simplest, clearest, most maintainable final system" rule,
  prefer a larger cohesive change over a partial split that leaves a
  half-divided agent step executor. Split every clearly-owned phase
  in this task, not just the two or three biggest ones.

## Done When

- `wc -l src/core/workflow/steps/step-executor-agent.ts` reports
  ≤ 250 lines.
- Each new sibling phase file is at or under the 300-line
  guideline. No new file ships at >300.
- `pnpm test` passes against the full repo test suite with no edited
  assertions about agent-step behaviour, prompt text, telemetry
  artifact shape, tool-scoping errors, JSON-extraction errors, or
  writeScope-violation artifacts.
- `pnpm typecheck` and the lint gate pass.
- `src/core/workflow/steps/AGENTS.md` is updated to name the
  per-phase file convention as the way new agent-step internals
  land — one file per phase (prompt build, telemetry, tool scoping,
  JSON extraction), dispatched from the central
  `step-executor-agent.ts`. The orchestrator-vs-phase boundary
  (run-attempt orchestration and writeScope enforcement stay in
  `step-executor-agent.ts`; everything else is a phase file) is
  named so future contributors do not reintroduce the monolith.
- A short `wc -l src/core/workflow/steps/step-executor-agent*.ts`
  snapshot before / after ships in the run directory so the size
  collapse is visible.

## Source / Intent

Identified by explorer run
`2026-05-05T23-50-56-745Z-explorer-ptpuw4` after the Daemon class split
(`task-split-daemon-class-into-per-lifecycle-phase-handle.md`, done
2026-05-05) collapsed the previous-largest-file anchor in `src/core/`
(`daemon.ts` 666 → 215 via per-lifecycle-phase sibling files). With
that anchor done, the next-largest non-test file in `src/core/` is
`src/core/workflow/steps/step-executor-agent.ts` at 603 lines — a
single file that bundles prompt build + tool telemetry + tool scoping +
run-attempt orchestration + JSON extraction in one body and accretes
another helper or branch on every workflow-runtime migration. Three
strategic blocked alternatives all carry operator-only preconditions
(operator-capture for coding-task parity artifact, capability-installed
for auth-walled source access, operator-capture for the rich CLI
rendering peer-CLI comparison) and cannot be unblocked autonomously;
this task is autonomously actionable, beats them on
"available next step" grounds, and continues the recent direction of
shrinking the largest architectural anchors toward the 300-line
guideline. The sibling directory already establishes the
per-step-kind seam (`step-executor-approval.ts`,
`step-executor-await-event.ts`, `step-executor-branch.ts`,
`step-executor-foreach.ts`, `step-executor-parallel.ts`,
`step-executor-trigger.ts`, `step-executor-retry.ts`,
`agent-write-scope.ts`), so a per-phase sub-split for the agent step
fits the directory's existing convention rather than introducing a new
one.

## Initiative

Module-first / core-shrinking architecture: the agent-step phases are
naturally per-concern, the directory already established
`step-executor-<kind>.ts` and `agent-write-scope.ts` as the split
convention, and this task brings the largest remaining
`src/core/` anchor in line with the rest of the directory. Ongoing
workflow-runtime migrations (harness extension, autonomy-mode
posture, exposed-step-output formats, JSON-output schemas) make the
per-phase seam load-bearing, not cosmetic — the next migration cluster
will rebuild the same monolith without it.

## Acceptance Evidence

- `wc -l src/core/workflow/steps/step-executor-agent*.ts` snapshot
  before and after the split, captured to the run directory under
  `.kota/runs/<run-id>/step-executor-agent-wc.txt`, showing
  `step-executor-agent.ts` ≤ 250 lines and every new sibling file
  ≤ 300.
- The full `src/core/workflow/` test surface passes with no
  assertion edits about agent-step behaviour, prompt text, telemetry
  artifact shape, tool-scoping errors, JSON-extraction errors, or
  writeScope-violation artifacts. Test transcript captured at
  `.kota/runs/<run-id>/test.txt`.
- `pnpm typecheck` transcript at `.kota/runs/<run-id>/typecheck.txt`.
