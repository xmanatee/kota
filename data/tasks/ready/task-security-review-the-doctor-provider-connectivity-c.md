---
id: task-security-review-the-doctor-provider-connectivity-c
title: Security review: The doctor provider-connectivity check exposes the first eight characters of the resolved provider API key in operator and daemon-control output.
status: ready
priority: p3
area: security
task_class: Safety
summary: The doctor provider-connectivity check exposes the first eight characters of the resolved provider API key in operator and daemon-control output.
created_at: 2026-07-08T07:07:20.507Z
updated_at: 2026-07-08T07:07:20.507Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/doctor/doctor-checks.ts
claim:

> The doctor provider-connectivity check exposes the first eight characters of the resolved provider API key in operator and daemon-control output.

## Desired Outcome

> Stop rendering API key prefixes in doctor details; use a non-secret indicator such as key=(set) or the configured secret/env name, and add tests asserting doctor text/JSON output does not contain API key substrings.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-08T06-54-51-701Z-security-review-8c1w18.

finding id: doctor-provider-api-key-prefix-leak
candidate id: secret-handling:src/modules/doctor/doctor-checks.ts:278
verdict: confirmed
rationale:

> src/modules/doctor/doctor-checks.ts:360-367 resolves the provider API key and formats keyDisplay from apiKey.slice(0, 8); src/modules/doctor/doctor-checks.ts:386 and :389 include that value in pass/auth-fail details. The CLI renders check detail at src/modules/doctor/index.ts:64-70, and /doctor/run returns the report JSON at src/modules/doctor/doctor-control-routes.ts:31-32.

Evidence:

Evidence 1:



path: src/modules/model-clients/factory.ts

line: 80

excerpt:



> lookupSecret resolves configured, project-store, global-store, or process.env secret values.

Evidence 2:



path: src/modules/doctor/doctor-checks.ts

line: 361

excerpt:



> const apiKey = resolveApiKey(providerType, explicitKey, { projectDir });

Evidence 3:



path: src/modules/doctor/doctor-checks.ts

line: 365

excerpt:



> const keyDisplay = requiredKeyName ? apiKey ? `${apiKey.slice(0, 8)}...` : "(not set)" : "(not required)";

Evidence 4:



path: src/modules/doctor/doctor-checks.ts

line: 386

excerpt:



> return [pass(label, `Reachable (model: ${resolved.model}, key: ${keyDisplay})`)];

Evidence 5:



path: src/modules/doctor/doctor-control-routes.ts

line: 31

excerpt:



> const report = await runDoctorReport(ctx.cwd, opts); jsonResponse(res, 200, report);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
