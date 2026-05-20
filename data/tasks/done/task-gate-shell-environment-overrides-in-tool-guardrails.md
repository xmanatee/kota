---
id: task-gate-shell-environment-overrides-in-tool-guardrails
title: Gate shell environment overrides in tool guardrails
status: done
priority: p2
area: modules
summary: Parse leading environment-variable assignments in shell/process commands and gate authority-changing overrides through guardrails so env-based credential, routing, telemetry, or KOTA-control changes cannot bypass approval policy.
created_at: 2026-05-20T00:09:12Z
updated_at: 2026-05-20T00:18:54Z
---

## Problem

KOTA's shell and background-process tools run commands through the shared
guardrails classifier, but the classifier treats the command as plain text and
only escalates known destructive command patterns. It does not parse leading
environment-variable assignments such as `AWS_PROFILE=prod command`,
`GITHUB_TOKEN=... command`, `KOTA_PROJECT_DIR=/other/project command`, or
`OTEL_EXPORTER_OTLP_ENDPOINT=... command`.

That leaves a policy gap: an agent can change the authority, target project,
provider credentials, telemetry destination, or runtime posture of a command
without tripping a distinct guardrail reason unless the remaining command text
also matches an existing destructive regex. In non-interactive autonomous
contexts, moderate shell/process calls are allowed by default, so env-based
authority changes need their own deterministic classification.

## Desired Outcome

Shell/process guardrails parse command-leading environment overrides before
risk classification. The classifier distinguishes benign presentation or test
knobs from authority-changing overrides and escalates the latter to dangerous,
with a reason that names the env-var class without echoing sensitive values.

The same helper should cover `shell` and `process`, and future execution tools
should reuse it rather than duplicating string checks. If implementation needs
an allowlist, keep it narrow and named in code; do not make every unknown env
assignment safe by default.

## Constraints

- Keep this at the guardrails / execution-module boundary. Do not add a
  second approval system or tool-specific confirmation path.
- Parse only the leading shell environment assignment prefix; do not attempt a
  full shell parser unless the repo already has one suitable for this use.
- Never log or return assigned values in diagnostics, test snapshots, run
  artifacts, or approval prompts.
- Treat credential, token, profile, endpoint, project-root, preset, harness,
  permission, and telemetry-routing variables as authority-changing unless a
  narrower explicit exception is justified in code.
- Preserve common benign uses such as `NO_COLOR=1`, `FORCE_COLOR=0`,
  `CI=1`, or `KOTA_RENDERER_THEME=ascii` when they do not alter authority or
  routing.
- Do not weaken the existing destructive command pattern checks; env override
  classification is additive.

## Done When

- `classifyRisk("shell", ...)` and `classifyRisk("process", ...)` escalate
  leading authority-changing env assignments to `dangerous` even when the
  command body is otherwise innocuous.
- The guardrail reason names the class of override, not the assigned value.
- Tests cover credential/token variables, provider/profile variables, KOTA
  control variables, telemetry endpoint variables, a benign presentation
  override, and a command where env override detection and existing destructive
  command detection both remain active.
- The shell/process execution path still receives ordinary environment
  variables needed for normal operation; this task changes gating, not runtime
  env inheritance policy.
- No durable docs are updated unless the user-facing guardrail behavior needs a
  narrow module-level convention note.

## Source / Intent

Explorer run `2026-05-20T00-06-25-021Z-explorer-hwqaca` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Gate shell environment overrides in tool guardrails" --state ready --area modules --priority p2 --summary "Parse leading environment-variable assignments in shell/process commands and gate authority-changing overrides through guardrails so env-based credential, routing, telemetry, or KOTA-control changes cannot bypass approval policy."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://github.com/anthropics/claude-code/releases` v2.1.145 notes a fix
  for a permission-prompt bypass involving bare assignments to non-allowlisted
  environment variables in Bash commands. KOTA should not copy Claude Code's
  permission system, but the failure shape maps directly to KOTA's
  guardrails classifier.

Local evidence:

- `src/core/tools/guardrails-classify.ts` escalates shell/process calls by
  matching destructive command regexes, but it does not parse leading
  environment assignments.
- `src/modules/execution/shell.ts` and
  `src/modules/execution/process-core.ts` spawn `sh -c <command>` with the
  process environment inherited, so assignment prefixes are interpreted by the
  shell at execution time.
- `src/core/tools/guardrails.ts` allows moderate shell/process calls by
  default, including in non-interactive policy. Dangerous calls are the tier
  that queues for approval in autonomous contexts.

## Initiative

Tool-risk boundary hardening: command authority should be classified from the
actual shell semantics that will run, not only from the visible command verb.

## Acceptance Evidence

- Focused test transcript for guardrail classification, for example
  `pnpm test src/core/tools/guardrails.test.ts`.
- Negative tests show fake credential values are never echoed in diagnostics.
- Diff review shows one shared parser/helper for shell/process env overrides,
  no new tool-specific confirmation path, and no broad compatibility shim that
  treats unknown assignment names as safe.
