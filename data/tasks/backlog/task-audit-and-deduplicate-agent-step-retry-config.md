---
id: task-audit-and-deduplicate-agent-step-retry-config
title: Audit and deduplicate agent-step retry config
status: backlog
priority: p2
area: core
summary: Move shared retry defaults out of every agent step, measure real retry rate, and tighten error classification.
created_at: 2026-04-17T09:02:17.930Z
updated_at: 2026-04-17T09:02:17.930Z
---

## Problem

Every agent step in every workflow carries the same `retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 }`. That is duplicated config, not per-step tuning. The retry executor only retries classified transient provider errors (network, timeout, 5xx, "overloaded") via substring matching on error messages, which is fragile. Agent logic errors, unclassified SDK errors, validation failures, and repair-loop failures all fail on first attempt. It is not known whether real runs ever exercise the retry path, so the config may be pure theater.

## Desired Outcome

A single runtime default for agent-step retry lives in one place, and per-step `retry:` blocks exist only when a workflow has a genuinely different requirement. Error classification is structured (SDK error types / status codes), not substring matches. The decision about whether agent-produced errors (repair-loop failures, malformed tool calls) are retryable is explicit, with a clear rationale. The behavior on unclassified errors is predictable and documented.

## Constraints

- No test-only flags or hooks to make retries observable — rely on real telemetry and structured traces.
- Any retry-default change must not weaken the workflow runtime rails documented in `src/modules/autonomy/workflows/AGENTS.md`.
- The classifier change must not swallow genuinely-fatal errors behind retries; silent coercion at internal boundaries is forbidden per project engineering rules.

## Done When

- Actual retry event counts over a representative window are collected and reviewed; the data either justifies keeping retries or supports removing them.
- Per-step retry blocks are removed wherever they match the runtime default, leaving explicit overrides only where justified.
- Error classification is keyed off structured fields (SDK error types or HTTP status), not substring matches.
- The unclassified-error failure mode is documented in one place (step fails hard, run aborts, etc.) and matches actual behavior.

