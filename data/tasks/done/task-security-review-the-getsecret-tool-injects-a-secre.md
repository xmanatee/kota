---
id: task-security-review-the-getsecret-tool-injects-a-secre
title: Security review: The get_secret tool injects a secret into process.env but is registered as a read-only daemon tool, so passive and supervised autonomy gates classify credential injection as safe and do not require approval.
status: done
priority: p2
area: security
summary: The get_secret tool injects a secret into process.env but is registered as a read-only daemon tool, so passive and supervised autonomy gates classify credential injection as safe and do not require approval.
created_at: 2026-05-29T00:05:29.625Z
updated_at: 2026-05-29T00:10:36Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/secrets/index.ts
claim: The get_secret tool injects a secret into process.env but is registered as a read-only daemon tool, so passive and supervised autonomy gates classify credential injection as safe and do not require approval.

## Desired Outcome

Introduce a credential-injection effect or equivalent non-safe classification for get_secret, then add tests proving passive mode denies it and supervised mode queues it for approval before secrets enter process.env.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-28T23-56-36-287Z-security-review-09pmyn.

finding id: get-secret-safe-effect-injects-env
candidate id: secret-handling:src/modules/secrets/client.ts:13
verdict: confirmed
rationale: The get_secret runner mutates process.env in src/modules/secrets/index.ts:75-76, but the module registers it with readOnlyDaemonEffect at src/modules/secrets/index.ts:237. Read effects derive safe risk in src/core/tools/effect.ts:221-225, and resolveAutonomyGate allows safe tools before passive or supervised gating in src/core/tools/autonomy-mode.ts:43-49.

Evidence:

- src/modules/secrets/index.ts:39 - Retrieve a secret (API key, token, credential) and inject it into the environment.
- src/modules/secrets/index.ts:76 - process.env[name] = value;
- src/modules/secrets/index.ts:237 - effect: readOnlyDaemonEffect(),
- src/core/tools/effect.ts:16 - `read`        — pure observation; no state change.
- src/core/tools/effect.ts:223 - if (effect.kind === "read") {
- src/core/tools/autonomy-mode.ts:47 - if (assessment.risk === "safe") return { action: "allow" };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- 2026-05-29 verification: `pnpm test src/core/tools/effect.test.ts src/modules/secrets/index.test.ts`
  passed, `pnpm test src/core/tools/guardrails.test.ts src/core/tools/autonomy-mode.test.ts src/core/tools/autonomy-mode-boundary.integration.test.ts src/modules/secrets/index.test.ts`
  passed, `pnpm typecheck` passed, and `pnpm lint` passed.
