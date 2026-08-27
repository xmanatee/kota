---
status: done
---

# Security review: The shared config masker does not treat private-key-shaped fields such as privateKeyPem as sensitive, so config introspection surfaces can serialize raw private signing key material from KotaConfig/module config objects. The repo now has OAuth private_key_jwt support that uses privateKeyPem, while runtime error redaction treats that value as secret.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/config/config-redaction.ts
claim:

> The shared config masker does not treat private-key-shaped fields such as privateKeyPem as sensitive, so config introspection surfaces can serialize raw private signing key material from KotaConfig/module config objects. The repo now has OAuth private_key_jwt support that uses privateKeyPem, while runtime error redaction treats that value as secret.

## Desired Outcome

> Extend config redaction to private-key-shaped names such as privateKey, privateKeyPem, private_key, signingKey, and clientAssertion; add focused tests for maskConfig plus agent_status/config-route serialization to prove privateKeyPem never appears.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-23T00-20-09-152Z-security-review-gm58q0.

finding id: config-private-key-redaction-gap
candidate id: secret-handling:src/core/config/config-redaction.ts:28
verdict: confirmed
rationale:

> Confirmed for the shared config redaction path. src/core/config/config-redaction.ts only matches auth/token/password-style key names, so privateKeyPem is not masked; both agent_status and /api/config serialize maskConfig(config). A local probe showed modules.demo.privateKeyPem remains visible while clientSecret is masked. The specific MCP private_key_jwt config is loaded from .kota/mcp.json rather than KotaConfig, but privateKeyPem is a real secret field and the masker leaks any KotaConfig/module config value with that key shape.

Evidence:

Evidence 1:

path: src/core/config/config-redaction.ts

line: 28

excerpt:

> /(authorization|bearer|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie)/i;

Evidence 2:

path: src/core/config/config-redaction.ts

line: 43

excerpt:

> result[key] = isSensitiveConfigKey(key) ? "***" : walkAndMask(nested);

Evidence 3:

path: src/modules/config/routes.ts

line: 13

excerpt:

> jsonResponse(res, 200, { config: maskConfig(config) } satisfies ConfigResponse);

Evidence 4:

path: src/core/tools/agent-status.ts

line: 261

excerpt:

> const config = maskConfig(_configProvider());

Evidence 5:

path: src/core/tools/agent-status.ts

line: 272

excerpt:

> lines.push(`- ${key}: ${JSON.stringify(val)}`);

Evidence 6:

path: src/core/config/config.ts

line: 65

excerpt:

> modules?: Record<string, Record<string, unknown>>;

Evidence 7:

path: src/core/mcp/manager-config-auth-clients.ts

line: 144

excerpt:

> privateKeyPem: requiredString(value.privateKeyPem, "authorization.client.privateKeyPem"),

Evidence 8:

path: src/core/mcp/client.test.ts

line: 6111

excerpt:

> it("redacts private_key_jwt private keys, assertions, and acquired bearer tokens from runtime failures", async () => {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/config/config-redaction.test.ts src/core/tools/agent-status.test.ts src/modules/config/routes.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
