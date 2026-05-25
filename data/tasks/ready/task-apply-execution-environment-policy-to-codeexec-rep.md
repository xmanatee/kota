---
id: task-apply-execution-environment-policy-to-codeexec-rep
title: Apply execution environment policy to code_exec REPL sessions
status: ready
priority: p2
area: modules
summary: Route code_exec, custom_tool, and manifest-code REPL subprocesses through the execution module's explicit environment helper so persistent Python/Node sessions get tool-call correlation ids and stop inheriting KOTA-owned telemetry or credentials by accident.
created_at: 2026-05-25T05:35:52.720Z
updated_at: 2026-05-25T05:35:52.720Z
---

## Problem

`task-define-execution-subprocess-environment-policy` gave `shell` and
`process` one explicit child-environment policy: inject
`KOTA_SESSION_ID` / `KOTA_TOOL_USE_ID` when runner context exists and scrub
KOTA-owned telemetry routing variables by default. `code_exec` was left on
the older path. Its persistent Python and Node REPL sessions still spawn with
`env: process.env` in `src/modules/execution/repl-session.ts`, and the
module-owned `CodeRunner` adapter used by `custom_tool` and manifest-code
tools reuses those same sessions.

That means a high-risk code-execution surface can still inherit KOTA telemetry
configuration, stale KOTA correlation ids, and any operator environment value
the process happened to carry. It also means code-runner calls cannot be
correlated to the active session/tool-use boundary the way foreground shell
and background process commands now can.

This is narrower than adding a cloud sandbox. The immediate gap is that KOTA's
own execution module already has an environment helper and has not applied it
to every subprocess it owns.

## Desired Outcome

All execution-module subprocesses that run agent-authored code share the same
environment policy. `code_exec`, core `custom_tool` execution through the
registered `CodeRunner`, and manifest-code tools that use that runner launch
their persistent Python/Node sessions through the explicit
`buildExecutionEnv(...)` path instead of raw `process.env`.

Fresh REPL sessions receive the active `KOTA_SESSION_ID` and
`KOTA_TOOL_USE_ID` when a tool-runner context exists. They do not inherit
parent `KOTA_SESSION_ID`, parent `KOTA_TOOL_USE_ID`, `OTEL_*`, or `OTLP_*`
values by default. Direct, context-free calls remain supported but scrub
KOTA-owned inherited variables rather than leaking them.

## Constraints

- Keep the implementation inside `src/modules/execution/`; this is module
  subprocess behavior, not a new core primitive.
- Reuse or extend `buildExecutionEnv(...)`. Do not introduce a second
  environment-construction helper for REPLs.
- Preserve persistent REPL behavior by language. If the session context
  changes, the implementation must either restart the affected REPL with the
  new explicit environment or document and test a stricter session ownership
  invariant that prevents cross-session reuse.
- Do not remove normal operator-provided environment needed for local package
  managers, virtualenvs, PATH lookup, or tests.
- Do not build a general network-egress policy or credential broker in this
  task. If the implementation reveals a separate need for egress isolation or
  brokered credentials, open a follow-up task.

## Done When

- `src/modules/execution/repl-session.ts` no longer spawns Python/Node REPL
  subprocesses with raw `process.env`.
- `runCodeExec(...)` passes tool-runner context into the REPL session start
  path, and the registered execution `CodeRunner` has an explicit story for
  context-free custom-tool / manifest-code execution.
- Tests prove `code_exec` receives matching `KOTA_SESSION_ID` /
  `KOTA_TOOL_USE_ID` when context is present and does not inherit parent
  values when context is absent.
- Tests prove `code_exec`, `custom_tool` through the execution module runner,
  and manifest-code execution do not inherit `OTEL_*` / `OTLP_*` values by
  default.
- Existing `code_exec` behavior still works: persistent state by language,
  reset, timeout handling, missing-package hints, plot capture, and direct
  code-runner integration remain covered.
- The execution-module `AGENTS.md` is updated only if the subprocess
  environment contract becomes operator-facing; keep exact env-field behavior
  in code and focused tests.

## Source / Intent

Explorer run `2026-05-25T05-32-34-252Z-explorer-jwpqs1` reviewed a thin queue
with zero actionable ready/doing tasks. The strategic blocked alternatives
were still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal checked:

- `https://vercel.com/docs/sandbox` describes Vercel Sandbox as a compute
  primitive for safely running untrusted/user-generated code for AI agents in
  isolated microVMs.
- `https://vercel.com/kb/guide/run-claude-managed-agent-tools-with-vercel-sandbox`
  and
  `https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox`
  both emphasize keeping credentials out of agent-executed compute and
  injecting them only at a controlled outbound boundary.

Local evidence:

- `src/modules/execution/execution-env.ts` already owns the explicit child
  environment helper used by `shell` and `process`.
- `src/modules/execution/shell.ts` and `src/modules/execution/process-core.ts`
  now use `buildExecutionEnv(context)`.
- `src/modules/execution/repl-session.ts` still spawns persistent Python/Node
  REPLs with `env: process.env`.
- `src/modules/execution/code-runner-adapter.ts` routes core `custom_tool` and
  manifest-code execution through the same persistent REPL sessions.
- Completed task `task-define-execution-subprocess-environment-policy`
  intentionally scoped itself to `shell` and `process`; this task closes the
  remaining execution-module subprocess gap without broadening into full
  sandboxing.

## Initiative

Execution isolation and observability: every subprocess that runs
agent-authored code should have explicit, testable environment inheritance
instead of relying on whatever the daemon process happened to carry.

## Acceptance Evidence

- Focused test transcript for execution environment behavior, for example
  `pnpm test src/modules/execution/code-exec.test.ts src/modules/execution/custom-tool-integration.test.ts src/modules/execution/repl-session.test.ts src/core/tools/tool-runner.test.ts`.
- A small run artifact under `.kota/runs/<run-id>/code-exec-env-policy.txt`
  or equivalent showing the `code_exec` env probe with injected
  `KOTA_SESSION_ID` / `KOTA_TOOL_USE_ID` and absent parent `OTEL_*` /
  `OTLP_*` values.
- Queue validation passes with the new ready task and no stale deletes or
  duplicate ids.
