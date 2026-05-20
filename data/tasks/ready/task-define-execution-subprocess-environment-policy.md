---
id: task-define-execution-subprocess-environment-policy
title: Define execution subprocess environment policy
status: ready
priority: p2
area: modules
summary: Route tool-call context into the execution module so shell/process children get explicit KOTA session/tool correlation ids and no longer inherit KOTA-owned telemetry routing accidentally.
created_at: 2026-05-20T01:19:05Z
updated_at: 2026-05-20T01:19:05Z
---

## Problem

KOTA's execution tools currently spawn shell and background-process commands
with `env: process.env`, while registered tool runners receive only the tool
input. `executeToolCalls` knows the active `sessionId` and tool-use block id,
but that context stops at the registry boundary. As a result, scripts launched
through `shell` or `process` cannot reliably correlate themselves with the
KOTA session and tool call that launched them unless some outer process already
set a matching environment variable.

The same full-environment inheritance also sends KOTA-owned telemetry routing
variables such as `OTEL_*` / `OTLP_*` into child commands by default. That can
make an app under test report to KOTA's own collector or otherwise confuse
operator traces. The completed task
`task-gate-shell-environment-overrides-in-tool-guardrails` classifies leading
environment overrides before execution, but it intentionally did not define
the runtime environment inherited by execution subprocesses.

## Desired Outcome

Execution subprocesses have one explicit environment-construction policy. Core
tool dispatch passes typed tool-call context through the registry boundary, and
the execution module uses that context to build child environments for both
foreground shell commands and managed background processes.

The policy should:

- Preserve normal command behavior, including PATH, HOME, package-manager
  environment, and existing operator-provided environment needed by tests.
- Set `KOTA_SESSION_ID` and `KOTA_TOOL_USE_ID` when the tool call has those
  identifiers.
- Avoid inheriting KOTA-owned telemetry-routing variables by default, so child
  apps do not accidentally report into KOTA's tracing pipeline.
- Keep the correlation values out of error messages, approval prompts, and
  diagnostic logs unless explicitly asserted by a test command.

## Constraints

- Put the subprocess environment helper in `src/modules/execution/`; execution
  owns shell/process behavior. Do not add a re-export shim under
  `src/core/tools/`.
- Use a strict typed context object at the tool-runner boundary. Absence of
  `sessionId` or `toolUseId` is allowed only for direct registry calls that
  are genuinely outside an agent session or tool-use block.
- Do not build a general secrets sandbox in this task. Provider credentials and
  operator environment policy are a separate decision; this task is about
  correlation ids and KOTA-owned telemetry isolation.
- Do not duplicate the shell-string environment-assignment parser from
  guardrails. Inline command overrides stay classified by the existing
  guardrail path; the new helper controls the inherited environment.
- Apply the policy to both `shell` and `process`; no parallel env behavior
  between foreground and background execution tools.

## Done When

- Tool runner registration and dispatch can pass a typed execution context from
  `executeToolCalls` into module tool runners without breaking direct
  `executeTool(...)` callers.
- `shell` and `process` children receive `KOTA_SESSION_ID` and
  `KOTA_TOOL_USE_ID` values matching the active tool call when context is
  present.
- `shell` and `process` children do not inherit parent `OTEL_*` / `OTLP_*`
  routing variables unless an explicit, reviewed opt-in is introduced.
- Existing normal shell/process commands still run with the expected cwd, PATH,
  timeout, streaming, and background-process lifecycle behavior.
- Tests cover session/tool id injection, telemetry-env scrubbing, no-context
  direct runner calls, and parity between foreground and background execution.

## Source / Intent

Explorer run `2026-05-20T01-16-10-028Z-explorer-cjxx2r` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Define execution subprocess environment policy" --state ready --area modules --priority p2 --summary "Route tool-call context into the execution module so shell/process children get explicit KOTA session/tool correlation ids and no longer inherit KOTA-owned telemetry routing accidentally."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://github.com/anthropics/claude-code/releases` latest release
  continues to emphasize agent/session operability and tool-span correlation.
- `https://code.claude.com/docs/en/whats-new/2026-w19` states that Claude Code
  now exposes a session id to Bash subprocesses and no longer lets Bash,
  hooks, MCP, and LSP subprocesses inherit `OTEL_*` variables.

Local evidence:

- `src/core/tools/tool-runner.ts` already has `sessionId` and tool-use block
  ids at dispatch time, but calls `executeTool(call.name, call.input)` without
  passing that context to registered runners.
- `src/core/tools/index.ts` defines `ToolRunner` as input-only, so module tool
  implementations cannot consume tool-call context today.
- `src/modules/execution/shell.ts` and
  `src/modules/execution/process-core.ts` spawn `sh -c <command>` with
  `env: process.env`.
- The just-completed env-override guardrail task explicitly scoped itself to
  classification and left runtime env inheritance policy unchanged.

## Initiative

Execution observability and isolation: commands launched by KOTA should be
correlatable to their session and tool call without accidentally becoming part
of KOTA's own telemetry pipeline.

## Acceptance Evidence

- Focused test transcript for the affected boundary, for example
  `pnpm test src/core/tools/tool-runner.test.ts src/modules/execution/shell.test.ts src/modules/execution/process.test.ts`.
- Test fixtures demonstrate `KOTA_SESSION_ID` / `KOTA_TOOL_USE_ID` in child
  env output without logging unrelated environment values.
- Negative tests show inherited `OTEL_*` / `OTLP_*` variables are absent from
  shell and process children by default.
