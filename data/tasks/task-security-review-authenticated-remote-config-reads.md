---
status: open
priority: p2
---
# Security review: Authenticated remote config reads can still disclose credentials stored in foreignModules[].env when the environment-variable name is not secret-shaped. The redactor classifies individual key names only, so neutral names such as SESSION retain their inline values in both /config/validate and parent /config/value responses.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/config/config-redaction.ts
claim:

> Authenticated remote config reads can still disclose credentials stored in foreignModules[].env when the environment-variable name is not secret-shaped. The redactor classifies individual key names only, so neutral names such as SESSION retain their inline values in both /config/validate and parent /config/value responses.

## Desired Outcome

> Make the client-visible projection path- or schema-aware and mask every value under foreignModules[].env, regardless of the environment-variable name. Add daemon-route coverage using a credential value under a neutral env key and verify that neither /config/validate nor a foreignModules parent lookup returns it.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-02T00-51-22-124Z-security-review-oahv3n.

Confirmed by security-review workflow runs:

- 2026-09-02T00-51-22-124Z-security-review-oahv3n

finding id: config-control-foreign-module-env-disclosure
candidate id: secret-handling:src/core/config/config-redaction.ts:28
verdict: confirmed
rationale:

> src/core/config/config-redaction.ts masks values only when a key or requested path segment matches the sensitive-name pattern. src/core/config/config-sanitize.ts preserves arbitrary string values under foreignModules[].env, while src/modules/config/config-control-routes.ts exposes maskConfig(result.resolved) and maskConfigValue(result.value, key.split(".")). A runtime probe confirmed that a credential under the neutral key SESSION remains visible through whole-config, parent, and leaf projections. Existing focused tests pass but cover only secret-shaped names.

Evidence:

Evidence 1:



path: src/core/config/config-redaction.ts

line: 57

excerpt:



> result[key] = isSensitiveConfigKey(key) ? "***" : walkAndMask(nested);

Evidence 2:



path: src/core/modules/foreign-module.ts

line: 173

excerpt:



> /** Additional environment variables for the subprocess. */
> env?: Record<string, string>;

Evidence 3:



path: src/core/config/config-sanitize.ts

line: 276

excerpt:



> if (isPlainObject(entry.env)) {
>   const env: Record<string, string> = {};
>   for (const [k, v] of Object.entries(entry.env)) {
>     if (typeof v === "string") env[k] = v;
>   }

Evidence 4:



path: src/modules/config/config-control-routes.ts

line: 48

excerpt:



> jsonResponse(res, 200, {
>   ...result,
>   resolved: maskConfig(result.resolved),
> });
