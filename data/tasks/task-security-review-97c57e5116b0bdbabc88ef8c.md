---
status: open
priority: p1
---
# Security review: The CLI harness path drops configured passive or supervised mode. Native adapter checks rejecting those modes are consequently bypassed, and native scope projection grants writable workspace access. The omission affects explicit-run, REPL, and piped-input construction.

security family: 97c57e5116b0bdbabc88ef8cc86d4a1258fec157d3a4055b2bbb76873b37fce4


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/cli.ts
claim:

> The CLI harness path drops configured passive or supervised mode. Native adapter checks rejecting those modes are consequently bypassed, and native scope projection grants writable workspace access. The omission affects explicit-run, REPL, and piped-input construction.

## Desired Outcome

> Resolve configured CLI autonomy before selecting an execution path and propagate it into every harness invocation, including prompts, REPL turns, resumed conversations, and piped input. Preserve adapter rejection of unsupported passive or supervised execution. This fixes the common CLI handoff without weakening adapter protections.

> Preserve resolved supervision across every CLI harness handoff and verify unsupported modes reject before native execution. cli-autonomy-probe.json retains the observed omission. The historical Codex passive-mode adapter repair remains intact and has a different repair owner.

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

security evidence: fa946193be01847ef900cb685f4d17241872de209441bdc647fd5c4e79e2f86e
evidence identity: cli-harness-configured-autonomy-omission-v1
production owner: src/cli
violated invariant: cli-harness-preserves-configured-supervision
Common repair:
> Resolve configured CLI autonomy before selecting an execution path and propagate it into every harness invocation, including prompts, REPL turns, resumed conversations, and piped input. Preserve adapter rejection of unsupported passive or supervised execution. This fixes the common CLI handoff without weakening adapter protections.
Exploit preconditions:
> The operator configures passive or supervised CLI execution and selects a native harness such as Codex. Attacker-controlled prompt or repository content can induce local writes during the invocation. The preserved probe exercised the registered CLI action and neutral runner using a non-executing adapter: both configured modes arrived as undefined, and the production native scope projector granted workspace writes. No native mutation or model execution was attempted.
finding id: cli-harness-drops-configured-autonomy
candidate id: mcp-transport:src/cli.ts:24
verdict: confirmed
rationale:

> The refreshed finding preserves the previously verified exploit and evidence identity. Relevant code is unchanged: explicit-run, REPL, and pipe harness options omit autonomyMode; resume stores it in conversation options without forwarding it. Codex rejects explicit passive/supervised modes, but omission bypasses those checks and permits workspace writes through native scope projection. Preserved CLI receipts and the earlier independent projection probe support this authority loss without model execution. Propagating resolved autonomy through all CLI handoffs repairs the common cause. The historical adapter repair remains intact and has a different repair owner.

Evidence:

Evidence 1:



path: src/cli.ts

line: 296

excerpt:



> const runOverrides = {
>   verbose: opts.verbose || config.verbose || false,
>   effort: preset.defaultEffort,
>   systemPrompt,
>   ...(modelProvider !== undefined ? { modelProvider } : {}),
> };

Evidence 2:



path: src/cli.ts

line: 349

excerpt:



> run: {
>   model,
>   cwd: runScopeRoot,
>   ...runOverrides,
>   abortController,
> },

Evidence 3:



path: src/cli.ts

line: 324

excerpt:



> await runHarnessRepl({
>   harness,
>   model,
>   cwd: runScopeRoot,
>   run: { ...runOverrides, ...(resumeStore ? { continuityKey: resumeStore.continuityKey } : {}) },

Evidence 4:



path: src/modules/codex-agent-harness/adapter.ts

line: 150

excerpt:



> if (options.autonomyMode === "passive") {
>   throw new Error(

Evidence 5:



path: src/core/agent-harness/native-cli-scope-policy.ts

line: 53

excerpt:



> if (args.autonomyMode === "passive") {
>   return { executionMode: "plan", writableRoots: [] };
> }
>
> const policy = args.scopePolicy;
> if (policy === undefined) {
>   return applyAgentWriteScope({
>     executionMode: "bounded-edits",
>     writableRoots: [resolve(args.cwd)],
>   });
> }
