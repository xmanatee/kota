# Workflows

This directory contains the autonomy workflows and their co-located prompts.

- Each workflow should live in its own subdirectory with code plus markdown prompt assets.
- Keep workflows cohesive and typed in code; keep long-lived guidance in markdown.
- Keep role boundaries sharp.
- Keep prompts short. Durable policy belongs here or in nearby docs, not repeated
  in every `prompt.md`.
- `workflow.ts` in each workflow directory is the source of truth for that workflow.
- Workflow modules must default-export their workflow definition. If a workflow
  uses a named agent, export that agent from the same file.
- These workflows are discovered from this directory by the autonomy module. Do not add a separate registry for them.

## Finish Protocol

When a workflow agent finishes its work:

- Stage changes with `git add -A`.
- Write a short commit message to `<run-directory>/commit-message.txt`.
- Do not run `git commit` yourself. The workflow's commit step reads the
  message file and commits after validation gates pass. Running `git commit`
  directly bypasses the repair loop and fails the run.

Prompts should not repeat these instructions. Workflow-specific finish guidance
(e.g. validation before staging, conditional staging) stays in the prompt.

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger must narrow that trigger so it
cannot match its own completion payload. A self-matching completion trigger
creates an infinite loop that hangs the runtime and the test suite. The
validation layer enforces this at definition load time as a hard error.

## Runtime Rails

Timeouts, trigger validation, dirty-worktree recovery, direct-commit
prevention, and repair-loop checks are runtime rails, not prompt policy.
Keep workflow code explicit and typed; keep prompts focused on the agent's
role. Direct-commit prevention lives at the SDK `canUseTool` boundary
(`createAgentCommitGuard`) so rogue `git commit` calls from any workflow
agent fail before producing a commit, rather than being caught post-hoc.

### Autonomy Mode Declaration

Every agent step must declare its session-level autonomy posture explicitly.
The validator rejects agent steps that lack an autonomy mode — there is no
silent default. Declare intent at whichever level keeps the workflow coherent:

- Set `defaultAutonomyMode` on the workflow definition when every agent step
  in the workflow shares the same posture (the common case for autonomy loops,
  which run unattended as `"autonomous"`).
- Set `autonomyMode` on an individual agent step only when that step needs to
  diverge from the workflow default (e.g. a review step that needs human
  supervision in an otherwise autonomous flow).

`autonomyMode` is orthogonal to per-tool risk classification — it sets the
session's supervision posture; tool-level guardrails still apply on top.

### Agent-Step Retry and Error Classification

Every agent step inherits `DEFAULT_AGENT_STEP_RETRY` from
`src/core/workflow/steps/step-executor-retry.ts`. Add a per-step `retry:`
override only when a step has a genuinely different requirement and justify it
with a comment.

Retries consume attempts only for classified transient failures (rate-limit,
auth, provider 5xx/timeouts, socket errors) and JSON-schema validation errors.
Runaway-agent subtypes (`error_max_turns`, `error_max_tokens`), malformed tool
calls, and other deterministic mistakes are **unclassified**: the step fails on
the first attempt without burning budget or triggering agent-dispatch backoff.

Classification is driven by structured signals (SDK result subtype, HTTP
status, Node error codes, and narrow SDK-specific text markers). See
`classifyAgentRuntimeFailure` for the full signal table. Do not add broad
fuzzy string matches to the classifier.

## Unit Testing

Each workflow with non-trivial `when` predicate or skip/run logic should have a
co-located `workflow.test.ts` covering those decisions — not agent step
content. Workflows without such logic rely on the integration test below.

## Routing

Only the `dispatcher` workflow listens to `runtime.idle`. Other autonomy
workflows should trigger on semantic bus events that describe repo state, not
on a fixed workflow graph.

Never add `runtime.idle` as a trigger to a non-dispatcher workflow. If a new
workflow needs periodic polling, add the condition check to the dispatcher and
emit a clearer event.

Prefer explicit bus events over workflow-name inventories or secondary routing metadata.

- If one workflow should wake another, emit a named event that describes the handoff.
- Keep the event semantic: describe what became true, not which workflow just ran.
- Use `workflow.completed` only when the consumer truly cares about generic run
  completion rather than a more specific domain event.
- Queue-shaping events should describe repo state directly. For example, use a
  distinct event for a thin backlog tail instead of overloading `queue.empty`
  or teaching explorer to infer it from unrelated workflow names.

## Repair-Loop Checks

Workflow repair-loop checks should use `type: "code"` with `spawnSync` rather than `tool: "shell"`.
The `shell` tool lives in the execution module and is not guaranteed to be available in every
workflow execution context. `type: "code"` checks run inline in the workflow process and have no
tool-availability dependency.

Do not add repair checks that force exact route, event, enum, or config catalogs
into `docs/`. Those contracts should be enforced by source types and focused
tests; durable docs should stay high-level.

## Dirty Failure Recovery

If a workflow fails and leaves the repo dirty, the runtime now treats that as a
recovery condition, not as normal queue progression. The daemon restarts once,
queues any workflows that listen to `runtime.recovered`, and then pauses
dispatch if the same dirty state still cannot be repaired. Do not reintroduce
dirty-worktree bounce loops.

## Recovery Contract

Every autonomy workflow whose steps can mutate tracked files must participate
in the recovery protocol. A workflow opts in by:

1. Setting `recoveryCapable: true` in its definition.
2. Adding a `runtime.recovered` trigger (the runtime filters recovery dispatch
   to recovery-capable workflows only; the validation layer rejects mismatches).
3. Running a reset step first that brings the worktree back to a safe base
   before anything heavier runs. Use `resetWorktreeForRecovery` from
   `#modules/autonomy/recovery.js` — it stashes tracked dirt and, when asked,
   switches from a `kota/task/*` branch back to the base branch.
4. Gating the workflow's expensive work step (the agent call) so it does not
   run on the recovery trigger. Use the `onNormalTrigger` predicate to skip
   the agent step during recovery; pair it with an existing "skip when dirty"
   guard for a complete safety net. Improver is the exception: its analysis
   runs after stash because its role is evidence review, not task progress.
5. Ensuring the reset step is idempotent and has no network side effects. If
   the first recovery attempt fails, the runtime retries once and then pauses
   dispatch — a network round-trip before the reset would leak side effects
   on every retry.

A workflow that does not mutate tracked files but has a role on crash recovery
(e.g. attention-digest notifying operators) may still declare
`recoveryCapable: true` with a `runtime.recovered` trigger; the reset step can
be omitted, but the workflow must stay idempotent with no pre-reset network
effects. A workflow with neither role leaves `recoveryCapable` unset with a
short comment explaining why (today: `dispatcher`, `pr-reviewer`). When adding
a new autonomy workflow, decide which bucket it falls into deliberately — do
not silently inherit another workflow's recovery posture.
