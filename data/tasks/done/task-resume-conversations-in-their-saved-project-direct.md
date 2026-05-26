---
id: task-resume-conversations-in-their-saved-project-direct
title: Resume conversations in their saved project directory
status: done
priority: p2
area: modules
summary: Make explicit history resume and continue paths re-enter the saved conversation cwd, with an override for intentional cross-directory resumes, so tools, prompt references, project context, and guardrails do not silently run against the caller's current directory.
created_at: 2026-05-26T15:53:41.649Z
updated_at: 2026-05-26T16:10:49.000Z
---

## Problem

Conversation records persist the directory they were created in, but resume
entry points do not consistently re-enter that directory.

`kota run --continue` with an explicit id resolves the conversation id, then
constructs `AgentSession` with the caller's current `process.cwd()`.
`kota history resume <id>` does the same through `interactiveMode`. The session
restore loads the old messages, but project context, repo-local instructions,
tool guardrails, prompt-reference expansion, MCP config, delegate cwd, and
history write-back all bind to the directory where the resume command was run.

That is fine for a bare `--continue` that intentionally means "most recent for
this cwd", but it is wrong for an explicit conversation id. A user can resume a
conversation from another shell directory and silently run tools against the
wrong project.

## Desired Outcome

Explicit conversation resume paths treat the saved conversation cwd as the
default project boundary.

- `kota run --continue <id>` and `kota history resume <id>` load the selected
  conversation metadata, validate that its saved cwd is usable, and construct
  the resumed session against that cwd.
- Relative prompt references, attachment-style path expansion, tool cwd checks,
  project context, module loading, MCP config, and subsequent history writes all
  use the saved cwd for the resumed session.
- Operators still have a deliberate way to override the saved cwd for recovery
  or migration cases; the override is explicit in the command surface and in
  the transcript/status output.
- A missing or inaccessible saved cwd fails with a clear operator-facing error
  unless the explicit override is supplied.

## Constraints

- Keep the history record as the source of truth for the saved cwd; do not add a
  parallel resume metadata store.
- Preserve the current bare `kota run --continue` behavior of selecting the
  most recent conversation for the caller's current directory.
- Do not silently change cwd for unrelated history commands such as list,
  search, show, delete, or reindex.
- Keep daemon-backed and local-client history paths aligned. The CLI should not
  depend on reading `.kota/history` files directly when the daemon client is
  active.
- If a new override flag is introduced, make it narrow and named for resume
  behavior rather than adding a second global project-selection mechanism.

## Done When

- Explicit-id `kota run --continue <id>` resumes with `AgentSession.projectDir`
  and user prompt reference expansion rooted at the selected record's cwd.
- `kota history resume <id>` does the same for interactive sessions.
- Bare `kota run --continue` still filters by the current cwd and resumes that
  directory's latest conversation.
- Cross-directory explicit resume either re-enters the saved cwd or requires an
  explicit override; it never silently runs the old conversation in the caller's
  unrelated cwd.
- Missing saved-cwd and override cases have focused regression coverage.

## Source / Intent

Explorer run `2026-05-26T15-51-41-369Z-explorer-z8oxnq` reviewed a thin
queue. The only backlog tasks were dependency-waiting research items, and the
strategic blocked alternatives were all real operator-capture waits, not
movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://github.com/github/copilot-cli/blob/main/changelog.md`

The first watchlist snapshot of GitHub Copilot CLI's changelog showed a
concrete peer-runtime fix: `copilot --continue` now resumes from a session's
saved directory, refreshes saved branch/git context, and resolves relative
paths from the saved cwd unless an override is passed. KOTA already persists
conversation cwd but does not apply that invariant on explicit resume.

Local evidence:

- `src/modules/history/history.ts` records `ConversationRecord.cwd` when a
  conversation is created.
- `src/modules/history/cli.ts` resolves explicit `--continue <id>` to only an
  id; it does not fetch the selected record cwd before `runAgentLoop`.
- `src/modules/history/cli-commands.ts` resolves `kota history resume <id>` to
  only an id before calling `interactiveMode`.
- `src/core/loop/loop-constructor.ts` defaults `AgentSession.projectDir` to
  `process.cwd()` when `LoopOptions.projectDir` is absent, so restored messages
  can bind to the wrong project.
- Existing history-resume tests cover message restoration and compaction state,
  not cross-directory project binding.

## Initiative

Session continuity correctness: resuming a stored conversation should restore
the conversation's project boundary as well as its messages.

## Acceptance Evidence

- Focused tests for explicit-id `kota run --continue`, `kota history resume`,
  missing saved cwd, and explicit override behavior.
- A CLI transcript under `.kota/runs/<run-id>/transcript.txt` that creates a
  conversation in one temporary project, resumes it from a different cwd, and
  shows the resumed session uses the saved project directory rather than the
  caller's directory.
- `pnpm test src/history-resume.integration.test.ts src/modules/history/cli.test.ts`
  or the narrower updated history resume test set passes.
- `pnpm test src/task-files.test.ts` passes.
