---
id: task-apply-telemetry-environment-isolation-to-kemp-stdi
title: Apply telemetry environment isolation to KEMP stdio module subprocesses
status: ready
priority: p2
area: core
summary: Make foreign-module stdio subprocesses follow KOTA's explicit environment policy so KEMP modules do not inherit parent OTEL/OTLP routing while still receiving reviewed config.env overrides.
created_at: 2026-05-27T00:44:37.829Z
updated_at: 2026-05-27T00:44:37.829Z
---

## Problem

KOTA already has an explicit subprocess environment policy for the
execution module. Shell, background-process, and `code_exec` children preserve
normal command behavior while avoiding inherited KOTA-owned telemetry routing
such as `OTEL_*` / `OTLP_*`, and the tests prove those children do not pick up
the parent daemon's collector configuration by accident.

KEMP stdio foreign modules are still outside that policy. `StdioTransport` in
`src/core/modules/foreign-module-stdio.ts` starts module subprocesses with
`env: { ...process.env, ...config.env }`. A long-lived Python, Node, or Go
module with OpenTelemetry instrumentation can therefore export into KOTA's own
collector just because the daemon process had OTLP variables configured. That
is the same leakage shape the execution-module policy already fixed, but on the
module lifecycle surface instead of tool execution.

## Desired Outcome

Foreign-module stdio startup uses an explicit core-owned environment policy:

- Inherited daemon environment still preserves normal runtime behavior, such as
  `PATH`, `HOME`, package-manager variables, and provider credentials.
- KOTA-owned telemetry routing and stale tool correlation values are removed
  from inherited environment by default.
- `config.env` is applied after the inherited environment is filtered, so an
  operator can intentionally opt a specific foreign module into its own
  telemetry exporter or pass module-specific settings.
- The behavior is covered by focused tests at the foreign-module stdio
  transport or loader boundary.

## Constraints

- Core must not import `#modules/execution/*`. If the scrub predicate becomes
  shared, move only the tiny policy primitive to a neutral core-owned helper
  and keep the existing execution-module tests aligned with it.
- Do not change the KEMP wire protocol, manifest shape, health messages,
  restart behavior, HTTP transport, or module discovery model.
- Do not build a broad secrets sandbox here. Provider credentials and ordinary
  operator environment values continue to inherit unless they are part of the
  existing KOTA-owned telemetry/correlation policy.
- Keep `config.env` as an explicit opt-in override. A configured `OTEL_*` value
  on the foreign module itself should be passed through because the operator
  named it at the module boundary.

## Done When

- `StdioTransport`-launched KEMP subprocesses no longer inherit parent
  `OTEL_*` / `OTLP_*` variables or parent `KOTA_SESSION_ID` /
  `KOTA_TOOL_USE_ID` by default.
- A test demonstrates that normal inherited values still reach the subprocess
  while KOTA-owned telemetry/correlation values do not.
- A test demonstrates that `config.env` can intentionally supply a module-local
  telemetry value after filtering.
- Existing execution-module environment tests still pass, or are updated to
  use the shared helper if the implementation extracts one.
- `pnpm typecheck`, focused module tests, and task validation pass.

## Source / Intent

Explorer run `2026-05-27T00-42-16-707Z-explorer-h3yddz` found no actionable
queue work. The only backlog tasks depend on
`task-enable-autonomous-access-to-auth-walled-sources-so`, and the strategic
blocked alternatives surfaced by `inspect-queue` are all operator-capture
gated and not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal checked:

- `https://code.claude.com/docs/en/whats-new/2026-w19` records the same
  subprocess isolation pattern for Bash, hooks, MCP, and LSP subprocesses:
  subprocesses should not inherit the CLI's OTEL routing by default.
- `https://code.claude.com/docs/en/monitoring-usage` describes the steady-state
  monitoring posture: spawned subprocesses do not receive the parent OTEL
  exporter settings, while commands that need telemetry set those values
  directly.

Local evidence:

- `data/tasks/done/task-define-execution-subprocess-environment-policy.md`
  completed the execution-module policy for shell and managed process tools.
- `data/tasks/done/task-apply-execution-environment-policy-to-codeexec-rep.md`
  completed the same policy for `code_exec` wrappers and REPL subprocesses.
- `src/modules/execution/execution-env.ts` implements the policy for execution
  subprocesses.
- `src/core/modules/foreign-module-stdio.ts` still uses the daemon environment
  wholesale when spawning KEMP stdio modules.

## Initiative

Subprocess boundary hygiene for module-first extensibility: every long-lived
or agent-launched local subprocess should have an explicit environment policy
instead of accidentally inheriting daemon telemetry routing.

## Acceptance Evidence

- Focused transcript for the foreign-module boundary, for example
  `pnpm test src/core/modules/foreign-module-stdio.test.ts src/core/modules/foreign-module-loader.test.ts`.
- Focused transcript for the existing execution-module environment tests if a
  shared helper is introduced, for example
  `pnpm test src/modules/execution/shell.test.ts src/modules/execution/process.test.ts src/modules/execution/code-exec.test.ts src/modules/execution/custom-tool-integration.test.ts`.
- Transcript of `pnpm typecheck` and `pnpm run validate-tasks -- --min-ready 0`.
