---
id: task-extend-harness-parity-and-eval-harness-with-model-
title: Extend harness parity and eval harness with model-matrix evidence
status: blocked
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-openrouter-model-capability-catalog-and-candid, task-make-openai-compatible-model-clients-honor-model-s, task-route-openai-tools-through-the-kota-tool-runner-wi, task-preserve-rich-tool-results-reasoning-and-agent-mes, task-add-kota-owned-session-resume-for-model-client-har]
summary: Add baseline-versus-candidate model matrices, repeats, cost and latency metrics, live-key skips, and shadow comparison artifacts so GLM, Kimi, OpenRouter, and local models are judged against Codex on KOTA scenarios.
created_at: 2026-06-25T14:23:20.760Z
updated_at: 2026-06-27T02:34:00.000Z
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
  selected eval-harness fixtures, repeats, max turns, effort, resource profile
  fields, and output directory.
- Artifacts record model id, provider, harness, capability metadata date,
  scenario or fixture id, repeat index, duration, token usage, estimated cost,
  tool counts, approval counts, verification result, pass@k/pass^k aggregates,
  trajectory diagnostics, and eval-harness resource/config evidence when the
  target is an eval fixture.
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

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/configured-key-model-matrix/model-matrix-report.json
description: configured-key GLM/Kimi matrix evidence — operator configures an OpenRouter key, runs `pnpm kota harness-parity matrix --scenario fix-arithmetic-bug --harness codex --candidate openrouter/z-ai/glm-5.2 --candidate openrouter/moonshotai/kimi-k2.7-code --repeats 1 --out .kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/configured-key-model-matrix`, and captures the transcript plus model-matrix-report.json showing Codex baseline comparison against both OpenRouter candidates under the same run directory.
```

## Result

Implemented a shared `harness-parity matrix` operation across the local client,
daemon control route, and CLI. The matrix expands baseline/candidate model
rows, OpenRouter candidate sets, harness-parity scenarios, selected eval-harness
fixtures, harnesses, repeats, max turns, effort, output directories, and
eval-harness resource-profile fields. It records capability metadata, per-row
verification, token/cost/tool/approval fields, trajectory diagnostics, grouped
pass@k/pass^k-style aggregates, eval-harness run/resource/config evidence, and
cloned-workspace shadow comparisons.

Shadow comparisons now require explicit compatibility evidence before they are
marked compatible: same target and harness, same repeat count, primary baseline
evidence, runnable baseline/candidate rows, model-capability evidence, plan/test
evidence, latency/cost evidence, and matching eval-harness resolved
harness/model evidence when the target is an eval fixture. Skipped OpenRouter
rows are therefore recorded as evidence but are not treated as compatible
candidate comparisons.

Validation:

- `pnpm test src/modules/harness-parity` passed.
- `pnpm test src/modules/harness-parity src/modules/eval-harness` passed.
- `pnpm typecheck` passed.
- `pnpm lint` exited successfully; it reported one unrelated pre-existing
  warning in `src/core/workflow/repair-loop-workspace.test.ts`.
- `.kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/no-key-matrix-transcript.txt`
  captures a source-mode no-key matrix preflight for GLM-5.2 and Kimi K2.7
  Code with a deterministic local baseline row. The report at
  `.kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/no-key-model-matrix/model-matrix-report.json`
  records one runnable baseline group, records `OPENROUTER_API_KEY`
  unavailable, skips both OpenRouter rows before live execution, and marks both
  shadow comparisons incompatible because the candidates did not run and lack
  the required plan/test/latency/cost evidence.

The configured-key live GLM/Kimi comparison was not executed in this builder
run because neither `OPENROUTER_API_KEY` nor KOTA's OpenRouter secret resolution
returned a credential. The remaining evidence is an operator-captured live-key
matrix run under this task's run directory once an OpenRouter key is configured.
