---
status: done
---

# Security review: Provider-authenticated Gemini launches are not fully disabled on macOS. The guard detects API-key environment variables and two cached OAuth files, but Gemini CLI 0.46.0 can load a selected Gemini API key from the system Keychain. KOTA preserves the selected authentication mode, and its macOS sandbox allows unspecified operations by default, leaving Keychain access available to the native process tree. A keychain-backed API key can therefore authenticate the supposedly credential-free native loop without triggering readiness or launch rejection.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/gemini-cli-agent-harness/runtime-home.ts
claim:

> Provider-authenticated Gemini launches are not fully disabled on macOS. The guard detects API-key environment variables and two cached OAuth files, but Gemini CLI 0.46.0 can load a selected Gemini API key from the system Keychain. KOTA preserves the selected authentication mode, and its macOS sandbox allows unspecified operations by default, leaving Keychain access available to the native process tree. A keychain-backed API key can therefore authenticate the supposedly credential-free native loop without triggering readiness or launch rejection.

## Desired Outcome

> Prevent Gemini from consulting the native system Keychain before declaring launches credential-free. Force Gemini's credential storage to an empty invocation-scoped file backend and/or deny Keychain IPC in the outer sandbox, avoid preserving an API-key auth selection without an approved broker, and add passive and autonomous regressions proving a keychain-backed Gemini API key cannot authenticate or start the native loop.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-05T16-51-51-839Z-security-review-v1i07b.

finding id: gemini-keychain-auth-bypasses-launch-denial
candidate id: secret-handling:src/modules/gemini-cli-agent-harness/auth-readiness.ts:82
verdict: confirmed
rationale:

> runtime-home.ts:17-24 and 85-123 rejects only two credential environment variables and two files, then preserves security.auth.selectedType in the isolated settings. auth-readiness.ts:77-149 likewise never checks system Keychain storage. The macOS profile in machine-authority-sandbox.ts:83-115 begins with (allow default) and adds file/network restrictions without denying Keychain IPC. Installed Gemini CLI 0.46.0 uses the system Keychain service gemini-cli-api-key, accepts loadApiKey() during auth validation, and KOTA does not force GEMINI_FORCE_FILE_STORAGE. The gemini-cli preset also has authEnv: [] and the direct CLI path launches after preset-only preflight, so workflow-step readiness does not eliminate direct or interactive reachability.

Evidence:

Evidence 1:

path: src/modules/gemini-cli-agent-harness/runtime-home.ts

line: 17

excerpt:

> The launch guard enumerates only GEMINI_API_KEY and GOOGLE_API_KEY plus oauth_creds.json and google_accounts.json as credential-bearing inputs; it has no system-Keychain boundary.

Evidence 2:

path: src/modules/gemini-cli-agent-harness/runtime-home.ts

line: 67

excerpt:

> isolatedAuthSettings preserves selectedAuthType and security.auth.selectedType from the host Gemini settings, allowing the isolated CLI to retain the gemini-api-key authentication selection.

Evidence 3:

path: src/modules/gemini-cli-agent-harness/auth-readiness.ts

line: 80

excerpt:

> geminiCliAuthReadiness checks the two API-key environment variables, oauth_creds.json, and google_accounts.json before returning missing; it does not probe or conservatively reject keychain-backed authentication.

Evidence 4:

path: src/core/agent-harness/machine-authority-sandbox.ts

line: 83

excerpt:

> The macOS profile begins with (allow default) and subsequently restricts network and filesystem operations, but does not deny Keychain/security-service IPC.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

Gemini CLI launches now force the file credential backend into the
invocation-scoped home and reject both supported `gemini-api-key` selection
shapes before the native process starts. The blocking rollout decision is
recorded in this builder run's `autonomy-change-decision.json`.

## Verification

- `pnpm test src/modules/gemini-cli-agent-harness/runtime-home.test.ts src/modules/gemini-cli-agent-harness/auth-readiness.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/strict-types-policy.integration.test.ts src/cli.test.ts src/module-cli-commands.integration.test.ts`
  passed 71 tests across 6 files.
- The builder autonomy-change check reports that
  `autonomy-change-decision.json` covers all 3 staged material autonomy files.
- Detailed code-level and environment evidence is projected at
  `.kota/runs/2026-08-06T04-43-05-036Z-builder-en13sv/evidence/artifacts/validation.txt`.
