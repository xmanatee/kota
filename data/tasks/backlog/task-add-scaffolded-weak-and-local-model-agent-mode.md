---
id: task-add-scaffolded-weak-and-local-model-agent-mode
title: Add scaffolded weak and local model agent mode
status: backlog
priority: p2
area: modules
task_class: Platform
depends_on: [task-route-openai-tools-through-the-kota-tool-runner-wi, task-preserve-rich-tool-results-reasoning-and-agent-mes]
summary: Add a constrained agent mode for local and weaker models with compound inspect/edit/verify tools, smaller action space, context packaging, and verifier-driven repair loops.
created_at: 2026-06-25T14:23:26.692Z
updated_at: 2026-06-25T14:23:26.692Z
---

## Problem

Some OpenRouter and local models may be useful but are unlikely to match Codex
or GLM-5.2 through the normal raw tool loop. Smaller models often fail because
they choose too many low-level actions, lose context across tool calls, or do
not recover from verifier output. KOTA needs a constrained scaffold for these
models instead of pretending that "OpenAI-compatible tool calling" is enough.

## Desired Outcome

KOTA has an opt-in weak/local model mode that narrows the action space and
packages context for smaller models. The mode exposes compound inspect,
search/read, edit, test, and verify operations; uses verifier-driven repair
loops; and records which constrained task classes each local or weaker model
can handle.

## Constraints

- This mode is opt-in and must not weaken the normal `openai-tools` harness for
  strong models.
- Do not bypass KOTA tool safety. Compound operations must still route through
  KOTA tools, guardrails, approvals, and idempotency where effects require it.
- Keep compound tools coarse enough to reduce reasoning burden but inspectable
  enough for operator review and eval artifacts.
- Do not let the model write unverified final claims. Every scaffolded edit
  path must end with deterministic verifier evidence or an explicit failure.
- Local providers may have smaller contexts and no reliable tool-call support;
  the mode must support a bash-only or JSON-action fallback if that is the
  empirically better route.

## Done When

- A harness option or named harness mode can run a weak/local model with a
  constrained action vocabulary.
- Compound operations exist for repository inspection, targeted search/read,
  bounded file-region editing, patch application, command execution with
  summarized output, and verify-and-diff reporting.
- The mode injects deterministic verifier feedback after failed tests and stops
  after a bounded repair count.
- Scenario evidence separates task classes where weak/local models are
  supported, experimental, or rejected.
- The normal strong-model path remains unchanged unless explicitly configured
  to use the scaffold.

## Source / Intent

The owner asked not only about GLM/Kimi, but also about eventually running
KOTA with locally hosted and weaker models. The research suggests harness
scaffolding is essential for that target: mini-SWE-style constrained loops and
compound tools can outperform naive raw tool calling for smaller models.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/openai-tools-agent-harness src/modules/harness-parity` passes with scaffold-mode coverage.
- A local no-network fixture proves the scaffold can complete a constrained
  edit-and-verify task through a fake OpenAI-compatible model.
- A live optional artifact under `.kota/runs/<run-id>/` compares a weak/local
  model with and without the scaffold on the same scenario.
