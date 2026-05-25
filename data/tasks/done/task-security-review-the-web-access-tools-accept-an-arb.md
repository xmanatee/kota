---
id: task-security-review-the-web-access-tools-accept-an-arb
title: Security review: The web-access tools accept an arbitrary save_to path and write fetched response bodies there, but guardrail classification does not treat that input as a local filesystem write. This lets an agent use web_fetch or a safe-classified http_request GET to create or overwrite files outside the project, bypassing the existing outside-project file-write guardrail.
status: done
priority: p1
area: security
summary: The web-access tools accept an arbitrary save_to path and write fetched response bodies there, but guardrail classification does not treat that input as a local filesystem write. This lets an agent use web_fetch or a safe-classified http_request GET to create or overwrite files outside the project, bypassing the existing outside-project file-write guardrail.
created_at: 2026-05-25T21:56:42.180Z
updated_at: 2026-05-25T22:43:22Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/web-access/http-request.ts
claim: The web-access tools accept an arbitrary save_to path and write fetched response bodies there, but guardrail classification does not treat that input as a local filesystem write. This lets an agent use web_fetch or a safe-classified http_request GET to create or overwrite files outside the project, bypassing the existing outside-project file-write guardrail.

## Desired Outcome

Gate save_to through the same project-root path policy used for file_write/file_edit, and classify web_fetch/http_request calls with save_to as local filesystem writes. Outside-project save_to should be rejected or escalated to dangerous before execution, with focused tests proving http_request GET plus save_to is no longer safe.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-25T21-50-22-092Z-security-review-oouvk5.

finding id: web-access-save-to-guardrail-bypass
candidate id: external-fetch:src/modules/web-access/http-request.ts:112
verdict: confirmed
rationale: Confirmed. Both web-access runners write the supplied save_to path directly after fetching, with no call to the project-root outside-path check. The guardrail classifier still returns safe for http_request GET solely from the HTTP method and ignores save_to; a direct classifier probe returned safe for http_request GET with save_to=/tmp/out.txt while file_write to the same path returned dangerous. web_fetch also accepts save_to and writes the resolved absolute path; its classification is not a local filesystem write and does not enforce the outside-project policy before execution.

Evidence:

- src/modules/web-access/http-request.ts:134 - const saveTo = input.save_to as string | undefined;
- src/modules/web-access/http-request.ts:139 - mkdirSync(dirname(saveTo), { recursive: true });
- src/modules/web-access/http-request.ts:144 - writeFileSync(saveTo, buffer);
- src/modules/web-access/http-request.ts:149 - writeFileSync(saveTo, raw, "utf-8");
- src/modules/web-access/web-fetch.ts:117 - const savePath = path.resolve(input.save_to as string);
- src/modules/web-access/web-fetch.ts:123 - await writeFile(savePath, Buffer.from(buffer));
- src/core/tools/guardrails-classify.ts:456 - // http_request: GET keeps the safe-tier baseline; mutating methods are moderate.
- src/core/tools/guardrails-classify.ts:462 - return { risk: "safe", reason: "HTTP GET request" };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verified with `pnpm test src/core/tools/project-path-policy.test.ts src/core/tools/guardrails.test.ts src/modules/web-access/http-request.test.ts src/modules/web-access/web-fetch.test.ts src/http-data-pipeline.integration.test.ts`, `pnpm typecheck`, and `pnpm test`.
