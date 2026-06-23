---
id: task-add-rollout-token-budgets-to-workflow-agent-runs
title: Add rollout token budgets to workflow agent runs
status: ready
priority: p1
area: core
task_class: Safety
summary: Add a run-scoped token budget for workflow agent steps and delegated child agents so autonomous rollouts abort predictably before token usage runs away, independent of provider pricing.
created_at: 2026-06-23T12:27:06.493Z
updated_at: 2026-06-23T12:27:06.493Z
---

## Problem

KOTA has several useful brakes for autonomous workflow cost and runaway
structure: daily workflow cost budgets, per-step cost caps, model-specific
output-token request limits, delegate depth/concurrency limits, run timeouts,
and progress-resetting idle timeouts. Those controls do not create a single
token budget for a workflow rollout.

That leaves a concrete gap. A workflow agent step can consume a large number of
input/output tokens across many model turns, repair-loop retries, and delegated
child agents before a USD cost cap triggers or when the provider path has
incomplete pricing. Cost caps are also the wrong operator primitive for some
safety decisions: KOTA should be able to say "this run has spent its token
budget" without converting every provider, cache tier, or local harness into a
dollar amount first.

The result is an uneven safety boundary. Token usage is recorded in agent step
outputs, tracing, eval artifacts, and model-client adapters, but it is not
reserved and enforced as a run-scoped resource the way delegate depth is.

## Desired Outcome

Workflow agent execution has an optional rollout token budget that spans the
entire autonomous run subtree:

- a workflow definition, agent step, or resolved autonomy preset can provide a
  max total token budget for the run or step;
- each model turn records reported input and output tokens against the active
  budget after the provider returns usage;
- delegated child agents and named-agent handoffs inherit the same budget
  ledger unless a narrower child budget is explicitly configured;
- once the budget is exhausted, the next model turn is not started and the step
  fails with a bounded `token_budget_exhausted` reason;
- run artifacts and control-monitor coverage show the configured budget,
  consumed input/output/total tokens, remaining tokens, and exhaustion point;
  and
- providers or harnesses that cannot report usage produce an explicit
  unsupported or non-enforcing diagnostic instead of silently bypassing the
  budget.

## Constraints

- Build on existing usage facts already emitted by the core loop, workflow
  agent-step outputs, KOTA-native model clients, and harness adapters. Do not
  add a second token accounting stream or infer tokens from raw prompt text
  when the provider reports usage.
- Keep dollar budgets and token budgets separate. This task is not cost-based
  model routing, cheaper-agent selection, or a replacement for
  `maxCostUsd` / daily budget guards.
- Enforce after a provider turn reports usage and before starting the next
  turn. Do not attempt mid-stream cancellation unless a harness already exposes
  a reliable usage signal before completion.
- Preserve existing model-specific output-token limits; those cap one request,
  while this budget caps aggregate rollout consumption.
- Keep diagnostics bounded. They may include counts, model/harness ids, step
  ids, and reason codes, but not raw prompts, tool results, or secrets.
- If a delegated or named-agent child receives a narrower explicit budget, it
  must still debit from the parent ledger so child work cannot escape the
  parent run ceiling.

## Done When

- A typed token-budget ledger exists at the workflow agent execution boundary
  and can be shared with delegate and named-agent child calls.
- Workflow agent steps support an optional max-total-token budget through the
  validated step/config path, with a conservative default of no token budget
  unless a shipped autonomy preset deliberately sets one.
- Agent execution refuses to start another model turn once the ledger is
  exhausted and fails with `token_budget_exhausted`.
- KOTA-native loop, delegate, OpenAI-tools harness, Gemini harness, and any
  existing harness-neutral agent-step adapter path that already reports usage
  debit the ledger with focused coverage.
- A provider/harness path with missing usage is represented as unsupported or
  non-enforcing for token-budgeted runs; it does not silently pass as covered.
- Run artifacts expose budget, consumed input/output/total tokens, remaining
  budget, and exhaustion reason. Control-monitor coverage or the existing
  operator report surfaces token-budget enforcement as a synchronous control
  when present.
- Tests cover an under-budget run, an over-budget multi-turn run, a delegated
  child consuming parent budget, a narrower child budget that still debits the
  parent, and a missing-usage harness diagnostic.
- Existing cost-budget, per-step cost-cap, model output-limit, delegate-budget,
  workflow retry, and tracing tests remain green.

## Source / Intent

Explorer run `2026-06-23T00-51-12-471Z-explorer-y9uu3k` reviewed an empty
actionable queue (`ready=0`, `doing=0`, `backlog=0`). The surfaced strategic
blocked alternatives all still require operator-captured evidence and were not
movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External sources checked:

- `https://github.com/openai/codex/releases` latest stable release
  `0.142.0` (June 22, 2026) adds configurable rollout token budgets that track
  usage across agent threads, show remaining-budget reminders, and abort turns
  when exhausted. The KOTA-relevant signal is the resource primitive, not
  Codex's exact UI.
- `https://github.com/anthropics/claude-code/releases` was refreshed for
  peer-runtime context; its latest listed changes reinforce shell-output and
  settings guardrail behavior already covered by KOTA's tool policy work.
- `https://modelcontextprotocol.io/specification/draft/server/tools` was
  refreshed after the prior MCP stale-tool work; the current tool-list and
  `x-mcp-header` signals are already covered by completed MCP declaration and
  tool-schema tasks.
- `https://arxiv.org/abs/2602.02262` (OmniCode) reinforces broader
  software-engineering eval coverage, but opening another live eval fixture
  would duplicate the current operator-capture tail rather than provide
  actionable ready work.

Local overlap check:

- `task-workflow-cost-budget`, `task-workflow-agent-step-cost-cap`,
  `task-per-workflow-cost-cap`, and `task-workflow-cost-anomaly-alerts` cover
  USD spend, not provider-neutral aggregate token usage.
- `task-apply-model-specific-output-limits-to-delegated-mo` covers
  per-request output-token limits after model routing, not a run-scoped budget
  across turns and child agents.
- `task-bound-recursive-delegate-spawning-with-depth-and-c` covers recursive
  delegate depth and active-child count, not how much model context those
  allowed children consume.
- Existing tracing and eval artifacts record input/output token counts after
  the fact, but no open task or implementation turns those counts into a
  synchronous budget that can stop the next model turn.

## Initiative

Autonomous runtime guardrails: KOTA should bound agent work with resource
primitives that are visible, provider-neutral where possible, and enforced at
the same runtime boundary that starts model turns.

## Acceptance Evidence

- Focused unit test transcript for the token-budget ledger, including
  under-budget, over-budget, missing-usage, and parent/child debit cases.
- Focused workflow/delegate test transcript showing a multi-turn workflow agent
  run stops before the next turn once the ledger is exhausted and a delegated
  child consumes the parent budget.
- Focused harness-adapter test transcript for every usage-reporting path that
  is wired into the ledger, including OpenAI-tools and Gemini harness adapters.
- Sample run artifact under `.kota/runs/<run-id>/` or fixture output showing
  configured budget, consumed input/output/total tokens, remaining tokens, and
  `token_budget_exhausted` on an exhausted run.
- `pnpm run validate-tasks`, relevant focused tests, `pnpm run typecheck`, and
  `pnpm run lint` pass.
