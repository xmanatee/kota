---
status: done
---
# Security review: The authenticated operator UI can disclose inline configuration secrets because config.get returns an unredacted resolved value and the UI renders it verbatim, bypassing the repository's established config-redaction boundary.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/daemon-ops/operator-ui-content-actions.ts
claim:

> The authenticated operator UI can disclose inline configuration secrets because config.get returns an unredacted resolved value and the UI renders it verbatim, bypassing the repository's established config-redaction boundary.

## Desired Outcome

> Redact config.get results at the shared remote/client boundary: mask the entire value when the requested path contains a sensitive key and recursively mask secret-shaped fields inside returned objects or arrays. Apply the same protection to remotely returned config.validate resolved data, while separating any intentionally raw local-only CLI operation. Add coverage proving UI and daemon responses never contain inline apiKey, token, password, private-key, authorization, or cookie values.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-01T23-31-10-894Z-security-review-fhz5jq.

Confirmed by security-review workflow runs:

- 2026-09-01T23-31-10-894Z-security-review-fhz5jq

finding id: operator-ui-config-secret-disclosure
candidate id: auth-approval-boundary:src/modules/daemon-ops/operator-ui-content-actions.ts:174
verdict: confirmed
rationale:

> The config control routes return unredacted resolved configuration: getConfigValue traverses loadConfig directly, /config/value serializes that result verbatim, and /config/validate returns the raw resolved object. The daemon client preserves those responses, and the operator UI renders config.get values verbatim. This contradicts the module's explicit HTTP-redaction policy and the existing /api/config route, which applies maskConfig. Authentication limits access but does not satisfy the established secret-redaction boundary; inline API keys, tokens, passwords, authorization headers, cookies, and private keys can therefore reach authenticated remote clients and the UI.

Evidence:

Evidence 1:



path: src/modules/daemon-ops/operator-ui-content-actions.ts

line: 154

excerpt:



> const result = await client.config.get(key);

Evidence 2:



path: src/modules/daemon-ops/operator-ui-content-actions.ts

line: 158

excerpt:



> const value = typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);

Evidence 3:



path: src/modules/config/config-operations.ts

line: 73

excerpt:



> export function getConfigValue(scopeRoot: string, key: string): ConfigGetResult { return getConfigPath(loadConfig(scopeRoot), key.split(".")); }

Evidence 4:



path: src/modules/config/config-control-routes.ts

line: 45

excerpt:



> method: "GET", path: "/config/value", capabilityScope: "read"

Evidence 5:



path: src/core/config/config-redaction.ts

line: 43

excerpt:



> result[key] = isSensitiveConfigKey(key) ? "***" : walkAndMask(nested);

## Final Verification

- Config daemon-control reads now mask a sensitive requested path in full and
  recursively redact secret-shaped fields in returned objects and arrays.
  The operator UI action applies the same projection before rendering a value;
  filesystem-backed local CLI reads remain intentionally raw.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner
  --silent=true --project=owner src/modules/config/config-control-routes.test.ts
  src/modules/config/routes.test.ts src/modules/config/config.test.ts
  src/modules/config/daemon-client.test.ts
  src/modules/daemon-ops/operator-ui-capability-actions.test.ts
  src/core/config/config-redaction.test.ts` passed 6 files / 50 tests.
- `pnpm check:fast` passed production and test typechecking, lint, task
  validation, and generated client-binding freshness.
