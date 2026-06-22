---
id: task-security-review-the-read-only-agentstatus-config-q
title: Security review: The read-only agent_status config query can disclose module and other non-modelProvider secrets to the agent because the session config provider passes all non-modelProvider config through and agent_status stringifies those values verbatim.
status: done
priority: p1
area: security
summary: The read-only agent_status config query can disclose module and other non-modelProvider secrets to the agent because the session config provider passes all non-modelProvider config through and agent_status stringifies those values verbatim.
created_at: 2026-06-22T22:57:30.478Z
updated_at: 2026-06-22T23:06:08.546Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/tools/agent-status.ts
claim:

> The read-only agent_status config query can disclose module and other non-modelProvider secrets to the agent because the session config provider passes all non-modelProvider config through and agent_status stringifies those values verbatim.

## Desired Outcome

> Mask agent_status config output recursively using the same sensitive-key policy as daemon config routes, or remove/gate the config query as sensitive. Add focused tests proving modules.*.apiKey, webhook secrets, MCP authorization, and other nested secret-shaped keys are not present in agent_status output.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T22-39-39-712Z-security-review-1qevmu.

finding id: agent-status-config-secret-disclosure
candidate id: secret-handling:src/core/loop/loop-constructor.ts:108
verdict: confirmed
rationale:

> Current code still confirms the finding: loop-constructor.ts only removes modelProvider.apiKey before registering the config provider, while agent-status.ts JSON.stringify's every other matching config entry. Core config preserves modules as arbitrary nested records, webhook config preserves per-workflow secret strings, and module configs such as linear.apiKey are accepted secret-bearing values. The tool-runner secret masker only masks values already known to the secret store, so raw or not-yet-registered config secrets can still reach agent_status output.

Evidence:

Evidence 1:



path: src/core/loop/loop-constructor.ts

line: 223

excerpt:



> setConfigProvider(() => {

Evidence 2:



path: src/core/loop/loop-constructor.ts

line: 224

excerpt:



> const { modelProvider, ...safe } = cfg;

Evidence 3:



path: src/core/tools/agent-status.ts

line: 271

excerpt:



> if (key === "modelProvider" && typeof val === "object" && val !== null) {

Evidence 4:



path: src/core/tools/agent-status.ts

line: 276

excerpt:



> lines.push(`- ${key}: ${JSON.stringify(val)}`);

Evidence 5:



path: src/core/config/config.ts

line: 64

excerpt:



> Per-module configuration. Keys are module names, values are module-specific settings.

Evidence 6:



path: src/modules/linear/index.ts

line: 10

excerpt:



> apiKey: string;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Fixed by shared recursive config redaction in `src/core/config/config-redaction.ts`, used by both `src/core/tools/agent-status.ts` and `src/modules/config/routes.ts`.
- Focused regression: `pnpm test src/core/tools/agent-status.test.ts src/modules/config/routes.test.ts` - 2 files passed, 36 tests passed.
- Boundary checks: `pnpm run typecheck`, `pnpm test src/strict-types-policy.integration.test.ts`, and `pnpm run lint` all passed.
