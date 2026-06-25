---
id: task-make-openrouter-and-local-models-first-class-kota-
title: Make OpenRouter and local models first-class KOTA agent backends
status: backlog
priority: p1
area: architecture
task_class: Platform
anchor: true
summary: Track the decomposed initiative to let KOTA run real OpenRouter and local models with KOTA-owned tool, safety, resume, and evaluation parity instead of relying on Codex or Claude-specific harness behavior.
created_at: 2026-06-25T14:22:32.784Z
updated_at: 2026-06-25T14:22:32.784Z
---

## Problem

KOTA can route OpenAI-compatible providers, but OpenRouter and local model
usage is not yet a first-class replacement path for Codex or Claude. The
current OpenRouter preset still points every tier at `openai/gpt-4.1-mini`,
and the `openai-tools` path does not yet provide the same KOTA-owned tool,
MCP, approval, rich-result, session, and evaluation surfaces that determine
real agent capability.

Recent research makes the effort worth doing: GLM-5.2 is now a credible
candidate, Kimi K2.7 Code and several lower-cost OpenRouter models are worth
testing, and mini-SWE / FrontierSWE style evidence shows harness quality can
move results as much as model choice. KOTA needs a sequenced initiative, not a
single preset swap.

## Desired Outcome

OpenRouter and local models become supported KOTA agent backends through
KOTA-owned runtime parity: model-aware provider metadata, correct
OpenAI-compatible wire behavior, shared tool execution, MCP and approval
support, rich-result and reasoning artifacts, KOTA-owned resume, model-matrix
evaluation, weak/local model scaffolding, and a recorded rollout decision.

## Constraints

- This is a strategic anchor. Do not implement it as one large task.
- Keep the sub-slice tasks as the implementation units and preserve their hard
  dependency edges with `depends_on`.
- Do not make OpenRouter or any local model the default until the rollout task
  records scenario evidence against the Codex baseline.
- Do not add a parallel agent runtime or benchmark store; use the existing
  harness, tool-runner, harness-parity, and eval-harness mechanisms.
- Preserve safety parity as part of the capability target. A cheaper model
  path that bypasses KOTA approvals or guardrails is not acceptable.

## Done When

- `task-add-openrouter-model-capability-catalog-and-candid` is done.
- `task-make-openai-compatible-model-clients-honor-model-s` is done.
- `task-route-openai-tools-through-the-kota-tool-runner-wi` is done.
- `task-preserve-rich-tool-results-reasoning-and-agent-mes` is done.
- `task-add-kota-owned-session-resume-for-model-client-har` is done.
- `task-extend-harness-parity-and-eval-harness-with-model-` is done.
- `task-add-scaffolded-weak-and-local-model-agent-mode` is done.
- `task-run-live-openrouter-and-local-model-rollout-evalua` is done.
- The final rollout artifact states which OpenRouter and local routes are
  supported, experimental, or rejected, and why.

## Source / Intent

Owner request from June 2026: make KOTA able to work with real models such as
GLM or Kimi through OpenRouter, and eventually local weaker models, without
major capability loss. The owner explicitly asked for current model research,
full codebase/harness investigation, comparison against Codex, experiments in
parallel with Codex, and task breakdown rather than immediate implementation.

Research sources checked include OpenRouter live `/models`, OpenRouter coding
collection, Z.ai GLM-5.2 docs and tool-integration docs, Kimi K2.7 Code docs,
FrontierSWE, OpenLM SWE-bench, mini-SWE-agent, and Claw-SWE-Bench.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm run validate-tasks` passes with this anchor and every sub-slice task in
  a valid terminal or active state.
- The rollout evidence under `.kota/runs/<run-id>/` links the completed
  model-matrix run and the support-tier decision.
