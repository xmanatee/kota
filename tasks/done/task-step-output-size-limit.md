---
id: task-step-output-size-limit
title: Cap step output size to prevent large outputs from flooding disk and agent context
status: done
priority: p3
area: reliability
summary: Code steps and trigger steps can return arbitrarily large outputs. There is no cap on what gets written to the run store or injected into subsequent agent step context. A size limit with truncation and a warning would protect against runaway outputs filling disk or ballooning token spend.
created_at: 2026-04-02T05:47:58Z
updated_at: 2026-04-02T07:30:00Z
---

## Problem

`run-executor-step.ts` writes the raw step output to the run artifact store via
`active-run-handle.ts`, and `step-executor-agent.ts` injects step outputs into agent
context via `shareOutput`. If a code step returns a large array or a trigger step receives
a large payload, the serialized output can be megabytes — growing the run artifact on disk
and injecting an enormous block into the agent's context window, driving up token cost
unpredictably.

There is no configured or hard-coded size limit, no truncation, and no warning emitted when
outputs are unusually large.

## Desired Outcome

- A configurable `workflow.maxStepOutputBytes` config field (default: 256 KB).
- When a step output exceeds the limit, the stored output is replaced with a structured
  truncation notice: `{ truncated: true, originalBytes: N, message: "..." }`.
- The truncation is logged as a `WorkflowRunWarning` so the run surfaces a
  `completed-with-warnings` status when applicable.
- Agent steps that receive a truncated output see the truncation notice, not raw bytes —
  giving the LLM explicit context that output was cut, rather than a silent partial string.
- The limit applies to code steps, trigger step outputs, and agent step outputs; approval
  step outputs are small by design and exempt.

## Constraints

- Truncation is applied at write time in `active-run-handle.ts` or `run-executor-step.ts`,
  not scattered across executor modules.
- Hard limit of 10 MB is enforced even when `maxStepOutputBytes` is set higher, to protect
  against misconfiguration.
- When no limit is configured, apply a default of 256 KB rather than no limit.
- Do not silently drop content — the truncation notice must be machine-readable so callers
  can detect and handle truncation.
- Document `workflow.maxStepOutputBytes` in `docs/CONFIG.md`.

## Done When

- Step outputs exceeding the configured limit are truncated with a structured notice.
- A warning is added to the run when truncation occurs.
- Default limit (256 KB) applies when config is absent.
- Hard cap (10 MB) applies regardless of config.
- Unit test covers truncation path, warning emission, and the hard cap.
- `docs/CONFIG.md` documents the config field.
