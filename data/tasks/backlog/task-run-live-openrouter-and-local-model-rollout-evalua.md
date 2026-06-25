---
id: task-run-live-openrouter-and-local-model-rollout-evalua
title: Run live OpenRouter and local model rollout evaluation
status: backlog
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-openrouter-model-capability-catalog-and-candid, task-make-openai-compatible-model-clients-honor-model-s, task-route-openai-tools-through-the-kota-tool-runner-wi, task-preserve-rich-tool-results-reasoning-and-agent-mes, task-add-kota-owned-session-resume-for-model-client-har, task-extend-harness-parity-and-eval-harness-with-model-, task-add-scaffolded-weak-and-local-model-agent-mode]
summary: Use the completed parity surfaces to run GLM, Kimi, DeepSeek, Qwen, MiniMax, MiMo, and local-model candidates against Codex baselines and select supported tiers from recorded evidence.
created_at: 2026-06-25T14:23:32.342Z
updated_at: 2026-06-25T14:23:32.342Z
---

## Problem

After the provider and harness parity work lands, KOTA still needs an evidence
run before changing defaults or recommending OpenRouter/local models. Public
benchmarks are not enough because they measure different harnesses, prompts,
tools, and environments. The owner wants practical performance in KOTA, not a
model leaderboard summary.

## Desired Outcome

KOTA runs the completed model matrix against Codex baselines and records a
support-tier decision. The result names which models are supported for capable,
balanced, fast, weak/local scaffolded, and rejected use; it also names the
remaining blockers for models that are close but not ready.

## Constraints

- Do not promote any OpenRouter or local model to a recommended default unless
  the matrix evidence meets the acceptance threshold.
- The capable replacement candidate must reach at least 90% of Codex `pass^k`
  on the selected KOTA scenario suite and have no P0 feature-parity failures.
- Secondary candidates can be marked supported for narrower tiers only when
  the report names the task class, pass^k, cost, latency, and feature limits.
- If `OPENROUTER_API_KEY` or local runtime prerequisites are absent, record a
  preflight skip and keep the task open; a skip is not rollout evidence.
- Keep the final decision in the task result and run artifact. Do not create a
  parallel benchmark catalog or external leaderboard doc.

## Done When

- The matrix includes Codex/GPT-5.5 baseline rows and candidate rows for at
  least GLM-5.2, Kimi K2.7 Code, DeepSeek V4 Pro/Flash, Qwen 3.7 Plus, MiniMax
  M3, MiMo V2.5, and one local or local-like weak model route.
- Each candidate has pass@k, pass^k, cost, latency, token usage, turn count,
  tool count, approval count, context-retrieval diagnostics, trajectory
  diagnostics, and verifier output recorded.
- The rollout decision marks each candidate as `supported`, `experimental`,
  `scaffold-only`, or `rejected`.
- Presets or operator guidance are updated only for `supported` candidates.
- The task result explicitly states whether KOTA can currently run without
  Codex/Claude for the selected task classes and what remains before broader
  replacement.

## Source / Intent

The owner asked to run candidates in parallel with Codex, look at real
performance, tune directions for weaker models, and reach a future state where
KOTA can be run without Codex or Claude when evidence supports it. This task is
the empirical decision point after the enabling work is complete.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `.kota/runs/<run-id>/` contains the live model-matrix artifacts, preflight
  records, per-scenario transcripts, verification output, aggregate report, and
  support-tier decision.
- `pnpm run validate-tasks` passes after the task records its outcome or moves
  follow-up blockers into the queue.
- If supported presets are changed, `pnpm run test:preset-parity` passes or
  records valid auth/runtime skips for every affected preset.
