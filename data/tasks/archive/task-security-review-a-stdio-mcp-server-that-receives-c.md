---
status: done
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


## Notification variant resolution

The family nomination is confirmed: stdio env echoes and HTTP bearer echoes
violate the same client diagnostic invariant and use the same client-owned
credential set. The earlier stderr repair remains present (now in
`client-stdio-runtime.ts`); the subscription and progress disclosures were new
publication paths, not a reintroduction of the earlier sink. Historical findings
and predecessor verification above are retained.

`McpClientBase.writeDiagnostic` now redacts complete messages before terminal
publication, including server labels. Notification warnings, subscription response
errors, asynchronous subscription stream failures, rejected-tool diagnostics,
and stdio stderr use that boundary. Decoder-owned terminal publication was
removed; credential collection, protocol handling, and warning limits are unchanged.

Verification in builder run `2026-09-13T07-40-09-121Z-builder-lmbyg2`:

- `pnpm test:protocol src/core/mcp/client-diagnostic-redaction.test.ts src/core/mcp/stdio-stderr-redaction.test.ts src/core/mcp/client.test.ts`
  passed: 38 tests across three files. The new tests drive the public client
  through HTTP/SSE subscription responses, broken subscription streams, and
  request progress notifications, capturing actual terminal output. Synthetic
  bearer headers and bare tokens are removed from diagnostics while contextual
  warnings, valid progress callbacks, and successful tool results remain intact.
  The existing spawned stdio peer proves configured env stderr redaction remains.
- Before repair, subscription-response and stream-error tests reproduced cleartext
  synthetic credential output. The final tests cover the reported progress path
  as well. No live credentials or external HTTP peers were needed.
- `pnpm check:fast` passed: production/test TypeScript, lint, task validation,
  generated client bindings, and module admission. The complete static-gate log
  is this run's `check-fast.log`; behavioral output is in `mcp-tests.log`.

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-base.ts
claim:

> MCP diagnostic redaction collects only Authorization from configured HTTP headers. A peer can echo configured X-Api-Key or cookie credentials into terminal warnings and request errors unchanged. The same probe correctly redacts a bearer token.

## Desired Outcome

> Complete the client-owned diagnostic redaction boundary: collect configured credential-bearing header values and their credential components, and redact complete published errors and diagnostics after incorporating peer-controlled labels. Keep authoritative protocol values separate from diagnostic projections. This common repair covers omitted HTTP credentials and label-based reinsertion while preserving earlier bearer and stdio protections.

> Revalidate this variant within the existing diagnostic-redaction family, preserving prior resolutions. Exercise complete header and bare cookie credential echoes through public warnings and errors. mcp-header-credential-probe.json retains both disclosures and the successful bearer control.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T08-26-28-776Z-security-review-2xz9f5.

Confirmed by security-review workflow runs:

- 2026-09-13T08-26-28-776Z-security-review-2xz9f5

security evidence: f232c7f55de9e73e313e8e9414a75fb643fa8c19ca65d9fbfcde44a12bb748a3
evidence identity: mcp-non-authorization-header-credential-echo-v1
Evidence lineage (new-variant): 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857
> The predecessor protects bearer credentials echoed through notification diagnostics. Those sinks now use the shared redactor, but credential collection excludes non-Authorization headers. X-Api-Key and cookie credentials survive the repaired publication path. This is new credential-source evidence, not a regression of the bearer sink.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Complete the client-owned diagnostic redaction boundary: collect configured credential-bearing header values and their credential components, and redact complete published errors and diagnostics after incorporating peer-controlled labels. Keep authoritative protocol values separate from diagnostic projections. This common repair covers omitted HTTP credentials and label-based reinsertion while preserving earlier bearer and stdio protections.
Exploit preconditions:
> A configured HTTP MCP peer receives authentication through X-Api-Key or Cookie and echoes the credential in a progress notification or JSON-RPC error. The peer already possesses its own credential; disclosure crosses into terminal output and error consumers. Preserved public-client probes reproduced both variants using synthetic credentials and a mocked network port.
finding id: mcp-configured-header-credential-disclosure
candidate id: mcp-transport:src/core/mcp/client-base.ts:1
verdict: confirmed
rationale:

> Unchanged client-base code collects only Authorization from configured HTTP headers. Earlier independent public-client probes reproduced X-Api-Key and bare cookie credential disclosure through warnings and request errors, while the bearer control remained redacted. Retained receipts agree. The configured peer already receives its credential; the violation is publication into diagnostics and error consumers. The nominated task retains evidence key 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857 with the matching owner/invariant. This is a new credential-source variant within that family. Completing credential collection and complete-message redaction addresses it while preserving predecessor protections.

Evidence:

Evidence 1:



path: src/core/mcp/client-base.ts

line: 393

excerpt:



> if (this.transport.type === "http") {
>   for (const [key, value] of Object.entries(this.transport.headers ?? {})) {
>     if (key.toLowerCase() !== "authorization") continue;
>     add(value);
>     const bearer = /^Bearer\s+(.+)$/i.exec(value);
>     add(bearer?.[1]);
>   }

Evidence 2:



path: src/core/mcp/client-base.ts

line: 428

excerpt:



> protected writeDiagnostic(message: string, destination: "warn" | "stderr"): void {
>   const redacted = this.redactSensitiveErrorMessage(message);

Evidence 3:



path: src/core/mcp/client-base.ts

line: 437

excerpt:



> protected requestErrorForMethod(method: string, message: string): Error {
>   const redactedMessage = this.redactSensitiveErrorMessage(message);

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-base.ts
claim:

> A peer-controlled serverInfo.name is appended to MCP request errors after sensitive-value redaction. A malicious peer can place its bearer credential in that name and disclose it through subsequent errors without echoing it in the error detail.

## Desired Outcome

> Complete the client-owned diagnostic redaction boundary: collect configured credential-bearing header values and their credential components, and redact complete published errors and diagnostics after incorporating peer-controlled labels. Keep authoritative protocol values separate from diagnostic projections. This common repair covers omitted HTTP credentials and label-based reinsertion while preserving earlier bearer and stdio protections.

> Retain this distinct variant within the same revalidated diagnostic-redaction family. Verify peer labels cannot reinsert credentials into complete error messages or published metadata. mcp-server-label-probe.json retains the public-client disclosure.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T08-26-28-776Z-security-review-2xz9f5.

Confirmed by security-review workflow runs:

- 2026-09-13T08-26-28-776Z-security-review-2xz9f5

security evidence: 6ef15b384128425dc866071af67cca425d9ee1f90d2a13b1fcce1a9900134e9d
evidence identity: mcp-peer-server-label-post-redaction-echo-v1
Evidence lineage (new-variant): 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857
> The predecessor now redacts complete notification warnings, including server labels. Request errors redact only their detail before constructors append the peer-controlled server name. This is a distinct error-construction variant; the repaired warning path remains protected.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Complete the client-owned diagnostic redaction boundary: collect configured credential-bearing header values and their credential components, and redact complete published errors and diagnostics after incorporating peer-controlled labels. Keep authoritative protocol values separate from diagnostic projections. This common repair covers omitted HTTP credentials and label-based reinsertion while preserving earlier bearer and stdio protections.
Exploit preconditions:
> A configured MCP peer receives a bearer credential, advertises it as serverInfo.name during discovery, and subsequently returns an ordinary operation error. The preserved public-client probe confirmed the credential survives in Error.message even though the error detail contains no credential.
finding id: mcp-peer-server-label-credential-disclosure
candidate id: mcp-transport:src/core/mcp/client-connection.ts:1
verdict: confirmed
rationale:

> Relevant code remains unchanged: discovery adopts peer-controlled serverInfo.name, requestErrorForMethod redacts only error detail, and error constructors subsequently append the name. The operation executor publishes the resulting message. The earlier independent public-client probe reproduced a synthetic bearer credential leaking exclusively through the peer name; complete warning redaction remained effective. The nominated task retains the cited predecessor evidence key and matching owner/invariant. This distinct error-construction variant fits the same client diagnostic repair, provided complete errors and published metadata are sanitized without changing authoritative protocol identity.

Evidence:

Evidence 1:



path: src/core/mcp/client-connection.ts

line: 69

excerpt:



> protected applyInitializeResult(result: McpInitializeResult): void {
>   if (result.serverInfo?.name) {
>     this.serverName = result.serverInfo.name;
>   }

Evidence 2:



path: src/core/mcp/client-base.ts

line: 437

excerpt:



> protected requestErrorForMethod(method: string, message: string): Error {
>   const redactedMessage = this.redactSensitiveErrorMessage(message);

Evidence 3:



path: src/core/mcp/client-base.ts

line: 447

excerpt:



> return new McpToolError(this.serverName, method, redactedMessage);
> }
> return new McpConnectionError(this.serverName, method, redactedMessage);

Evidence 4:



path: src/core/mcp/manager-operation-executor.ts

line: 104

excerpt:



> const message = error instanceof McpToolError
>   ? error.message
>   : `MCP operation error: ${error instanceof Error ? error.message : String(error)}`;
> return { content: message, is_error: true };


## Configured-header and peer-label variant resolution

Revalidated both variants in the existing diagnostic-redaction family. The
configured peer already receives its own credential; the additional disclosure
is into terminal diagnostics and error consumers. Omitted header credentials
and post-redaction label insertion share the client credential set and error
publication owner. Earlier stdio and notification resolutions and evidence
remain intact above.

The MCP client now uses outbound HTTP's existing sensitive-header classification
for configured credential collection. It includes complete header values,
authorization credentials (including Basic payload/password), and individual
cookie values, including quoted values and values containing equals signs.
Tool and connection error constructors require the client redactor and apply it
after message assembly, also sanitizing public server/method metadata.
Authorization and authorization-flow errors apply the same complete-message and
metadata protection. Authoritative peer identity, outbound credentials and the
private authorization challenge used for retry remain unchanged. Scoped MCP
guidance records that distinction.

Verification in builder run `2026-09-13T11-44-34-991Z-builder-2494xf`:

- Public-client regression tests first reproduced seven failures for API keys,
  cookies, Basic/proxy credentials and peer labels in tool, catalog and
  authorization errors (`diagnostics-before.log`). Only synthetic credentials
  and a mocked network port were used; real client framing, warning publication
  and error construction executed.
- `pnpm test:protocol src/core/mcp/client-diagnostic-redaction.test.ts src/core/mcp/stdio-stderr-redaction.test.ts src/core/mcp/client.test.ts`
  passed 44 tests (`mcp-tests.log`), preserving spawned-stdio stderr protection,
  subscription and progress warnings, useful output, and successful results.
- After adding authorization-flow and private-retry-challenge assertions,
  `pnpm test:protocol src/core/mcp/client-diagnostic-redaction.test.ts` passed all
  11 tests (`diagnostics-final.log`). Assertions cover terminal output, complete
  errors, stacks and serialized metadata, as well as unchanged outbound headers,
  peer identity and original retry scopes. A stable run-local TMPDIR was used
  after a runtime restart invalidated the earlier temporary path.
- `pnpm test src/core/mcp/client-oauth-endpoint-policy.test.ts src/core/mcp/client-oauth-redirect-policy.test.ts src/core/mcp/client-oauth-resource-binding.test.ts src/core/outbound-http/transport-errors.test.ts`
  passed 23 tests (`auth-http-tests.log`), protecting OAuth endpoint, redirect and
  audience policy plus the reused HTTP diagnostic classification behavior.
- `pnpm check:fast` passed (`check-fast.log`): production/test TypeScript, lint,
  task validation, generated client bindings and module admission. Final
  `pnpm typecheck:tests`, focused Biome validation and `pnpm validate-tasks`
  also passed after the last test edits and archive transition
  (`final-test-typecheck.log`, `final-task-validation.log`).

These boundary regressions distinguish the reported disclosures from the repaired
behavior without live credentials or an external server. No live-model evaluation
or deployment observation was needed for this deterministic client repair.

## Critic repair: lifecycle and decoding diagnostics

The critic correctly reproduced a remaining peer-label disclosure by connecting
an HTTP client, closing it and calling a tool. The earlier repair protected typed
request errors but lifecycle guards still constructed plain errors directly.
This corrects the earlier completion claim for peer-label error protection.

`McpClientBase.diagnosticError` now applies the existing credential redactor to
complete locally assembled error messages. HTTP and stdio lifecycle guards,
stdio process/close rejections, catalog decoding/budget failures and remote-skill
decoding failures use that boundary. Errors retain their existing classification
and useful context; identity and successful remote-skill provenance retain their
original protocol values. Authorization-flow handling remains unchanged by this
repair. The scoped guidance names the local-error publication boundary.

Repair verification:

- `repair-lifecycle-before.log` reproduces the unredacted peer label through the
  public HTTP connection lifecycle before this repair.
- `pnpm test:protocol src/core/mcp/client-diagnostic-redaction.test.ts src/core/mcp/stdio-stderr-redaction.test.ts src/core/mcp/client.test.ts src/core/mcp/client-catalog-limits.test.ts`
  passed 81 tests (`repair-mcp-tests.log`). This covers client behavior and
  catalog cancellation/budget enforcement alongside diagnostic regressions.
- With final coverage added, `pnpm test:protocol src/core/mcp/client-diagnostic-redaction.test.ts src/core/mcp/stdio-stderr-redaction.test.ts`
  passed all 15 tests (`repair-diagnostics-final.log`). Public journeys cover
  repeated connect, call/list after close, reconnect after close, malformed
  catalog and skill-index results, and a spawned stdio peer echoing its env
  credential in its advertised name. Terminal output, error messages, stacks
  and metadata remain protected; rejection context and raw protocol identity
  remain intact. Tests use only synthetic secrets and the existing network port.
- `pnpm check:fast` passed after the final source/test edits
  (`repair-check-fast.log`): production and test types, lint, task validation,
  generated bindings and bundled module admission. The final task-note update
  also passed `pnpm validate-tasks`. No live credentials, external-server probe
  or deployment observation was required for this deterministic repair.

## Critic repair: terminal stdio initialization failures

The second critic reproduced a separate bypass: stdio `initialize` requests keep
raw JSON-RPC errors for version negotiation, and terminal failures escaped public
`connect()` without redaction. The manager could then publish that message.

The public connection boundary now converts terminal stdio failures into the
existing redacted connection error after negotiation has finished. Raw error
codes and data remain available to fallback selection; public errors retain no
raw JSON-RPC data or cause. The previous stderr, HTTP and lifecycle protections
remain in place.

A spawned-peer regression reproduced cleartext env-credential echoes from both
initial rejection and rejection after fallback (`repair2-initialize-before.log`).
The same fixture also checks successful draft negotiation when a configured env
value equals the advertised draft version, proving diagnostic redaction does not
rewrite the raw supported-version data used by negotiation. Failure assertions
cover error messages, stacks and serialized metadata using synthetic values.

Verification:

- `pnpm test:protocol src/core/mcp/stdio-stderr-redaction.test.ts src/core/mcp/client-diagnostic-redaction.test.ts src/core/mcp/client.test.ts`
  passed (`repair2-mcp-tests.log`), including both new failure regressions,
  successful fallback, earlier credential/label regressions and the existing
  public client protocol journeys.
- `pnpm check:fast` passed (`repair2-check-fast.log`): production/test TypeScript,
  lint, task validation, generated client bindings and module admission.
- Final task notes passed `pnpm validate-tasks`; `git diff --check` found no
  whitespace errors. No live credentials or external services were used.

## Critic repair: operation-result and retry decoding

The third critic correctly found that malformed operation results could place a
configured credential in an input-request key. The decoder included that key in
its exception, which escaped the public client and could be published by the
manager. Earlier error-boundary repairs did not cover these decoder failures.

The client now redacts exceptions from operation-result, retry-input, remote-skill
and header-parameter decoding through one shared boundary. Successful decoded
values remain unchanged. HTTP request failures from body readers also pass through
the client redactor; existing typed errors retain their safe metadata and private
authorization retry state, and caller cancellation retains its original reason.
Stdio version negotiation continues to use raw errors until terminal rejection.

Verification:

- Six public-client regressions failed before the repair (`repair3-before.log`):
  malformed tool, resource, prompt and task results, plus JSON and SSE body-read
  failures. They now pass and assert redacted messages, stacks and serialized
  errors. Successful results retain the original input-request keys.
- `pnpm test:protocol src/core/mcp` passed all 114 tests across eight files
  (`repair3-mcp-tests.log`). This includes retry-key rejection before network
  publication, earlier stderr and initialization regressions, authorization,
  protocol negotiation, catalog budgets and cancellation. Synthetic credentials
  and controlled network ports exercise the production client boundary.
- `pnpm check:fast` passed (`repair3-check-fast.log`), covering production and test
  types, lint, task validation, generated bindings and module admission.

No live credentials, external services or deployment observation were needed.
