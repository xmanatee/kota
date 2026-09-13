---
status: done
---

# Security review: MCP peer-controlled error text reaches operator stderr without terminal-control sanitization, allowing a malicious MCP server to spoof output or invoke terminal features through OSC, CSI, C1, or bidirectional controls.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim:

> MCP peer-controlled error text reaches operator stderr without terminal-control sanitization, allowing a malicious MCP server to spoof output or invoke terminal features through OSC, CSI, C1, or bidirectional controls.

## Desired Outcome

> Sanitize diagnostic message and detail text at the centralized terminal-diagnostic boundary, including its no-provider fallback, before rendering or raw stderr writes. Add an MCP fixture covering OSC, CSI/C1, and bidi controls in JSON-RPC errors and remote server names.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-01T09-09-41-035Z-security-review-pxj6wc.

finding id: mcp-terminal-diagnostic-control-injection
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:226
verdict: confirmed
rationale:

> Peer-supplied JSON-RPC error.message is interpolated at client-http-runtime.ts:206-210, wrapped without control sanitization by client-base.ts:427-440 and client-auth-types.ts:221-227, then forwarded to printTerminalDiagnostic at manager.ts:657-661. rendering-provider.ts:102-110 places the message in a span, while render-paint.ts:31-37 emits span.text unchanged; terminal-renderer.ts:40-44 also writes it raw when no provider exists. A runtime rendering probe preserved OSC, CSI, and bidi controls. The configured server name is not peer-controlled, but the remote error message alone establishes the violation.

Evidence:

Evidence 1:

path: src/core/mcp/client-http-runtime.ts

line: 209

excerpt:

> `HTTP ${response.status}: MCP error ${message.error.code}: ${message.error.message}`

Evidence 2:

path: src/core/mcp/client-auth-types.ts

line: 226

excerpt:

> super(`MCP connection error for server "${serverName}" during ${method}: ${message}`);

Evidence 3:

path: src/core/mcp/manager.ts

line: 659

excerpt:

> `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`

Evidence 4:

path: src/modules/rendering/rendering-provider.ts

line: 107

excerpt:

> line(span(diagnostic.message, role)),

Evidence 5:

path: src/modules/rendering/render-paint.ts

line: 37

excerpt:

> return `${opens}${span.text}\x1b[0m`;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/core/modules/terminal-renderer.test.ts src/core/mcp/manager.test.ts` passes 69 tests, exercising the centralized provider/fallback diagnostic boundary and an HTTP MCP JSON-RPC error fixture with OSC, CSI/C1, and bidirectional controls in both the peer error and configured remote name.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run --configLoader runner --silent=true src/core/modules/terminal-renderer.test.ts src/core/modules/module-loader.test.ts` passes 81 tests for the renderer and its module-lifecycle integration.
- `./node_modules/.bin/biome check src/core/modules/terminal-renderer.ts src/core/modules/terminal-renderer.test.ts src/core/modules/module-lifecycle.ts src/core/mcp/manager.test.ts && ./node_modules/.bin/tsc --noEmit` verifies the touched sources and types.

security family: f056b98e49233e12354421542137728a879b33fbd2fe908f765c5773059dac85

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-stdio-runtime.ts
claim:

> MCP stdio stderr bypasses terminal-control sanitization. The client redacts secrets and then forwards bytes unchanged through writeTerminalStderr. A real subprocess probe delivered OSC title and CSI clear-screen sequences to the terminal writer while the normal diagnostic sanitizer removed the same sequences, permitting display manipulation and output spoofing.

## Desired Outcome

> Route MCP stderr diagnostics through the existing terminal-diagnostic control sanitizer before raw publication, including peer-controlled labels and provider/fallback output. Preserve credential redaction and trusted application rendering.

> Independently revalidate nomination of the earlier terminal-diagnostic task. Keep this invariant separate from credential confidentiality. The run directory retains mcp-stderr-control-probe.mjs and mcp-stderr-control-result.json; terminal writes were intercepted. Cover real stdio output and provider/fallback publication.

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

security evidence: 2ef689bd68a0036497124df344381145ea073ce98b4780da42404ad7259f275d
evidence identity: mcp-stdio-stderr-raw-terminal-controls-v1
Evidence lineage (new-variant): mcp-terminal-diagnostic-control-injection
> The nominated historical finding covers unsanitized MCP terminal diagnostics. Its printTerminalDiagnostic repair remains effective. Stdio stderr instead takes the raw writeTerminalStderr branch, bypassing that repaired boundary. This is a distinct input route, not proof of regression in the original JSON-RPC route.
production owner: src/core/modules/terminal-renderer
violated invariant: terminal-diagnostics-control-free
Common repair:
> Route MCP stderr diagnostics through the existing terminal-diagnostic control sanitizer before raw publication, including peer-controlled labels and provider/fallback output. Preserve credential redaction and trusted application rendering.
Exploit preconditions:
> A configured stdio MCP process emits attacker-controlled stderr, directly or by relaying upstream text, and KOTA output reaches a terminal that interprets control sequences. The probe confirms raw OSC and CSI bytes reach the terminal writer; terminal-specific effects depend on terminal support.
finding id: mcp-stdio-stderr-terminal-control-injection
candidate id: mcp-transport:src/core/mcp/client-stdio-runtime.ts:1
verdict: confirmed
rationale:

> Stdio diagnostics pass from writeDiagnostic to writeTerminalStderr without createTerminalDiagnostic sanitization. Both the rendering provider and fallback preserve raw text. Rerunning the inspected subprocess probe captured OSC and CSI bytes at the terminal writer; the ordinary diagnostic sanitizer removed the same controls. Display effects require a supporting terminal; no terminal execution or code execution was demonstrated. The nominated archived task retains historical finding mcp-terminal-diagnostic-control-injection. Routing this additional stderr input through the established sanitizer fits that repair family and remains separate from credential confidentiality.

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

line: 450

excerpt:



> protected writeDiagnostic(message: string, destination: "warn" | "stderr"): void {
>   const redacted = this.redactSensitiveErrorMessage(message);
>   if (destination === "stderr") {
>     writeTerminalStderr(redacted);
>   } else {
>     printTerminalDiagnostic(redacted, destination);
>   }
> }

Evidence 3:



path: src/core/modules/terminal-renderer.ts

line: 112

excerpt:



> export function writeTerminalStderr(text: string): void {
>   const provider = getRenderingProvider();
>   if (provider) {
>     provider.writeStderr(text);
>     return;
>   }
>   process.stderr.write(text);
> }

Evidence 4:



path: src/modules/rendering/rendering-provider.ts

line: 153

excerpt:



> writeStderr(text): void {
>   stderr.writeRaw(text);
> },

## Final resolution

The stdio variant is fixed at the common terminal owner: `writeTerminalStderr`
now applies the existing terminal-diagnostic control sanitizer before provider
or fallback publication. MCP still redacts the complete diagnostic upstream.
Peer labels are sanitized only for publication; protocol identity is unchanged.
Trusted renderer styling remains downstream of the diagnostic boundary.
The earlier JSON-RPC repair remains effective and is independently revalidated.

Verification for builder run `2026-09-13T21-42-21-014Z-builder-ixs3k3`:

- `pnpm test src/core/modules/terminal-renderer.test.ts src/mcp-terminal-diagnostics.integration.test.ts src/core/mcp/stdio-stderr-redaction.test.ts src/core/mcp/client-diagnostic-redaction.test.ts src/core/daemon/daemon-logger.test.ts src/core/modules/foreign-module-stdio.test.ts` established 54 passing owner/protocol tests. The initial integration fixture selected a colorless theme; after correcting that fixture, `pnpm test src/mcp-terminal-diagnostics.integration.test.ts` passed all 4 cases.
- The real subprocess fixture captures stderr with OSC, CSI/C1 and bidi controls
  in peer text and the negotiated remote name. Provider and fallback output are
  control-free and credential-redacted; JSON-RPC errors and configured names are
  safe, while application SGR remains intact. The stdio cases reproduced the
  leak before the production edit.
- `pnpm check:fast` passed with `TMPDIR` set to a fresh run-scratch directory:
  production/test types, lint, task validation, client bindings and module admission.
  Session-temp interruption failures were resolved with retained scratch.
- Run artifacts `focused-tests.log`, `integration-tests-final.log`,
  `check-fast-retained-tmp.log`, and `terminal-diagnostics-verification.md`
  retain commands, results and the captured-output assessment.

No live daemon or terminal features were invoked; output was intercepted at the
terminal writer. Full deterministic-suite and live-model runs were not needed
for this bounded diagnostic change. The original finding and variant evidence
above remain preserved.
