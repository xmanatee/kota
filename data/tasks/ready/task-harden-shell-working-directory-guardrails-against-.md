---
id: task-harden-shell-working-directory-guardrails-against-
title: Harden shell working-directory guardrails against cwd and cd escapes
status: ready
priority: p2
area: modules
summary: Classify shell working-directory changes that leave the project as dangerous, covering the explicit cwd input and simple directory-changing command prefixes so execution context cannot bypass project/root guardrails.
created_at: 2026-05-25T04:08:23.195Z
updated_at: 2026-05-25T04:08:23.195Z
---

## Problem

KOTA's guardrails now classify leading authority-changing environment
assignments in `shell` and `process` commands, including project/root
overrides such as `KOTA_PROJECT_DIR=...`. The execution surface still has a
nearby gap: `shell` accepts an explicit `cwd` input and also runs arbitrary
`sh -c` command text, but `classifyRisk("shell", ...)` only inspects the
command string for destructive patterns and leading env assignments.

That means a call like `shell({ command: "pwd", cwd: "/tmp" })` or a simple
directory-changing prefix such as `cd /tmp && ...` can move command execution
outside the project without receiving the same project/root risk treatment as
file tools or env-based project overrides. The shell runner will execute the
custom cwd if it exists; the guardrail boundary is where this should be
classified.

## Desired Outcome

Shell working-directory changes that leave the active project are classified
as dangerous before execution. The behavior covers the tool's explicit `cwd`
input and deterministic directory-changing command prefixes that KOTA can
recognize without pretending to implement a full shell interpreter.

Commands that remain inside the project keep their current risk posture, and
normal command output/error-context behavior is unchanged.

## Constraints

- Keep the change at the guardrails / execution-module boundary. Do not add a
  second approval system or a shell-specific confirmation path.
- Treat the explicit `cwd` input as structured data; validate it with path
  resolution rather than string matching.
- For command text, cover only clear directory-changing prefixes such as
  `cd <path> &&`, `pushd <path> &&`, or similarly deterministic POSIX shell
  forms already compatible with KOTA's `sh -c` runner. Do not add a brittle
  full-shell parser.
- KOTA's execution module currently uses POSIX `sh`, not PowerShell. Do not
  add Windows/PowerShell support as part of this task unless the runtime path
  already exists.
- Do not weaken the existing env override, destructive command, or file-path
  outside-project checks.
- Do not leak full outside paths in approval reasons when a class-level reason
  is enough.

## Done When

- `classifyRisk("shell", { command, cwd })` escalates an absolute or resolved
  `cwd` outside the active project to `dangerous` with a project/root-style
  reason.
- A `cwd` inside the active project remains no more restrictive than the same
  command without `cwd`.
- Simple directory-changing command prefixes that resolve outside the project
  are classified as dangerous before execution.
- Simple directory-changing command prefixes that resolve inside the project
  remain allowed at the baseline shell risk.
- Tests prove the existing environment-override and destructive-command checks
  still fire alongside the new working-directory checks.
- `shell` runtime behavior still rejects nonexistent `cwd` values and still
  enriches relative error paths against the command's working directory.

## Source / Intent

Explorer run `2026-05-25T04-05-44-416Z-explorer-tddge0` reviewed a thin queue
with zero actionable ready/doing tasks. The strategic blocked alternatives
were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal checked:

- `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md` now lists
  fresh permission/sandbox fixes after the previously stored watchlist
  snapshot, including directory-change permission bypasses and sandbox
  write-allowlist fixes. KOTA should not copy Claude Code's permission system,
  but the failure shape maps to KOTA's own execution guardrail boundary:
  command authority must include where the command runs, not only the visible
  command verb.

Local evidence:

- `src/core/tools/guardrails-classify.ts` classifies shell/process commands
  from the command string and leading environment assignments; it does not
  inspect `input.cwd`.
- `src/modules/execution/shell.ts` accepts `cwd`, verifies only that it exists,
  and passes it to `spawn("sh", ["-c", command], { cwd })`.
- `src/modules/execution/shell.test.ts` intentionally proves `/tmp` cwd works,
  but no guardrail test marks outside-project cwd as dangerous.
- `data/tasks/done/task-gate-shell-environment-overrides-in-tool-guardrails.md`
  already covers env-based project/root overrides, so this task is the sibling
  working-directory hardening rather than a duplicate.

## Initiative

Tool-risk boundary hardening: execution authority should be classified from
the actual project context in which the command will run, not only from the
shell text.

## Acceptance Evidence

- Focused test transcript for the affected boundary, for example
  `pnpm test src/core/tools/guardrails.test.ts src/modules/execution/shell.test.ts src/modules/execution/shell-pipeline.test.ts`.
- Diff review shows one shared path-resolution helper or equivalent guardrail
  logic, no new approval surface, and no compatibility shim that treats
  outside-project execution as ordinary moderate shell work.
