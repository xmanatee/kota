---
id: task-use-kota-as-a-general-purpose-cli-coding-agent-acr
title: Use KOTA as a general-purpose CLI coding agent across pluggable harnesses
status: backlog
priority: p2
area: architecture
summary: Make KOTA usable from the terminal as a claude-code/codex-grade coding agent that wraps the chosen harness without degrading interactive UX, AGENTS.md hierarchy, @-imports, hooks, plugins, or skills.
created_at: 2026-04-22T16:46:51.631Z
updated_at: 2026-04-22T16:46:51.631Z
---

## Problem

The agent harness is already swappable across claude-agent-sdk, codex, and
API-backed loops (`task-make-agent-harness-pluggable-beyond-claude-agent-s`),
but the terminal surface that exposes it is not at parity with Claude Code or
Codex. Today a CLI user gets daemon/ops commands plus an interactive chat; they
do not get the full "give it a coding instruction, let it work in this repo"
loop that Claude Code and Codex provide — repo-wide `AGENTS.md` / `CLAUDE.md`
resolution, `@file` expansion, slash-commands on par with either vendor, hooks
firing around tool calls and session events, and skills/plugins that match
Claude Code's and Codex's published surfaces.

Operators who want to use KOTA as their daily coding agent instead of (or on
top of) Claude Code and Codex cannot do so without losing capability. Whichever
harness KOTA picks internally, the surrounding CLI experience must deliver the
same capability to the operator.

## Desired Outcome

A KOTA CLI session in a repo feels at least as capable as Claude Code or Codex
for coding work, regardless of which harness is selected. The operator either
configures the harness explicitly or accepts an explicit selection prompt; no
implicit vendor default. Hierarchical `AGENTS.md`/`CLAUDE.md` discovery,
referenced-file imports, hooks, plugins, and skills all behave the same across
harnesses. Real comparison runs (or a dedicated harness test) show KOTA
carrying coding tasks to completion with no meaningful capability gap vs. the
native tool for the same harness.

## Constraints

- Keep one clear public concept — a `session` driven by an `agent`, routed
  through the already-existing harness protocol. Do not add a second
  "coding-agent-CLI" surface beside sessions or a parallel harness selector.
- Respect the hierarchical `AGENTS.md` / `CLAUDE.md` resolution rules already
  used by Claude Code and Codex. Reuse existing skill/prompt-state machinery
  rather than building a parallel doc-ingestion path.
- `@file` and other reference expansions belong in a shared input-processing
  layer so every harness sees the same expanded prompt. Do not duplicate
  expansion per harness adapter.
- Hooks must run across all harnesses through a harness-neutral hook protocol;
  do not fork per-harness hook implementations. Plugins and skills must be
  discoverable through the existing module/skill contracts.
- Do not add backwards-compatibility shims that silently keep one harness as
  the default. Harness selection stays explicit.
- No test-only hooks in production code; rely on the existing module and
  harness boundaries for verification.

## Done When

- A CLI entry point drops the operator into an interactive coding session in
  the current repo that feels equivalent to Claude Code / Codex for coding
  tasks, with the active harness shown explicitly.
- Hierarchical `AGENTS.md` / `CLAUDE.md` discovery and `@file` expansion work
  identically across every registered harness adapter, covered by tests.
- Hook, plugin, and skill surfaces behave consistently across harnesses, with
  a shared protocol and tests that exercise at least two harness adapters.
- A comparison artifact under `.kota/runs/` shows KOTA completing a
  representative coding task end-to-end with parity capability vs. running the
  same harness directly.
- The CLI's coding-session entry point and capability surface are documented
  at the narrowest applicable `AGENTS.md`, not duplicated across docs.
