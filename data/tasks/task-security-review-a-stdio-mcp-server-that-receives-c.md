---
status: open
priority: p2
---

# Security review: A stdio MCP server that receives configured transport env secrets can write those secrets to stderr and KOTA forwards them to terminal diagnostics without applying the existing MCP secret redaction path.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-connection.ts
claim:

> A stdio MCP server that receives configured transport env secrets can write those secrets to stderr and KOTA forwards them to terminal diagnostics without applying the existing MCP secret redaction path.

## Desired Outcome

> Redact stdio MCP stderr chunks with the same configured-secret redaction used for MCP request errors before calling writeTerminalStderr, and add a regression test where a stdio MCP fixture prints a configured env secret to stderr.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-21T11-50-06-293Z-security-review-xhrwer.

finding id: mcp-stdio-stderr-secret-diagnostic-leak
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:14
verdict: confirmed
rationale:

> McpStdioClientTransportConfig allows env values at src/core/mcp/client-auth-types.ts:17, and connectStdio passes those values into the spawned process at src/core/mcp/client-connection.ts:76. The child stderr handler writes stderr directly via writeTerminalStderr at src/core/mcp/client-connection.ts:93-95; writeTerminalStderr forwards text unchanged at src/core/modules/terminal-renderer.ts:31-37. The existing redaction path includes stdio env values at src/core/mcp/client-base.ts:389-391 and applies them at src/core/mcp/client-base.ts:419-424, but that path is not called by the stderr handler. Existing coverage at src/core/mcp/manager.test.ts:412-457 proves stdio env values are redacted from MCP tool errors, not from stderr diagnostics.

Evidence:

Evidence 1:

path: src/core/mcp/client-auth-types.ts

line: 17

excerpt:

> env?: Record<string, string>;

Evidence 2:

path: src/core/mcp/client-connection.ts

line: 76

excerpt:

> env: buildMcpStdioSubprocessEnv(this.transport.env),

Evidence 3:

path: src/core/mcp/client-connection.ts

line: 95

excerpt:

> if (text) writeTerminalStderr(`[mcp:${this.serverName}] ${text}\n`);

Evidence 4:

path: src/core/mcp/client-base.ts

line: 390

excerpt:

> for (const value of Object.values(this.transport.env ?? {})) add(value);

Evidence 5:

path: src/core/mcp/client-base.ts

line: 421

excerpt:

> for (const value of this.sensitiveValuesForRedaction()) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Resolution

Stdio MCP stderr diagnostics now pass through the same configured-secret
redaction set used for MCP request errors before terminal output.

Verification:

- `pnpm test src/core/mcp/stdio-stderr-redaction.test.ts` passed.
- `pnpm exec biome check src/core/mcp/client-connection.ts src/core/mcp/stdio-stderr-redaction.test.ts` passed.
- Source-size severe evaluation returned advisory only after the regression moved out of the oversized manager test.
- `pnpm typecheck` passed.
- `pnpm validate-tasks` passed.

security family: ebf3e31fe9ef7437065007c0457d0c02fc9706c649c304972f4fa069cae28a8b

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-notifications.ts
claim:

> Peer-controlled subscription errors and progress-warning fields bypass MCP credential redaction. A production-client probe with a synthetic bearer credential reproduced its appearance in terminal output through both paths, while ordinary request-error redaction removes the same value.

## Desired Outcome

> Apply the MCP client's configured-secret redactor to complete notification and subscription diagnostics before terminal publication. Preserve the existing stdio stderr protection. One client-owned diagnostic redaction boundary can cover both the earlier stderr variant and these notification variants.

> Independently validate the family nomination and retain the predecessor's resolution evidence when recording this new variant. Exercise public client subscription and request streams with synthetic credential echoes. The run artifact mcp-boundary-probes.json records both reproduced disclosures without live credentials or network access.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T00-35-54-058Z-security-review-2o6hi1.

Confirmed by security-review workflow runs:

- 2026-09-13T00-35-54-058Z-security-review-2o6hi1

security evidence: 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857
evidence identity: mcp-progress-and-subscription-secret-echo-v1
Evidence lineage (new-variant): mcp-stdio-stderr-secret-diagnostic-leak
> The completed predecessor protects configured credentials echoed through stdio stderr using the shared MCP redactor. These variants instead echo an HTTP bearer credential through a subscription error or an inactive progress token, whose diagnostics bypass that redactor. This is additional evidence, not a demonstrated reintroduction of the repaired stderr sink.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Apply the MCP client's configured-secret redactor to complete notification and subscription diagnostics before terminal publication. Preserve the existing stdio stderr protection. One client-owned diagnostic redaction boundary can cover both the earlier stderr variant and these notification variants.
Exploit preconditions:
> An attacker controls a configured HTTP MCP peer receiving a bearer credential. The peer can return SSE notifications during a request or advertise list-change support and return a subscription error. Disclosure reaches terminal output and any downstream capture of that output; exploitation does not require access to another server's credential.
finding id: mcp-notification-diagnostic-credential-disclosure
candidate id: mcp-transport:src/core/mcp/client-notifications.ts:1
verdict: confirmed
rationale:

> An independent public-client probe reproduced synthetic credential disclosure through both subscription-error messages and inactive progress-token warnings. Both bypass client-base's configured-secret redactor; terminal rendering strips controls but does not redact credentials. A configured HTTP peer receiving the credential can echo it into terminal diagnostics. The nominated completed task retains historical finding mcp-stdio-stderr-secret-diagnostic-leak, and its stderr protection remains present. These are new diagnostic variants, not a regression of that sink. Applying the shared client redactor before diagnostic publication addresses both variants while preserving the predecessor repair.

Evidence:

Evidence 1:



path: src/core/mcp/client-notifications.ts

line: 111

excerpt:



> printTerminalDiagnostic(
>         `[kota] Warning: MCP server "${this.serverName}" failed to open subscription: MCP error ${msg.error.code}: ${msg.error.message}`,
>         "warn",
>       );

Evidence 2:



path: src/core/mcp/client-notifications.ts

line: 204

excerpt:



> const state = this.activeProgressByToken.get(progressTokenKey(token));
>     if (!state) {
>       this.warnProgress(
>         `ignored progress notification for inactive token "${String(token)}"`,
>       );

Evidence 3:



path: src/core/mcp/client-notifications.ts

line: 329

excerpt:



> protected warnProgress(message: string): void {
>     if (this.progressWarningCount < MAX_PROGRESS_WARNINGS) {
>       printTerminalDiagnostic(
>         `[kota] Warning: MCP server "${this.serverName}" ${message}`,
>         "warn",
>       );

Evidence 4:



path: src/core/mcp/client-base.ts

line: 419

excerpt:



> protected redactSensitiveErrorMessage(message: string): string {
>     let redacted = message;
>     for (const value of this.sensitiveValuesForRedaction()) {
>       redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");
>     }
>     return redacted;
