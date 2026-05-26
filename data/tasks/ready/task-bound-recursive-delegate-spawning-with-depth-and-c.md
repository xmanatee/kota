---
id: task-bound-recursive-delegate-spawning-with-depth-and-c
title: Bound recursive delegate spawning with depth and concurrency limits
status: ready
priority: p2
area: core
summary: Add explicit depth and concurrency controls around KOTA's delegate sub-agent tool so execute-mode delegates cannot recursively spawn unbounded sub-agents or fan out concurrent delegate calls without a typed runtime budget.
created_at: 2026-05-26T14:57:21.408Z
updated_at: 2026-05-26T14:57:21.408Z
---

## Problem

KOTA's native `delegate` tool can recursively expose itself. The top-level
delegate runner builds execute-mode sub-agent tools from every registered
non-destructive tool, and the `delegate` tool is registered with a local-write
effect. That means an execute-mode delegate can ask for another execute-mode
delegate, and a model can produce multiple delegate tool calls in one assistant
turn. The current controls bound turns, identical repeated failures, shell
timeouts, and model output tokens, but they do not bound delegate-tree depth or
concurrent child delegate starts.

Peer runtimes are now treating this as an explicit guardrail. GitHub Copilot
CLI's changelog records sub-agent depth and concurrency limits to prevent
runaway spawning. KOTA should carry the same invariant in its typed delegate
runtime rather than relying on prompt guidance or spend controls.

## Desired Outcome

Delegate execution has an explicit runtime budget for recursive delegation:

- A top-level delegate tree has a maximum depth and a maximum number of active
  child delegates.
- Nested delegate calls consume that budget before starting model work.
- Calls beyond the budget fail loudly with a deterministic tool result that
  names the exceeded limit.
- At the depth limit, sub-agents either do not receive the `delegate` tool or
  receive only a budget-exhausted path; they cannot silently start another
  sub-agent.
- Status/output metadata makes depth and limit exhaustion visible enough for
  operators and tests to diagnose runaway-delegation prevention.

## Constraints

- Keep the boundary in the core delegate runtime and its existing tool
  protocol. Do not add prompt-only guidance, global daily spend caps, or
  test-only flags as the primary control.
- Preserve normal single-level delegate behavior and existing explore,
  execute, and research mode semantics.
- Do not make the native delegate runner depend on a specific harness adapter.
  Harness-backed delegation should either inherit the same budget where KOTA
  tools are exposed or stay explicit about why it cannot recurse through KOTA's
  delegate tool.
- Keep defaults conservative and typed. If configuration is introduced, the
  absence of a value should resolve to a clear default rather than an
  unbounded path.

## Done When

- Native delegate calls enforce a default maximum recursive depth and active
  child-delegate concurrency limit per top-level delegate tree or session.
- A nested execute-mode delegate at the depth limit cannot start another
  delegate model call.
- Parallel delegate tool calls that would exceed the active-child limit produce
  deterministic budget-exhausted tool results for the excess calls.
- Delegate result metadata, status output, or structured diagnostics expose
  the relevant depth/limit condition.
- Focused regression tests cover successful normal delegation, depth-limit
  rejection, and concurrent child-limit rejection.
- Existing delegate, loop, and harness-neutral routing tests still pass.

## Source / Intent

Explorer run `2026-05-26T14-54-54-291Z-explorer-wah622` reviewed a thin
queue. Existing strategic blocked tasks were all operator-capture waits and not
movable, while GitHub Copilot CLI surfaced a concrete peer-runtime guardrail:
its changelog says sub-agent depth and concurrency limits were added to prevent
runaway agent spawning.

External source:

- `https://github.com/github/copilot-cli/blob/main/changelog.md`

Local evidence:

- `src/core/tools/delegate.ts` registers `delegate` with a local-write effect
  and, for native execute mode, builds the sub-agent tool set from registered
  non-destructive tools.
- `src/core/agents/delegate-prompts.ts` resolves execute-mode sub-agent tools
  by effect kind and does not exclude the `delegate` tool.
- `src/core/tools/delegate-turn.ts` bounds turns and repeated identical
  failures but has no delegate-tree depth or active-child budget.

## Initiative

Autonomous runtime guardrails: recursive agent delegation should remain useful
for separable work without allowing accidental unbounded fan-out.

## Acceptance Evidence

- Focused test transcript for delegate depth and active-child budget coverage.
- `pnpm test src/delegate-tool.integration.test.ts src/e2e-advanced.test.ts`
  or the narrower updated delegate test set showing existing delegate behavior
  remains intact.
