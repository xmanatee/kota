---
id: task-remove-tool-level-duplicate-confirmation
title: Remove duplicate dangerous-command confirmation from shell and process tools
status: ready
priority: p2
area: runtime
summary: shell.ts and process.ts each have their own isDangerous/confirmExecution checks. Guardrails already classifies and confirms dangerous commands at the runner level, making these tool-level checks redundant and causing double prompting in interactive mode.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`shell.ts` and `process.ts` each call `isDangerous(command)` and `confirmExecution(command)` from `confirm.ts` before executing shell commands. The guardrails system (`guardrails.ts`) already classifies dangerous shell commands (same pattern set, plus more) and enforces a confirm/queue policy at the tool-runner level, before the tool executes.

In interactive mode with default guardrails config (`dangerous → confirm`), a dangerous shell command now triggers two confirmation prompts:
1. Guardrails (tool-runner.ts): `confirmAction("Allow shell? ...")`
2. Shell tool (shell.ts): `confirmExecution("Destructive command detected: ...")`

The guardrails patterns cover everything in `confirm.ts`'s `DANGEROUS_PATTERNS` and more (adds curl mutation methods, wget --post). The guardrails layer is always active in the main agent loop.

## Desired Outcome

A dangerous shell command triggers exactly one confirmation — from guardrails, at the runner level. The tool-level `isDangerous` / `confirmExecution` calls in shell.ts and process.ts are removed. `confirm.ts` retains `confirmAction` (used by tool-runner.ts) but `isDangerous` and `confirmExecution` can be removed if unused.

## Constraints

- The guardrails system must be active in any context where shell/process tools run. Verify the main loop always initializes guardrailsConfig before making this change.
- Tests that currently mock `isDangerous`/`confirmExecution` on the tool level must be updated to mock guardrails instead, or restructured to test the runner-level gate.
- Do not remove `confirmAction` — it is used by tool-runner.ts for the guardrails confirm gate.

## Done When

- `shell.ts` and `process.ts` do not call `isDangerous` or `confirmExecution`.
- `confirm.ts` no longer exports `isDangerous` or `confirmExecution` (if no other callers remain).
- Existing shell/process tests are updated and still pass.
- A dangerous shell command in interactive mode produces exactly one confirmation prompt.
- All checks pass: typecheck, lint, test:workflow-critical, build.
