---
id: task-audit-cores-use-of-anthropic-aisdk-message-types-a
title: Audit core's use of @anthropic-ai/sdk message types and plan a harness-neutral core message protocol
status: backlog
priority: p1
area: architecture
summary: ~30 core files import type Anthropic from @anthropic-ai/sdk and use MessageParam / ContentBlock / Tool* shapes as the canonical internal message protocol across loop, tools, model, manifest, and workflow. Produce an audit and a staged plan for making core's message protocol harness-neutral, so core stops depending on the Anthropic SDK as its implicit message contract.
created_at: 2026-04-24T03:42:12.261Z
updated_at: 2026-04-24T03:42:12.261Z
---

## Problem

Recent work has carved claude-agent-sdk-specific types (`SDKQueryOptions`,
step-options, the delegate-harness backend, permission-mode literals) out
of core into the claude-agent-harness module, and renamed remaining
wire-frame types to harness-neutral names. Underneath all of that, ~30
core files still do `import type Anthropic from "@anthropic-ai/sdk"` and
use `Anthropic.MessageParam`, `Anthropic.ContentBlock`,
`Anthropic.Tool*`, and related shapes as the canonical internal message
protocol. That includes the conversation loop (`src/core/loop/*`), tool
runtime (`src/core/tools/*`), the model client layer
(`src/core/model/*`), manifest execution, foreign-module IPC, and
workflow run/executor code.

The architectural intent in `src/core/agent-harness/AGENTS.md` is that
core treats message shapes as neutral and no core file imports the
claude-agent-sdk. At the type level that is already true — the imports
above are all `@anthropic-ai/sdk` (the base SDK), not
`@anthropic-ai/claude-agent-sdk`. But the distinction is superficial:
core's canonical message contract is still Anthropic's SDK type surface,
which means a harness whose native wire shape does not map cleanly onto
`Anthropic.MessageParam` (e.g. the OpenAI-tools adapter, future codex /
Gemini / local-model adapters) has to translate at the adapter seam on
every turn. That tax is what makes "general-purpose coding agent across
pluggable harnesses" still aspirational rather than structural.

## Desired Outcome

- A written audit, co-located with the core boundary doc, enumerating
  every `import type Anthropic from "@anthropic-ai/sdk"` in core and
  classifying each by role:
  - internal message/content shapes used across the loop and tools
  - tool-definition / schema shapes
  - model-client request/response shapes
  - test-only fixtures
  - genuinely neutral types that happen to be re-exported through the
    Anthropic namespace
- A staged, incremental plan that turns each load-bearing class into a
  KOTA-owned neutral type, in a sequence that keeps the tree green at
  every step (modeled after the recent SDK-options / step-fields /
  executor carve-outs).
- A clear boundary statement: which neutral types core owns, which
  translations each harness adapter is responsible for at its seam, and
  what test coverage proves parity.

## Constraints

- This task produces a plan, not the full replacement. The audit and
  sequencing are the deliverable; implementation is one or more follow-up
  tasks keyed off this plan.
- The plan must not call for a big-bang replacement. Each step should be
  landable on its own without turning the tree red.
- The plan must not introduce a parallel message type that lives beside
  the Anthropic shapes indefinitely. The endpoint is a single neutral
  protocol core owns, with adapter-local translation.
- Test fixtures that build `Anthropic.MessageParam` literals should be
  migrated to the neutral type as each area is converted; the plan must
  name how fixture churn is contained.
- Do not propose changes to module-side code that legitimately speaks the
  Anthropic SDK (e.g. the claude-agent-harness module) beyond boundary
  translation.

## Done When

- A checked-in document (inside `src/core/agent-harness/` or an adjacent
  core-boundary location — pick the narrowest applicable) captures the
  full import audit and the staged plan.
- The plan names concrete follow-up tasks (titles + scope) so explorer or
  a future builder can seed them directly without re-doing the audit.
- `src/core/agent-harness/AGENTS.md` cross-references the audit so the
  boundary claim ("nothing in core imports the claude-agent-sdk") is
  upgraded to the stronger claim ("nothing in core treats Anthropic's SDK
  type surface as its internal protocol").
