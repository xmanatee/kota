---
status: done
---

# Deny destructive shell teardown commands in workflow agent guards

## Problem

KOTA's core tool-runner already classifies destructive command patterns as
dangerous and routes them through the guardrails/approval path. Workflow agent
steps, however, also pass shell calls through the harness-neutral
`canUseTool` boundary so SDK-hosted agents can receive immediate denials for
commands that must never be attempted inside an autonomous run.

That workflow-agent guard stack currently blocks direct `git commit`, daemon
host-control commands, and dependency bootstrap commands. It does not deny
other teardown commands before the SDK shell sees them, including:

- `git reset --hard`, `git checkout -- .`, and `git clean -fd`;
- `git commit --amend` when the workflow commit step owns commits; and
- infrastructure teardown commands such as `terraform destroy`,
  `pulumi destroy`, or `cdk destroy`.

In a workflow step that uses a native SDK shell with autonomous permission
posture, relying on prompt guidance or later task validation is too late. The
same harness-neutral guard boundary that blocks direct commits should also
block irreversible local teardown and infrastructure destroy attempts before a
tool call runs.

## Desired Outcome

Workflow agent runs deny a focused set of destructive shell teardown commands
through `createWorkflowAgentGuards()` and feed the denial back as a normal tool
result, not as a session-aborting interrupt.

The guard should cover both SDK `Bash` calls and KOTA-routed `shell` calls so
the same behavior applies across tool-loop adapters that honor `canUseTool`.
It should reuse or align with the existing destructive-command classification
where practical, while keeping workflow-specific messaging clear about why the
autonomous agent cannot discard local work, amend workflow-owned commits, or
destroy infrastructure from inside the run.

## Constraints

- Keep the implementation in the harness-neutral guard path owned by
  `src/core/agent-harness/guards.ts`, or in a narrow shared helper imported by
  that path and existing guardrails tests. Do not add a second approval queue or
  a provider-specific Claude-only patch.
- Preserve the existing workflow finish protocol: `git add`, `git status`,
  `git diff`, and writing `<run-dir>/commit-message.txt` must remain allowed.
- Keep `git reset --mixed HEAD` available to KOTA's own deterministic commit
  helper if it is executed outside the agent `canUseTool` path; this task is
  about agent-originated shell calls.
- Do not block benign read-only Git inspection commands such as `git status`,
  `git log`, `git diff`, `git show`, or `git rev-parse`.
- Keep denials non-interrupting. The agent should see a denied tool result and
  adapt instead of losing the workflow session.
- Avoid a brittle full shell parser. Cover direct commands and simple chained
  forms using the same bounded pattern style already used by
  `isGitCommitCommand` and daemon-control guards.

## Done When

- `createWorkflowAgentGuards()` denies SDK `Bash` and KOTA `shell` calls for
  `git reset --hard`, `git checkout -- .`, `git clean -fd`, and
  `git commit --amend`.
- The guard denies direct and simply chained infrastructure teardown commands:
  `terraform destroy`, `pulumi destroy`, and `cdk destroy`.
- Denials use `behavior: "deny"` without `interrupt: true` and include a clear
  message that the workflow agent cannot discard local work or destroy
  infrastructure from inside an autonomous run.
- Existing allowed workflow commands still pass, including `git add -A`,
  `git status`, `git diff --staged`, and ordinary test/typecheck/lint commands.
- Focused tests cover direct `Bash`, KOTA `shell`, chained commands, benign Git
  commands, and the existing commit/daemon/package guards to prove they still
  compose in the expected order.
- Cross-harness guard application tests continue to prove adapters either honor
  `canUseTool` or reject unsupported tool-control options before launch.

## Source / Intent

Explorer run `2026-06-22T15-35-14-432Z-explorer-hgl9ns` saw a strategic
ready-coverage gap: the only actionable ready task was a `p3` core source-size
cleanup, no backlog tasks existed, and the strategic blocked alternatives were
still gated on operator-captured evidence.

Blocked alternatives considered:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` live eval capture.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` live eval
  capture.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires
  all-registered-harness `.kota/runs/harness-parity-*` captures.

External source checked:

- `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`
  currently lists Claude Code 2.1.185 as latest and, in 2.1.183, records
  improved auto-mode safety for destructive Git commands, commit-amend
  handling, and infrastructure destroy commands. KOTA should not copy Claude
  Code's permission system, but the failure shape maps to KOTA's own
  workflow-agent `canUseTool` boundary: autonomous SDK shell calls need a
  deterministic pre-execution denial for local-work and infrastructure
  teardown.

Local overlap check:

- `task-approval-gates-for-consequential-actions` and the current
  `src/core/tools/guardrails-classify.ts` path cover KOTA tool-runner
  classification and approval queueing for destructive commands, but they do
  not add a workflow-agent `canUseTool` denial for SDK shell calls.
- `task-harden-shell-working-directory-guardrails-against-` and
  `task-gate-shell-environment-overrides-in-tool-guardrails` harden command
  authority classification, not the workflow-agent guard stack.
- `createWorkflowAgentGuards()` in `src/core/agent-harness/guards.ts` already
  blocks direct workflow commits, daemon host control, and package bootstrap
  commands. This task extends that same boundary instead of adding a parallel
  safety surface.

## Initiative

Autonomous workflow safety: workflow agents should not be able to discard local
work, mutate workflow-owned commits, or tear down infrastructure through the
same shell channel used for ordinary implementation and verification.

## Acceptance Evidence

- Focused test transcript for `src/core/agent-harness/guards.test.ts` showing
  destructive Git and infrastructure destroy denials plus benign Git allow
  cases.
- Cross-adapter or workflow run-option test transcript showing workflow agent
  steps still receive `createWorkflowAgentGuards()` through the neutral
  `canUseTool` route.
- `pnpm run validate-tasks` passes after the task is completed.
- Diff review shows the guard uses a bounded command-pattern helper, preserves
  non-interrupting denials, and does not add provider-specific permission
  logic.
