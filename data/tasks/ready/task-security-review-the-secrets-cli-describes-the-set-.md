---
id: task-security-review-the-secrets-cli-describes-the-set-
title: Security review: The secrets CLI describes the set prompt as hidden input, but it uses plain readline, so newly entered secret values are echoed in the operator terminal while typing.
status: ready
priority: p3
area: security
summary: The secrets CLI describes the set prompt as hidden input, but it uses plain readline, so newly entered secret values are echoed in the operator terminal while typing.
created_at: 2026-05-26T19:58:42.669Z
updated_at: 2026-05-26T19:58:42.669Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/secrets/index.ts
claim: The secrets CLI describes the set prompt as hidden input, but it uses plain readline, so newly entered secret values are echoed in the operator terminal while typing.

## Desired Outcome

Use a no-echo TTY prompt for `kota secrets set` or change the command contract so operators are not told the input is hidden when it is visible.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T19-49-22-030Z-security-review-h4k45s.

finding id: security-review-secret-set-echoes-input
candidate id: secret-handling:src/modules/secrets/client.ts:13
verdict: confirmed
rationale: The secret set path calls promptSecretValue, which creates a normal readline interface and reads the next line without disabling TTY echo or using raw-mode masking. The hidden-input claim is source-comment wording rather than CLI help text, but the operational issue remains: interactive secret entry is visible while typed.

Evidence:

- src/modules/secrets/index.ts:84 - /** Prompt the user for a secret value on stdin (hidden input). */
- src/modules/secrets/index.ts:87 - const rl = createInterface({ input: process.stdin, output: process.stderr });
- src/modules/secrets/index.ts:90 - rl.on("line", (line) => {
- src/modules/secrets/index.ts:133 - value = await promptSecretValue(name);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
