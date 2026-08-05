# Step Executors

This directory owns step execution strategies and context construction.

- `step-executor.ts` is the entry point: it dispatches to the correct step type
  handler and exports shared helpers (`shouldRunStep`, `resolveValue`,
  `executeCodeStep`).
- Each `step-executor-<type>.ts` implements one step type strategy (agent,
  approval, branch, foreach, parallel, retry classification, trigger).
- `step-context.ts` constructs `WorkflowStepContext`; workflow-owned judges,
  reviewers, and resolvers use `ctx.runAgentHarness` for capacity, cancellation,
  workflow tracing, and live scope authority. Direct native harness calls carry
  that authority into fail-closed capability preflight before process launch.

New step types add a new strategy file here and a dispatch case in
`step-executor.ts`.

## Per-Phase Files Inside `step-executor-agent.ts`

The agent step internals split by phase, not by step kind. The orchestrator
(`step-executor-agent.ts`) owns run-attempt orchestration and the whole-step
writeScope contract; everything else is a phase file:

- `step-executor-agent-prompt.ts` — trigger, exposed output, ask-owner, and JSON prompt blocks.
- `step-executor-agent-capability.ts` — pre-launch harness capability artifact.
- `step-executor-agent-attempt.ts` — harness dispatch, idle-timeout handling,
  JSON-output feedback, and runtime failure classification.
- `step-executor-agent-telemetry.ts` — tool telemetry and its run artifact.
- `step-executor-agent-trajectory-diagnostics.ts` — advisory process-quality
  artifact derived from KOTA-native message frames.
- `step-executor-agent-tool-scope.ts` — autonomy-mode → allowed/disallowed
  tool decisions (autonomous, supervised, passive).
- `step-executor-agent-json.ts` — fenced extraction, JSON/schema errors, and validation.

New internals land in phase files. The orchestrator keeps harness dispatch,
classified retries, and write-scope enforcement; phase-only helpers stay local.
Native attempt cancellation and restrictive-policy invalidation use the shared
agent-harness lifecycle described in `src/core/agent-harness/AGENTS.md`.

## Per-Run Emitted-Events Log

`createStepContext` wraps `ctx.emit` so every emission a step makes appends
a `{event, schemaRef, payload, emittedAt}` entry to
`<runDir>/emitted-events.jsonl`.
This is the authoritative per-run bus-event trace: the bus itself does not
retain history, and step output only captures emissions the step chose to
list in its returned summary. The eval-harness `run-emits-event` and
`run-omits-event` predicates inspect this file directly. Callers that need
to assert on what a workflow emitted should read the log, not the step's
self-report.

## Agent writeScope: declare → enforce → fail

Every `AgentDef` declares a `writeScope` of allowed repo paths. `[]` means
unrestricted; `"deny-all"` means read-only. Silence never means write-anywhere.

Restricted and deny-all scopes compare content-and-index-aware pre/post
snapshots, including paths already dirty before the step. Unrestricted scope
uses lightweight mutation-path attribution because it has no rejection
boundary. An out-of-scope mutation throws `AgentWriteScopeViolationError` and
records the paths in the step artifact. This hard failure consumes no retry.
Deny-all restores the exact pre-step index and worktree; other scopes retain
the normal dirty-recovery path.

This enforcement lives in the core executor, not in per-workflow prompts or
repair checks. Workflows declare scope honestly on their agent definitions
and let the runtime reject out-of-scope writes uniformly.

## Per-Step Harness-Specific Options

The neutral `WorkflowAgentStep` shape has no harness-specific fields. A step
that needs a non-default posture on a particular harness declares the
carve-out through the generic `harnessOptions` passthrough:

```ts
{ type: "agent", harness: "claude-agent-sdk",
  harnessOptions: { "claude-agent-sdk": { /* adapter-private fragment */ } },
  ... }
```

The block is a single-key record whose key must equal the step's resolved
harness name; the value is opaque to core and validated by that harness's
registered `validateStepOptions` method. The validated fragment travels to
the adapter at runtime through `AgentHarnessRunOptions.harnessOverrides`.
The core validator rejects mismatched keys, unknown harnesses, and harnesses
that declare no per-step options. See `src/core/agent-harness/AGENTS.md` for
the protocol surface.

## Resolved Harness And Model On Agent Step Results

Every successful agent step records the harness identifier the registry
actually returned (`resolveAgentHarness(step.harness).name`) and the model
the adapter ran with (`resolveAgentModel(step, agentConfig)`) on the
top-level `WorkflowStepResult`. These fields are populated only for agent
steps — non-agent step results omit them. The static `workflow.json` step
config keeps `model`/`effort` for pre-run introspection; consumers
surfacing harness identity (CLI run readouts, tracing) should prefer the
runtime values on the step result over re-deriving them from the static
config.

## Structured Agent Output

`outputSchema` is the single contract for JSON agent output. The core prompt
builder renders that schema for the agent, and the executor validates the same
object after extraction. Do not duplicate schema fields in workflow prompts or
silently default missing fields after validation.

## Agent-Step Retry and Error Classification

Every agent step inherits `DEFAULT_AGENT_STEP_RETRY` from
`step-executor-retry.ts`. Add a per-step `retry:` override only when a step
has a genuinely different requirement and justify it with a comment.

Retries consume attempts only for classified transient failures (rate-limit,
auth, provider 5xx/timeouts, socket errors), JSON output extraction errors
(missing fence or invalid JSON), and JSON-schema validation errors. Runaway-agent
subtypes (`error_max_turns`, `error_max_tokens`), malformed tool calls, and
other deterministic mistakes are **unclassified**: the step fails on the first
attempt without burning budget or triggering agent-dispatch backoff.

Classification is driven by structured signals (SDK result subtype, HTTP
status, Node error codes, and narrow SDK-specific text markers). See
`classifyAgentRuntimeFailure` for the full signal table. Do not add broad
fuzzy string matches to the classifier. The same classifier governs autonomy
agent judges; see `src/modules/autonomy/AGENTS.md` for the judge-wrapper rule
that protects repair loops from runaway-judge throws.

The repair-loop's own agent invocation (`executeRepairAgentIteration` in
`../repair-loop.ts`) classifies SDK `isError` results through the same path:
when the SDK exhausts its internal retries on a provider 5xx, it throws a
non-retryable `AgentStepRuntimeError` so the run-executor surfaces a
classified backoff signal to `AgentBackoffManager`. Without this, a
provider outage during repair leaks as a plain `Error` and the dispatcher
fires the next agent workflow into the same saturated provider.
