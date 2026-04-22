---
id: task-use-kota-as-a-general-purpose-cli-coding-agent-acr
title: Land the shared input-processing layer and harness-aware CLI chrome for coding-agent parity
status: done
priority: p2
area: architecture
summary: Phase 1 slice of the coding-agent-parity umbrella — shared @path user-prompt preprocessing consumed by every CLI path plus visible active-harness chrome. Remaining milestones are tracked as focused follow-up tasks.
created_at: 2026-04-22T16:46:51.631Z
updated_at: 2026-04-22T20:29:50.501Z
---

## Problem

The agent harness is already swappable across claude-agent-sdk, thin, and
future codex / OpenAI-compat adapters (see
`task-make-agent-harness-pluggable-beyond-claude-agent-s` under `done/`).
The surrounding CLI experience still has two concrete gaps that every other
milestone builds on:

- User-prompt `@path` reference expansion is not shared. Each CLI path
  either sends raw prompts through to the harness or relies on the harness
  to do its own expansion, so different adapters would diverge.
- The CLI does not announce which harness is active on a given invocation.
  Operators switching between `claude-agent-sdk`, `thin`, or a future
  adapter via `config.defaultAgentHarness` or `--provider` cannot tell
  which adapter is driving their session.

Remaining gaps — interactive REPL across harnesses, harness-neutral hook
protocol, and an end-to-end coding-task parity artifact — depend on this
shared layer and the visible chrome and are tracked as focused follow-up
tasks.

## Desired Outcome

A harness-neutral preprocessor in `src/core/prompt-input/` expands `@path`
user-prompt references and is called at every CLI boundary before
`AgentHarness.run`. Every registered adapter receives the same expanded
text. A short banner shows the active harness name and model when the CLI
starts a coding turn, so operators can always see which adapter is driving
the session. Three focused follow-up tasks in `data/tasks/backlog/` cover
the remaining interactive-REPL, hook-protocol, and parity-artifact
milestones.

## Constraints

- Expansion lives in a shared input-processing layer. Do not duplicate
  `@path` handling per harness adapter.
- Preprocessing must be pure and harness-neutral — no harness-specific
  branches inside the expander.
- Missing paths, directories, and read errors are left as plain text so the
  agent sees the operator's intent and can respond. Silent drops would hide
  operator intent.
- Harness selection stays explicit. The new chrome surfaces the selection;
  it does not add a default or silently fall back.
- No test-only production flags. Tests cover the expander and cross-harness
  parity through the existing adapter test patterns.

## Done When

- A shared preprocessor at `src/core/prompt-input/` exposes
  `expandUserPromptReferences(prompt, baseDir)` with byte-cap, deduping,
  trailing-punctuation handling, and explicit classification of files,
  directories, missing paths, and read errors.
- Every CLI path (`kota run` agent-sdk shortcut, `kota run` classic loop,
  `kota run -i` interactive, and stdin pipe mode) calls the preprocessor
  before handing off to a harness or classic loop, so both harness paths
  receive identical expanded text.
- The CLI announces the active harness name and model on stderr before the
  first turn when stderr is a TTY.
- Tests cover the expander directly and a cross-harness parity case that
  feeds the expanded prompt through both `thin` and `claude-agent-sdk`
  adapters.
- `src/core/prompt-input/AGENTS.md` documents the module's scope and
  conventions. `src/core/AGENTS.md` links the subtree.
- The remaining original Done-When items (interactive REPL across
  harnesses, harness-neutral hook/plugin protocol, end-to-end coding-task
  parity artifact) are tracked as focused backlog tasks so future builder
  runs can land them without inheriting this task's full umbrella scope:
  `task-add-an-interactive-coding-session-cli-entry-point-`,
  `task-make-hook-and-plugin-surfaces-behave-identically-a`, and
  `task-capture-an-end-to-end-coding-task-parity-artifact-`.
