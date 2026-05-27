---
id: task-security-review-effect-aware-tool-scheduling-can-b
title: Security review: Effect-aware tool scheduling can batch `web_fetch` calls with `save_to` as read-only even though the call writes to the project filesystem, so autonomous tool calls can race or observe stale file state despite the mutating-call serialization boundary.
status: ready
priority: p2
area: security
summary: Effect-aware tool scheduling can batch `web_fetch` calls with `save_to` as read-only even though the call writes to the project filesystem, so autonomous tool calls can race or observe stale file state despite the mutating-call serialization boundary.
created_at: 2026-05-27T23:40:09.392Z
updated_at: 2026-05-27T23:40:09.392Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/tools/tool-runner.ts
claim: Effect-aware tool scheduling can batch `web_fetch` calls with `save_to` as read-only even though the call writes to the project filesystem, so autonomous tool calls can race or observe stale file state despite the mutating-call serialization boundary.

## Desired Outcome

Make scheduling use the same per-call mutation classification used by guardrails, or otherwise mark input-dependent writes such as `web_fetch.save_to` as barriers before batching. Add a tool-runner regression test where `web_fetch` with `save_to` does not run concurrently with adjacent read-only calls.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T23-32-41-822Z-security-review-etsxa5.

finding id: security-review-2026-05-27-001
candidate id: external-fetch:src/modules/web-access/private-network.ts:156
verdict: confirmed
rationale: Confirmed at HEAD 7bab63a396e4c8e339ab36327ce4cacbcde64725. The scheduler decides batching before per-call guardrail assessment: src/core/tools/tool-runner.ts:133 treats local tools as read-only solely when getToolEffect(name).kind is "read", and src/core/tools/tool-runner.ts:151 batches those calls through Promise.all. web_fetch is registered with networkReadEffect() at src/modules/web-access/index.ts:24, while guardrails separately classify web_fetch/http_request save_to as a local filesystem write at src/core/tools/guardrails-classify.ts:434 and runWebFetch writes save_to content at src/modules/web-access/web-fetch.ts:133. Because default and non-interactive moderate policies allow execution, web_fetch with save_to can run in a read-only batch despite mutating project files.

Evidence:

- src/core/tools/tool-runner.ts:133 - isReadOnlyToolCall decides batching from static tool effect metadata.
- src/modules/web-access/index.ts:24 - web_fetch is registered with networkReadEffect().
- src/core/tools/guardrails-classify.ts:434 - web_fetch save_to is classified as a local filesystem write.
- src/modules/web-access/web-fetch.ts:133 - savePath mode writes fetched response content to disk.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
