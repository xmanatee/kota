---
id: task-apply-protected-git-bare-repository-safety-to-kota
title: Apply protected Git bare-repository safety to KOTA-owned subprocesses
status: done
priority: p2
area: modules
summary: Force KOTA-owned git subprocesses and agent shell git calls through a protected safe.bareRepository=explicit default so nested bare repositories cannot trigger implicit Git hook execution.
created_at: 2026-05-27T01:27:18.712Z
updated_at: 2026-05-27T02:47:00.000Z
---

## Problem

KOTA runs Git from several trusted-looking paths: workflow dirty-state checks,
task branch handling, commit staging, repair/recovery helpers, and agent-visible
shell/process tools. Those calls currently inherit the host Git defaults.

Git's default `safe.bareRepository=all` means a Git command can auto-discover a
bare repository nested inside a checked-out project. A crafted nested bare
repository can carry config and hooks; tools that run `git status` or other
Git commands from that subdirectory can execute attacker-controlled hook code
even when the user or agent only meant to inspect repository state.

KOTA already hardened cwd escape classification for shell commands, but that
does not address Git's own repository discovery once a command runs inside a
project tree.

## Desired Outcome

KOTA-owned subprocesses run Git with a protected `safe.bareRepository=explicit`
default unless a call site deliberately opts into an explicit bare repository
with its own documented reason. The protection applies to both first-party Git
helpers and agent shell/process execution where Git may be invoked directly or
indirectly by prompts, scripts, package managers, or tooling.

The final behavior should make implicit nested bare repository discovery fail
before hooks or bare-repo config can influence the subprocess, while preserving
normal non-bare repository workflows in KOTA's own repo and external projects.

## Constraints

- Do not mutate user global/system Git config. Apply the protection at KOTA's
  process boundary using protected Git configuration such as
  `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*`, or an
  equivalent verified command-scope mechanism.
- Do not set `safe.directory=*`, weaken `safe.directory`, or add a broad trust
  allowlist for arbitrary project paths.
- Do not add a second approval or confirmation path. This is a subprocess
  safety default, not an operator-decision surface.
- Keep legitimate explicit bare-repository use explicit. If KOTA needs a real
  bare repo operation, it should pass `--git-dir` or `GIT_DIR` intentionally and
  keep that exception local to the call site.
- Keep this behavior out of durable docs unless a high-level operator guideline
  changes; the contract belongs in code and focused tests.
- Preserve the existing shell cwd guardrail, dangerous-command classification,
  and workflow dirty-worktree recovery behavior.

## Done When

- A single helper or narrow shared boundary applies
  `safe.bareRepository=explicit` to KOTA-owned subprocess environments without
  relying on the user's Git config.
- First-party Git subprocesses used by workflow dispatch/recovery, autonomy
  commit staging, task branch handling, and repo worktree status checks use the
  protected Git environment.
- Agent-visible shell/process execution receives the same protected Git config
  so `git` invoked by a command, prompt, package script, or tool inherits the
  safety default.
- A deterministic test fixture creates a project containing a nested bare
  repository with hook-capable config, runs representative KOTA Git paths from
  inside that nested directory, and proves implicit bare discovery is rejected
  before hooks can run.
- Normal Git operations in an ordinary non-bare worktree still pass through
  the workflow and shell paths.
- Any intentional bare-repository exception is explicit in code and covered by
  a test that proves the exception does not become a global bypass.

## Source / Intent

Explorer run `2026-05-27T01-25-42-685Z-explorer-1fr8i6` reviewed a queue with
zero actionable ready/doing tasks. The strategic blocked alternatives all
still require operator-captured artifacts and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://github.com/github/copilot-cli/blob/main/changelog.md` lists a
  May 6, 2026 fix to protect against RCE from malicious bare repositories
  nested inside a project.
- `https://git-scm.com/docs/git-config` documents `safe.bareRepository` and
  says `explicit` limits bare repository use to an explicit `--git-dir` or
  `GIT_DIR`; the same page documents protected configuration and the
  `GIT_CONFIG_COUNT` environment mechanism for scripts that spawn many Git
  commands.

Local overlap check:

- `data/tasks/done/task-harden-shell-working-directory-guardrails-against-.md`
  covers command cwd escape classification, not Git's internal nested bare
  repository discovery.
- `data/tasks/done/task-add-a-bare-repository-full-cycle-builder-fixture.md`
  covers an eval fixture for sparse repository setup, not bare-repo security.
- `rg` found no existing `safe.bareRepository` or `GIT_CONFIG_COUNT` safety
  helper in `src/` or open tasks.

## Initiative

Autonomous subprocess safety: repository inspection and command execution
should inherit secure Git discovery defaults so KOTA can run in untrusted
project trees without treating implicit Git hooks as ordinary inspection.

## Acceptance Evidence

- Focused transcript for the affected boundaries, for example
  `pnpm test src/core/util/repo-worktree.test.ts src/core/tools/guardrails.test.ts src/modules/execution/shell.test.ts src/modules/autonomy/commit.test.ts`.
- A regression fixture or test log showing a nested bare repository attempt is
  rejected and that its hook marker file is not created.
- Diff review showing a shared protected-Git environment helper or equivalent
  boundary, no user-global Git config mutation, and no broad safe-directory
  bypass.

## Completion Evidence

- Shared helper: `src/core/util/protected-git-env.ts`.
- Focused tests: `pnpm test src/core/util/protected-git-env.test.ts src/core/util/repo-worktree.test.ts src/modules/execution/shell.test.ts src/modules/git/git.test.ts src/modules/autonomy/commit.test.ts`.
- Additional adapter coverage: `pnpm test src/modules/codex-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/claude-agent-harness/adapter.test.ts`.
- Validation: `pnpm run typecheck`, `pnpm run lint`, `pnpm run validate-tasks`,
  `pnpm build`, `node dist/cli.js workflow validate`.
