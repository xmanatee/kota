---
id: task-extend-harness-parity-and-eval-harness-with-model-
title: Extend harness parity and eval harness with model-matrix evidence
status: backlog
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-openrouter-model-capability-catalog-and-candid, task-make-openai-compatible-model-clients-honor-model-s, task-route-openai-tools-through-the-kota-tool-runner-wi, task-preserve-rich-tool-results-reasoning-and-agent-mes, task-add-kota-owned-session-resume-for-model-client-har]
summary: Add baseline-versus-candidate model matrices, repeats, cost and latency metrics, live-key skips, and shadow comparison artifacts so GLM, Kimi, OpenRouter, and local models are judged against Codex on KOTA scenarios.
created_at: 2026-06-25T14:23:20.760Z
updated_at: 2026-06-25T14:23:20.760Z
---

## Problem

KOTA's harness-parity runner can compare harnesses across scenarios, but it
currently resolves one model for all requested harnesses. That is not enough to
answer whether GLM, Kimi, DeepSeek, Qwen, MiniMax, MiMo, or local models can
replace Codex in practice. The eval harness already has pass@k/pass^k language,
but model replacement needs a matrix that records model, provider, harness,
scenario, repeats, cost, latency, trajectory, and verification outcomes.

## Desired Outcome

KOTA can run a baseline-versus-candidate model matrix over existing
harness-parity scenarios and selected eval-harness fixtures. The evidence
compares Codex/Claude baselines with OpenRouter/local candidates using the same
scenario snapshots, repeat counts, and resource profile rules, with live-key
skips when credentials are absent.

## Constraints

- Do not turn harness-parity into the scoring source of truth. It remains the
  paired artifact runner; eval-harness remains the regression/scoring gate.
- Do not require `OPENROUTER_API_KEY` for unit tests. Live runs should skip
  loudly and record preflight status when credentials are absent.
- Keep repeated fixture runs sequential unless the eval-harness resource
  profile says parallel execution is safe.
- Record both `pass@k` and `pass^k`; gate rollout decisions on consistency.
- Compare baseline and candidate runs only when configs, fixture manifests,
  resource profiles, and model capability evidence are compatible.
- Shadow mode must run candidates on cloned workspaces or read-only observer
  paths so Codex remains the primary actor during real work.

## Done When

- A matrix input can name baselines, candidate models, harnesses, scenarios,
  repeats, max turns, effort, and output directory.
- Artifacts record model id, provider, harness, capability metadata date,
  scenario id, repeat index, duration, token usage, estimated cost, tool counts,
  approval counts, verification result, pass@k/pass^k aggregates, and
  trajectory diagnostics.
- A shadow-comparison operation can run a candidate against a cloned worktree
  or read-only observer path and compare plan, diff, tests, failures, cost, and
  latency against the primary Codex run.
- The CLI and daemon route share the same matrix execution path.

## Source / Intent

The owner asked to "run in parallel with Codex", watch performance, and tune
directions for weaker models. Existing public benchmarks are useful but not
enough because they combine model and harness. KOTA needs its own evidence on
its own scenarios before treating an OpenRouter or local route as supported.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/harness-parity src/modules/eval-harness` passes for
  the affected matrix and reporting code.
- A no-key matrix preflight run records skipped OpenRouter candidates without
  failing unrelated local baseline rows.
- With a configured key, `.kota/runs/<run-id>/` contains a matrix report
  comparing Codex baseline rows against at least GLM-5.2 and Kimi K2.7 Code.
