---
id: task-add-an-interactive-coding-session-cli-entry-point-
title: Add an interactive coding-session CLI entry point that works across every registered agent harness
status: backlog
priority: p2
area: architecture
summary: Wire interactive coding sessions (REPL) through every registered agent harness, not just the classic ModelClient loop.
created_at: 2026-04-22T20:26:51.293Z
updated_at: 2026-04-22T20:26:51.293Z
---

## Problem

`kota run -i` (interactive REPL) today only works for the classic ModelClient
path. The `--provider=agent-sdk` shortcut explicitly rejects interactive mode
with an error, and other registered harnesses (thin, future codex / OpenAI-compat
adapters) have no interactive path at all. An operator who wants a Claude
Code / Codex-style REPL against the harness of their choice cannot get one.

The preprocessor split in `src/core/prompt-input/` already gives every CLI path
a common pre-send hook. What is missing is a harness-neutral REPL that drives
`AgentHarness.run` turn-by-turn, shares context across turns when the harness
supports it, and surfaces the active harness + model in the REPL chrome.

## Desired Outcome

`kota run -i` (and any equivalent entry point) drops the operator into an
interactive REPL that uses whichever harness is selected — `claude-agent-sdk`,
`thin`, or any future adapter — with the same prompt pre-processing (`@path`
expansion today; future hooks later). The REPL shows the active harness and
model at startup, keeps the CLI's existing autonomy-mode and confirmation
wiring, and fails loudly when the chosen harness genuinely cannot sustain
multi-turn conversation.

## Constraints

- Reuse the existing `AgentHarness` protocol. Do not fork a second interactive
  runtime per harness adapter.
- Respect harness-declared capabilities. A tool-free harness (e.g. `thin`)
  should still accept multi-turn text when it can; harnesses that genuinely
  cannot must fail the REPL entry point with a clear message rather than
  silently downgrading to single-turn.
- Keep the preprocessor at the CLI boundary (`expandUserPromptReferences`).
  Do not duplicate `@path` expansion per harness.
- No test-only production flags; tests drive the REPL through the normal
  transport abstractions.

## Done When

- `kota run -i` (or an equivalent interactive entry point) supports at least
  two registered harness adapters, with coverage that exercises both.
- The REPL header prints the active harness and model before the first turn.
- `@path` user-prompt expansion runs at the REPL boundary, not inside any
  harness adapter.
- Harnesses that cannot sustain multi-turn interaction fail the REPL entry
  point with a clear operator-facing error.
