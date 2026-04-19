---
id: task-centralize-autonomy-agent-model-and-effort-default
title: Centralize autonomy agent model and effort defaults
status: ready
priority: p2
area: autonomy
summary: Stop hardcoding model and effort on every autonomy agent definition and source them from one typed default so model bumps and operator tuning happen in one place
created_at: 2026-04-19T13:16:38.408Z
updated_at: 2026-04-19T13:16:38.408Z
---

## Problem

Every autonomy workflow agent in
`src/modules/autonomy/workflows/*/workflow.ts` independently declares
`model: "claude-opus-4-7"` and `effort: "xhigh"`. Six workflows
(`builder`, `decomposer`, `explorer`, `improver`, `inbox-sorter`,
`pr-reviewer`) repeat the same literals, and `critic.ts` adds a seventh
copy under the name `CRITIC_MODEL`. Whenever the default autonomy model or
effort changes, seven files must be edited in lockstep.

The duplication also hides a policy decision: there is no single place that
says "the autonomy fleet runs on this model at this effort level". Operators
have no single knob to tune the fleet, and future work such as model health
failover or cheaper exploration at off-hours has nowhere to land cleanly.

## Desired Outcome

- One typed default for the autonomy fleet exists in
  `src/modules/autonomy/shared.ts` (or another obvious single location) and
  is the only source of truth for the autonomy agent `model` and `effort`
  used by every workflow agent.
- The six autonomy workflows and `critic.ts` import and spread that default
  instead of repeating the literal strings, with an explicit override pattern
  for any workflow that genuinely needs to diverge (none today).
- The central default is typed such that changing the autonomy model is a
  one-line change that touches every workflow uniformly.
- Any autonomy-specific divergence (e.g. a future fast-tier explorer) is
  expressible as an override of the central default, not as a copy of the
  base value.

## Constraints

- The central default must remain a static typed value. Do not introduce
  runtime config resolution, feature flags, or environment-variable lookups
  in this task — that is a separate capability and should not be bundled.
- Do not add a new module or file that only re-exports the default. Use
  the existing `src/modules/autonomy/shared.ts` surface.
- Do not couple autonomy model choice to delegate-config, loop-constructor
  defaults, or `model-router` routing tiers. Those serve different roles
  (user-facing chat, subagent delegation). Autonomy defaults are their own
  concern.
- Do not expose model or effort tuning through the autonomy agent context.
  Agent-facing cost feeds remain forbidden. This task is about source-level
  tuning, not runtime signals to the agent.
- Keep the change typed. The `effort` value must remain the existing union
  type (`"low" | "medium" | "high" | "xhigh" | "max"`); do not widen to
  `string`.

## Done When

- A single typed default for autonomy `model` and `effort` is declared in
  `src/modules/autonomy/shared.ts` and exported for use by workflow
  definitions and `critic.ts`.
- The six autonomy workflow files no longer contain literal
  `"claude-opus-4-7"` / `"xhigh"` pairs; they spread the central default.
- `critic.ts` no longer declares its own `CRITIC_MODEL`; it uses the same
  default.
- Existing workflow and critic tests still pass without behavior change,
  and the autonomy validation (model is a known accepted value in
  `validate-agent-step.ts`) still covers the configured default.
- Grep for `"claude-opus-4-7"` in `src/modules/autonomy/` returns exactly
  one hit: the central default declaration.
