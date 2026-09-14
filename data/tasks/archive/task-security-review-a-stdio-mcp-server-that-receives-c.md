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

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-stdio-runtime.ts
claim:

> MCP stderr redaction processes each data chunk independently. A credential split across chunks is published as unmasked fragments that reconstruct the complete secret. The public-client probe masked the whole synthetic credential but exposed both halves when written separately.

## Desired Outcome

> Make MCP diagnostic redaction stream-aware: retain a bounded undecided suffix across stderr chunks and redact credentials before publishing matching bytes. Preserve the family's existing HTTP, OAuth, notification and decoder protections.

> Revalidate as new evidence for the existing diagnostic-redaction family while preserving prior resolutions. The run directory retains mcp-stderr-chunk-probe.mjs and mcp-stderr-chunk-result.json. Verify chunk boundaries, stream completion and bounded buffering.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T17-08-42-648Z-security-review-0sekc7.

Confirmed by security-review workflow runs:

- 2026-09-13T17-08-42-648Z-security-review-0sekc7

security evidence: 664dd1e9783811cdd37ea9ef3a0248fd6c19b7ad5fb7637e4deec1f134123036
evidence identity: mcp-stdio-stderr-cross-chunk-secret-echo-v1
Evidence lineage (new-variant): 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857
> The nominated task retains the original stderr repair and this canonical diagnostic-family evidence key. Whole-message redaction remains present. This variant splits one credential across stream chunks; it is not a demonstrated reintroduction of the earlier sink.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Make MCP diagnostic redaction stream-aware: retain a bounded undecided suffix across stderr chunks and redact credentials before publishing matching bytes. Preserve the family's existing HTTP, OAuth, notification and decoder protections.
Exploit preconditions:
> A configured stdio MCP process receives a credential through transport.env and emits it across separate stderr chunks, deliberately or through ordinary fragmentation. An observer can read KOTA terminal output or its capture. A real subprocess probe confirmed disclosure using a synthetic credential.
finding id: mcp-stdio-stderr-fragmented-credential-disclosure
candidate id: mcp-transport:src/core/mcp/client-stdio-runtime.ts:1
verdict: confirmed
rationale:

> The current stderr handler redacts each chunk independently. Rerunning the inspected public-client subprocess probe masked the whole synthetic credential but published both separately written halves. A terminal-output observer can reconstruct it. The nominated task retains predecessor evidence 9feffc41efce65c813ceb04d5b882da5d076299964f0bd97c40ef3f28103f857 and the matching client diagnostic owner/invariant. This is a new fragmentation variant, not a demonstrated regression. Stream-aware credential redaction at that owner addresses it while preserving earlier protections.

Evidence:

Evidence 1:



path: src/core/mcp/client-stdio-runtime.ts

line: 54

excerpt:



> this.proc.stderr?.on("data", (chunk: Buffer) => {
>   const text = chunk.toString().trim();
>   if (!text) return;
>   this.writeDiagnostic(
>     `[mcp:${this.serverName}] ${text}\n`,
>     "stderr",
>   );

Evidence 2:



path: src/core/mcp/client-base.ts

line: 442

excerpt:



> protected redactSensitiveErrorMessage(message: string): string {
>   let redacted = message;
>   for (const value of this.sensitiveValuesForRedaction()) {
>     redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");
>   }

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-base.ts
claim:

> The MCP diagnostic credential set includes statically registered client secrets but omits dynamically registered secrets stored in oauthClients. A token endpoint can echo an acquired secret in Content-Type and expose it in the public connection-error message, which the manager publishes to diagnostics.

## Desired Outcome

> Include secrets from resolved OAuth clients, including dynamically registered clients, in the client-owned sensitive-value set before subsequent requests or diagnostics. Preserve private protocol originals and all existing diagnostic-redaction variants.

> Revalidate the existing-family nomination and preserve prior evidence. The run directory retains mcp-dynamic-secret-probe.mjs and mcp-dynamic-secret-result.json. Verify acquired credentials are absent from public errors, stacks, serialized projections and terminal output.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T17-08-42-648Z-security-review-0sekc7.

Confirmed by security-review workflow runs:

- 2026-09-13T17-08-42-648Z-security-review-0sekc7

security evidence: a9dfe19cfe17f2ba9039f0c810c01a2f5b711928501ea3db424f3f6c21995be7
evidence identity: mcp-dynamically-registered-client-secret-error-echo-v1
Evidence lineage (new-variant): f232c7f55de9e73e313e8e9414a75fb643fa8c19ca65d9fbfcde44a12bb748a3
> This retained evidence established incomplete credential collection at the same diagnostic owner. Its configured-header repair remains. The new credential source is dynamic registration: acquired secrets reside in oauthClients, which the redaction collector does not traverse.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Include secrets from resolved OAuth clients, including dynamically registered clients, in the client-owned sensitive-value set before subsequent requests or diagnostics. Preserve private protocol originals and all existing diagnostic-redaction variants.
Exploit preconditions:
> The operator enables OAuth dynamic client registration. Registration returns a client_secret, and the configured authorization server subsequently echoes it in a token-endpoint diagnostic field. A synthetic HTTP-wire probe confirmed that KOTA sends the acquired secret and exposes it in the resulting error.
finding id: mcp-dynamic-oauth-client-secret-diagnostic-disclosure
candidate id: mcp-transport:src/core/mcp/client-base.ts:1
verdict: confirmed
rationale:

> Dynamic registration stores clientSecret in oauthClients, which sensitiveValuesForRedaction does not inspect. Rerunning the inspected public-client probe with controlled HTTP responses confirmed that the acquired synthetic secret reaches the token endpoint and survives its Content-Type echo in the public connection error. The manager publishes that error through terminal diagnostics. Exploitation requires enabled dynamic registration and a credential-echoing authorization endpoint. The nominated task retains predecessor f232c7f55de9e73e313e8e9414a75fb643fa8c19ca65d9fbfcde44a12bb748a3. This new credential-source variant belongs to the same client diagnostic family; its repair must include acquired secrets alongside stream-aware publication and existing protections.

Evidence:

Evidence 1:



path: src/core/mcp/client-base.ts

line: 422

excerpt:



> const client = this.transport.authorization?.client;
> if (client?.kind === "registered") {
>   if ("clientSecret" in client && client.clientSecret !== undefined) {
>     add(client.clientSecret);

Evidence 2:



path: src/core/mcp/client-oauth-token-runtime.ts

line: 314

excerpt:



> const clientSecret = optionalString(
>   object.client_secret,
>   "client_secret",
>   "authorization-server-metadata",
> );
> const client = {
>   clientId,
>   ...(clientSecret !== undefined ? { clientSecret } : {}),
> };
> this.oauthClients.set(cacheKey, client);

Evidence 3:



path: src/core/mcp/client-oauth-token-runtime.ts

line: 892

excerpt:



> const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
> if (!contentType.includes("application/json")) {
>   throw this.authorizationFlowError(
>     resource,
>     issuer,
>     scopes,
>     `${label} failed: unsupported response content-type "${contentType || "(missing)"}"`,
>   );

Evidence 4:



path: src/core/mcp/manager.ts

line: 207

excerpt:



> } catch (err) {
>   printTerminalDiagnostic(
>     `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,
>     "error",
>   );


## Fragmented stderr and acquired OAuth credential resolution

Revalidated both new variants at the existing MCP client diagnostic owner. The
stdio process already receives its configured environment; this variant disclosed
its credential through independent stderr chunk publication. Dynamic registration
added a distinct credential source absent from the redaction set. Earlier claims,
exploit preconditions and resolutions remain preserved above.

The client now incrementally decodes UTF-8 stderr and withholds a suffix only while
it could become a configured credential. Pending text is shorter than the longest
credential; ordinary output does not wait for a newline. Longer credentials take
precedence over matching shorter prefixes. Stream end or close settles remaining
text, while process exit does not prematurely flush bytes still in transit.
Complete terminal messages still use the existing client redaction boundary,
including peer labels. Resolved OAuth clients contribute their client secrets and
Basic authorization representation to the same sensitive-value set before later
requests or diagnostics. Private protocol values remain unchanged.

Verification in builder run `2026-09-13T21-42-20-881Z-builder-esjduj`:

- `diagnostics-before.log` records four failing public-client regressions before
  the repair: split and bytewise stderr disclosure, premature partial-prefix
  publication, and an acquired client secret echoed by token-endpoint Content-Type.
- `pnpm test src/core/mcp src/core/outbound-http/transport-errors.test.ts` passed
  all 160 tests in 14 files (`mcp-tests.log`). Spawned stdio peers exercise actual
  stderr rendering across separate writes, multibyte UTF-8 fragmentation, repeated
  credentials, a shorter matching credential, incomplete EOF suffixes and close.
  A 100,000-character line publishes before EOF while its possible credential
  suffix waits, distinguishing bounded retention from buffering whole lines.
  Controlled HTTP responses exercise dynamic registration, the unchanged outgoing
  client secret, token-error projection, and successful authorization followed by
  credential echoes in operation errors and progress warnings. Messages, stacks,
  serialized errors and captured terminal output exclude the acquired raw secret
  and its Basic representation. Existing HTTP/OAuth, notification, decoder,
  lifecycle, negotiation, catalog and manager regressions also pass.
- `pnpm check:fast` passed (`check-fast.log`): production/test types, lint, task
  validation, generated client bindings and bundled-module admission. Final
  archive notes were separately checked with `pnpm validate-tasks`
  (`final-task-validation.log`); scoped `git diff --check` passed.

An interrupted first post-fix invocation encountered a removed invocation TMPDIR
before tests could run (`diagnostics-after.log`). Validation resumed using fresh
subdirectories of the retained run scratch directory; the focused rerun passed
32 tests (`diagnostics-after-resume.log`) before final coverage was expanded.
Only synthetic credentials were used. No live external service, model evaluation
or deployment observation was required for these deterministic client boundaries.


## Critic repair: preserve credential case in Content-Type diagnostics

The critic correctly reproduced a remaining disclosure when the dynamically
registered client secret contained uppercase characters. OAuth response handling
lowercased Content-Type before diagnostic publication, so the original credential
no longer matched the redaction set. The earlier lowercase-only regression did
not justify completion for this input.

OAuth JSON responses, protected-resource metadata, HTTP operations and subscription
responses now preserve the original header in diagnostics and lowercase only for
media-type comparisons. This repairs the same transformation at every MCP
Content-Type diagnostic consumer without changing accepted protocol formats or
private credential values. The scoped guidance records this publication rule.

Repair verification:

- `repair-case-before.log` reproduces four public-boundary failures: the acquired
  mixed-case secret in an OAuth token error, a configured mixed-case credential in
  an HTTP operation error and terminal subscription warning, and its appearance in
  serialized protected-resource metadata errors.
- The repaired focused diagnostic suite passed all 29 tests
  (`repair-case-after.log`). Assertions reject both original and lowercased secret
  echoes in error messages, stacks, serialized errors and terminal output. Valid
  mixed-case JSON Content-Type values still permit discovery, OAuth registration
  and token exchange; outgoing credentials retain their original case.
- `pnpm test src/core/mcp src/core/outbound-http/transport-errors.test.ts` passed
  all 163 tests in 14 files (`repair-mcp-tests.log`), preserving the stdio streaming
  repair and earlier HTTP, OAuth, notification, decoder and manager protections.
- `pnpm check:fast` passed (`repair-check-fast.log`), covering production/test
  types, lint, task validation, generated bindings and module admission. Final
  repair notes passed `pnpm validate-tasks` (`repair-task-validation.log`), and
  scoped `git diff --check` passed.

These probes use synthetic credentials and controlled network responses through
the production client. No live service, credential or model evaluation was needed.

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-base.ts
claim:

> MCP diagnostic redaction runs before terminal-control removal. A peer can insert CSI, OSC or bidi controls inside a known credential, defeating literal matching; the renderer then removes those controls and publishes the complete credential. Public-client probes reproduced disclosure through stdio stderr and HTTP JSON-RPC connection errors in both renderer modes, while literal credential controls remained redacted.

## Desired Outcome

> Compose terminal normalization and credential redaction at the existing diagnostic owner so removal of controls cannot reconstruct an unredacted credential. Cover streamed stderr and errors subsequently rendered by the manager, preserve bounded stream handling and private protocol originals, and retain the existing terminal-control sanitizer.

> Independently revalidate this new evidence against the existing credential-diagnostic task, preserving its prior resolutions. The run directory retains mcp-redaction-sanitizer-probe.mjs, mcp-redaction-sanitizer-result.json and investigation-summary.md. Require regression proof for controls embedded inside credentials through stderr and manager-rendered errors, including provider/fallback and fragmented-stream behavior. Eight disclosure observations reproduced despite all 44 existing focused tests passing.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T22-42-22-351Z-security-review-pp8fc3.

Confirmed by security-review workflow runs:

- 2026-09-13T22-42-22-351Z-security-review-pp8fc3

security evidence: 17231b9ea2d497e3554ec398d0e259dbb3d41228c9017729b0c0e590e5f1378a
evidence identity: mcp-terminal-control-removal-reconstructs-credential-v1
Evidence lineage (new-variant): 664dd1e9783811cdd37ea9ef3a0248fd6c19b7ad5fb7637e4deec1f134123036
> The nominated task retains this evidence for credential disclosure across stderr chunks. That repair remains effective. This variant inserts removable terminal controls inside a credential; downstream sanitization reconstructs the complete secret after redaction. It also affects HTTP connection diagnostics through the same credential-redaction owner.
production owner: src/core/mcp/client-base
violated invariant: mcp-credentials-redacted-from-diagnostics
Common repair:
> Compose terminal normalization and credential redaction at the existing diagnostic owner so removal of controls cannot reconstruct an unredacted credential. Cover streamed stderr and errors subsequently rendered by the manager, preserve bounded stream handling and private protocol originals, and retain the existing terminal-control sanitizer.
Exploit preconditions:
> A configured MCP peer receives a credential through stdio transport.env or an HTTP authorization header and echoes it with terminal controls inserted inside the credential. An observer can read KOTA terminal output or its capture. Real subprocess and controlled HTTP-response probes confirmed these preconditions with synthetic credentials in provider and fallback modes.
finding id: mcp-terminal-sanitization-reconstructs-credential
candidate id: mcp-transport:src/core/mcp/client-base.ts:1
verdict: confirmed
rationale:

> At HEAD 5028cb1404796b38bc56b63e5d0d93841fa8f446, client-base performs literal credential redaction before terminal-renderer removes controls. Independently inspected and reran the probe with a different synthetic credential: CSI, OSC and bidi insertion disclosed the complete credential through real subprocess stderr; CSI insertion also disclosed it through manager-rendered HTTP errors using a controlled network port. Both renderer modes reproduced disclosure: eight disclosures, while four literal-echo controls remained redacted. Exploitation requires a configured peer that receives the credential and an observer of terminal output or its capture. The nominated archived task retains evidence key 664dd1e9783811cdd37ea9ef3a0248fd6c19b7ad5fb7637e4deec1f134123036 under the same production owner and confidentiality invariant. Its streaming repair remains present; control-removal reconstruction is a supported new variant. Composing normalization and credential redaction at that owner addresses both publication paths, provided streamed matching remains bounded and terminal-control protection is preserved.

Evidence:

Evidence 1:



path: src/core/mcp/client-base.ts

line: 448

excerpt:



> protected redactSensitiveErrorMessage(message: string): string {
>     let redacted = message;
>     for (const value of this.sensitiveValuesForRedaction()) {
>       redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");
>     }
>     return redacted;
>   }

Evidence 2:



path: src/core/mcp/client-base.ts

line: 483

excerpt:



> protected writeDiagnostic(message: string, destination: "warn" | "stderr"): void {
>     const redacted = this.redactSensitiveErrorMessage(message);
>     if (destination === "stderr") {
>       writeTerminalStderr(redacted);
>     } else {
>       printTerminalDiagnostic(redacted, destination);
>     }
>   }

Evidence 3:



path: src/core/modules/terminal-renderer.ts

line: 115

excerpt:



> const safe = stripTerminalDiagnosticControls(text);
>   const provider = getRenderingProvider();
>   if (provider) {
>     provider.writeStderr(safe);
>     return;
>   }
>   process.stderr.write(safe);

Evidence 4:



path: src/core/mcp/client-http-runtime.ts

line: 217

excerpt:



> if (message.error) {
>       throw this.requestErrorForMethod(
>         method,
>         `HTTP ${response.status}: MCP error ${message.error.code}: ${message.error.message}`,
>       );
>     }

Evidence 5:



path: src/core/mcp/manager.ts

line: 208

excerpt:



> printTerminalDiagnostic(
>             `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,
>             "error",
>           );


## Terminal normalization and credential matching resolution

Revalidated the terminal-control reconstruction variant at the MCP diagnostic
owner. Earlier resolutions and evidence above remain preserved. Complete client
errors now normalize terminal controls before credential matching, and configured
and acquired credentials use that same diagnostic projection. Their private
protocol values remain unchanged. Stdio applies the shared normalizer after UTF-8
decoding and before incremental credential matching, so removing a fragmented
control cannot publish a previously withheld credential prefix.

The terminal renderer owns one normalization policy for complete messages and
streams. Its parser retains only a finite control state and discards arbitrary
CSI/OSC payloads as they arrive. The existing stream redactor still retains less
than the longest credential, publishes ordinary long lines before EOF, and settles
incomplete prefixes on stream completion. Terminal sinks retain their sanitizer.

Verification in builder run `2026-09-13T23-14-12-918Z-builder-9xqf3e`:

- `agent/controls-before.log` records four failing regressions before the repair:
  public HTTP errors retained control-obfuscated secrets, and bytewise stderr
  prematurely published a credential fragment in provider and fallback modes.
- `pnpm test src/core/mcp src/core/outbound-http/transport-errors.test.ts
  src/core/modules/terminal-renderer.test.ts` passed 172 tests in 15 files
  (`agent/mcp-tests.log`). Public-client tests cover literal and control-obfuscated
  echoes, both terminal sinks, actual manager connection diagnostics, forced
  fragmentation inside CSI/OSC and UTF-8, C1 controls, bidi and bell insertion,
  large discarded OSC payloads, and credentials that themselves contain controls.
  The renderer test covers every split in representative valid and malformed
  commands, EOF and retained printable text. Earlier OAuth, HTTP, decoder,
  notification, negotiation, lifecycle and bounded-stream protections still pass.
- `artifacts/terminal-redaction-probe.mjs` was executed with
  `node --conditions=source --import tsx` from the writer. Its retained
  `terminal-redaction-result.json` captures real subprocess stderr and actual
  manager-rendered HTTP connection errors in both rendering modes. Each output
  contains `[redacted]` and readable context, with no synthetic credential or
  terminal controls. The probe verifies unchanged outgoing HTTP authorization
  and withholding of a partial credential across a split OSC terminator.
- `pnpm check:fast` passed (`agent/check-fast.log`): production/test types, lint,
  task validation, generated bindings and admission of 90 bundled modules.
  Final archive validation and scoped whitespace checks are recorded in
  `agent/final-validation.log`.

Only synthetic credentials and controlled HTTP responses were used. No live
external service, model evaluation, deployment or daemon control was needed.
