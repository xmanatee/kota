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

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger must narrow that trigger so it
cannot match its own completion payload. A self-matching completion trigger
creates an infinite loop that hangs the runtime and the test suite. The
validation layer enforces this at definition load time as a hard error.

## Runtime Rails

Timeouts, trigger validation, dirty-worktree recovery, and repair-loop checks
are runtime rails, not prompt policy. Keep workflow code explicit and typed;
keep prompts focused on the agent's role.

## Unit Testing

Each workflow should have a co-located `workflow.test.ts` for `when` predicate
and skip/run logic when that logic is non-trivial. Focus on decisions the
workflow makes, not on agent step content.

If a workflow has no `when` predicates or non-trivial skip logic, a unit test adds little value;
rely on the integration test below instead.

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

## Dirty Failure Recovery

If a workflow fails and leaves the repo dirty, the runtime now treats that as a
recovery condition, not as normal queue progression. The daemon restarts once,
queues any workflows that listen to `runtime.recovered`, and then pauses
dispatch if the same dirty state still cannot be repaired. Do not reintroduce
dirty-worktree bounce loops.

## Finish Protocol

When a workflow agent finishes its work:

- Stage changes with `git add -A`.
- Write a short commit message to `<run-directory>/commit-message.txt`.
- Do not run `git commit` yourself.

Prompts should not repeat these instructions. Workflow-specific finish guidance
(e.g. validation before staging, conditional staging) stays in the prompt.

## Integration Test

`autonomous-loop.integration.test.ts` discovers the autonomy workflow set from this directory. When adding a new workflow here:
- Ensure its trigger and step behavior is safe against the sparse test fixture in that file.
- Confirm the self-trigger loop guard above is satisfied.
