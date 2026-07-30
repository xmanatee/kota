---
id: task-security-review-the-approval-surface-hides-the-com
title: Security review: The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.
status: done
priority: p1
area: security
task_class: Safety
summary: The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.
created_at: 2026-07-28T22:09:25.940Z
updated_at: 2026-07-28T22:53:05.226Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/approval-queue.ts
claim:

> The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.

## Desired Outcome

> Expose a trusted, operator-safe review descriptor derived from each tool's validated input, preserving security-relevant commands, paths, operations, and arguments while selectively redacting credential fields. Bind that displayed descriptor or its digest to the execution lease so approval demonstrably covers the exact reviewed operation.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T21-49-54-397Z-security-review-declvj.

finding id: finding-approval-operator-cannot-review-tool-input
candidate id: auth-approval-boundary:src/core/daemon/approval-queue.ts:1
verdict: confirmed
rationale:

> ApprovalQueue retains executable input only in its private in-memory map, while projectApprovalForStorage replaces the entire input and context with tool-I/O redaction records. Every operator route uses projectApprovalForClient, whose daemon-api projection also omits all tool I/O, and the CLI consequently renders only the redaction marker. The supervised-mode reason is generic, so the operator cannot inspect the command, paths, arguments, or conversation context before authorizing execution.

Evidence:

Evidence 1:



path: src/core/daemon/approval-queue.ts

line: 192

excerpt:



> this.executionInputs.set(item.id, cloneEvidenceJsonObject(input));
> const stored = this.write(item);

Evidence 2:



path: src/core/daemon/approval-queue-projection.ts

line: 55

excerpt:



> const projected: PendingApproval = {
>   ...projectApprovalTextFields(item),
>   input: projectApprovalInputForStorage(item.input),
> };

Evidence 3:



path: src/core/daemon/approval-queue-projection.ts

line: 67

excerpt:



> const projected = projectApprovalInputForTarget(input, "internal-storage");
> if (!isToolIoRedactionRecord(projected)) {
>   throw new Error("Approval input storage projection must redact tool I/O");
> }

Evidence 4:



path: src/core/daemon/approval-queue-projection.ts

line: 21

excerpt:



> export function projectApprovalForClient(...) {
>   const projected: ApprovalClientProjection = {
>     ...projectApprovalTextFields(item),
>     input: projectApprovalInputForTarget(item.input, target),
>   };

Evidence 5:



path: src/core/tools/autonomy-mode.ts

line: 57

excerpt:



> return {
>   action: "queue",
>   reason: `autonomy mode "supervised" gates ${assessment.risk} tool calls through human approval`,
> };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

- Pending approval projections now include a credential-safe review descriptor that preserves validated commands, paths, operations, arguments, ordinary targets such as email addresses, and an operator-safe conversation context. Structured and embedded credentials—including environment assignments, private keys, passphrases, access-key IDs, client secrets, bearer/basic authorization values, URI credentials, and command-line user/password values—remain redacted, while durable raw tool I/O and context remain fully redacted.
- Every operator approval surface—CLI, Web, Mobile, Apple, Telegram, and Slack—renders the descriptor and context and submits the displayed digest as a review receipt. The CLI requires an explicit confirmation after rendering the exact operation and leaves a declined approval pending without execution. Single approvals reject missing, stale, or cross-operation receipts; approve-all requires the exact reviewed ID/digest set and refuses items added after review.
- Daemon-chat client approvals and the ACP bridge now use the same credential-safe descriptor, including redacted conversation context and a displayed review digest. Allow responses must return that exact digest; missing, stale, or raw-input-drifted receipts fail closed while the request remains pending. ACP forwards the digest back to the daemon and independently scrubs embedded command credentials before display.
- Mobile approval rows are navigation-only for every risk level. Operators must open the detail screen, which renders the complete reviewed input, context, and digest, before an Approve control becomes available.
- The receipt is checked before execution preflight, and the execution lease independently binds the raw input, operator-safe context, approval snapshot, project/session scope, and MCP declaration. Descriptor drift fails closed without resolving the pending approval, and the legacy unbound queue `approve`/`approveAll` mutation APIs were removed.

## Verification

- Root TypeScript passed, and the combined approval queue, execution binding, workflow approval, project-scoping, Telegram, Slack, module-dependency, strict-type, and task-file suite passed 311 tests across 28 files.
- Web TypeScript and the rendered Sidebar approval test passed; the test asserts operation/context rendering and the exact displayed digest in the approval request body.
- Mobile TypeScript and the focused daemon-client/operator-navigation/reducer suites passed 196 tests.
- Repair attempt 5 passed root and Mobile TypeScript, all 213 approval/receipt tests across 53 root files, and the complete 439-test Mobile suite. Its focused UI regression proves the list cannot call approve or reject and only navigates to the complete review; its descriptor regression covers environment/API/access-key assignments, credential-file keys, curl user/password values, and Basic authorization payloads.
- Repair attempt 6 validates JSON-compatible tool input against the authoritative local or MCP declaration before permission hooks, scheduling, guardrails, client approval, durable queueing, or execution, then revalidates any permission-hook rewrite. The branded validated-input type removes the former runner casts and prevents the approval queue helper from accepting an unvalidated tool call. Its redaction regression preserves `python -u /srv/deploy.py` while still redacting curl `-u` passwords and embedded `client_secret`, `access_token`, and `secret_key` values.
- Repair attempt 6 passed root TypeScript and formatting; 1,421 core tool/loop and KOTA-hosted OpenAI, Gemini, and Vercel harness tests across 90 files; 241 approval/receipt tests across 46 files; and 11 strict-type, layout, module-dependency, and MCP-declaration tests across 5 files.
- `swift test` in `clients/apple` passed all 319 tests, including the approval model and displayed-digest request test.
- Post-check repair passed the complete local root suite with 12,236 tests across 1,134 files. The registry-dependent pnpm supply-chain policy test was the sole exclusion after its signed-release lookup failed externally; its two static policy checks passed separately. The exact staged source-size check is non-blocking with three advisory legacy monoliths, and task queue validation passed.
- Repair attempt 7 passed root TypeScript, queue validation, the 147-test tool-runner/daemon/Slack regression suite, and the strict-types policy without expanding its baseline. The complete local code suite passed 12,243 tests with 16 skipped across 1,154 files; only the pnpm supply-chain integration file was excluded after its signed-release registry lookup failed externally. The exact staged autonomy-decision check passed, source-size remained advisory-only for three pre-existing monoliths, and `git diff --cached --check` passed.
- Repair attempt 8 passed root TypeScript and the 12 focused single/bulk approval CLI regressions. The rendered transcript proves the descriptor and digest appear before the explicit confirmation, and the decline regression proves a negative answer does not call the approval API or tool and leaves the queue item pending. Commands: `node_modules/.bin/tsc --noEmit` and `NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run src/modules/approval-queue/cli.test.ts src/modules/approval-queue/cli-bulk.test.ts --configLoader runner`.
- Repair attempt 9 redacts arbitrary authorization schemes such as GitHub's `Authorization: token …` form without dropping the surrounding quote or exposing the credential. Workflow-step approvals retain exact review-receipt and execution-lease binding but now resolve as control-flow gates instead of dispatching their pseudo-tool labels; focused single, bulk, workflow-resume, CLI, and secret-overlay regressions prove only actual tool-call approvals execute.
- Repair attempt 11 reduced the refactored approval queue below the 300-line source guideline, clearing the severe four-file batch while leaving only three advisory pre-existing monoliths. Root TypeScript, 39 focused approval/descriptor/source-size tests, the exact staged source-size check, and `git diff --cached --check` passed.
- Repair attempt 12 preserves own `__proto__` JSON properties in review descriptors and binds daemon-chat/ACP allow decisions to the exact safe descriptor. Root TypeScript passed; 107 descriptor, daemon-chat, daemon integration, and ACP tests passed; the strict-types, core-boundary, module-dependency, root-layout, queue, and exact staged-diff checks passed. Source size remains advisory-only for the same three pre-existing monoliths.
- Repair attempt 13 redacts complete multi-part authorization values rather than only their first token. SigV4 `Credential`/`SignedHeaders`/`Signature` and Digest username/realm/nonce/URI/response parameters are now removed from both reviewed input and conversation context while surrounding commands and later context remain visible. Root TypeScript and 19 focused descriptor, execution-binding, route-receipt, and ACP tests passed.
- Repair attempt 14 makes argv projection pair-aware: values following credential flags such as `--password` and `--authorization` are redacted even when the flag and value are separate array elements, while ordinary targets and arguments remain visible. Local TypeScript passed, as did 20 focused descriptor, execution-binding, route-receipt, race, and ACP tests across 5 files. The guarded `pnpm typecheck` launcher could not verify its signed release because the registry was unreachable, so validation used the already-installed local binaries without bypassing the supply-chain policy.
- Repair attempt 15 redacts credential values in two-element key/value arrays such as header tuples while preserving ordinary pairs. Local TypeScript, focused formatting, queue validation, diff checks, and 29 descriptor, execution-binding, route-receipt, race, ACP, strict-type, task-file, and core-boundary tests across 8 files passed.
- Repair attempt 16 split the approval review descriptor regression at a cohesive prototype-sensitive boundary, leaving both test files below the 300-line guideline. Focused formatting and all 11 descriptor tests passed, and the exact isolated staged source-size gate returned advisory-only warnings for the same three pre-existing monoliths.
- Post-check repair attempt 3 replaced real two-second approval-step polling waits with deterministic fake-time advancement, reducing that 13-test file from about 12.6 seconds to 0.62 seconds without changing runtime behavior. It also restored the Web workflow client's existing plural `abortWorkflows` facade after the staged API split dropped it. Root and Web TypeScript, queue validation, focused formatting, diff hygiene, 48 focused approval/receipt tests, the rendered Web/Mobile approval tests, three Apple approval tests, and the two static pnpm policy assertions passed. The complete local code suite passed 12,257 tests across 1,154 files in 281.46 seconds with only the registry-dependent pnpm policy file excluded; the exact `pnpm test` launcher failed closed before starting tests because the sandbox could not reach the signed-release registry.
- Post-check repair attempt 7 removed the redundant nested `pnpm` process from the supply-chain policy integration test. The test now verifies the committed workspace safeguards directly, while the outer `pnpm test` launcher remains the fail-closed signed-release gate. The complete local suite passed 12,260 tests across 1,155 files with 16 skips in 191.78 seconds, safely below the repair check's 300-second limit. The exact outer launcher still failed closed before Vitest after 70.38 seconds because the signed-release registry was unreachable; no package-manager verification was bypassed.
- Post-check repair attempt 9 closes the remaining separately-tokenized short-flag credential leak: structured curl argv now redacts `-u` and `-U` user/password values, including attached forms, while command-aware handling preserves unrelated short flags such as Python's `-u`. Root TypeScript, queue validation, isolated staged-diff hygiene, and 25 descriptor, execution-binding, receipt-race, ACP permission, and strict-type tests across 8 files passed. The sandbox's read-only host index required the documented workspace-local index/object-store replay to validate the exact worktree, and the workflow host must replay `git add -A` before commit.
- Post-check repair attempt 11 replaces the short approval id in Telegram callback data with a 43-character encoding of the full 256-bit review digest, binds each callback to the delivered chat/message identity, and retains the approval id plus original digest in that message-bound record. Reused short ids can no longer overwrite an older message's receipt: stale buttons submit the older digest and fail closed against the current execution snapshot. Root TypeScript, focused formatting, queue validation, and the complete 221-test Telegram module suite across 25 files passed. The sandbox's read-only host index required the documented workspace-local index/object-store replay to validate the exact worktree; the workflow host must replay `git add -A` before commit.
- Post-check repair attempt 13 closes the final two critic findings. Natural-language credential projection now redacts complete unquoted multi-word values such as `the passphrase is correct horse battery staple` while preserving later context at explicit clause boundaries. The Web approval client binds list, approve, reject, approve-all, and reject-all requests to the selected project through the shared scoped-URL helper. Root and Web TypeScript, focused formatting, queue validation, 18 focused root tests, and the complete 188-test Web suite passed.
- Post-check repair attempt 14 binds every client-approved dispatch to a canonical snapshot of the reviewed tool name and validated input. Middleware attempts execute from an isolated snapshot, and input-changing retries now fail closed before local or MCP execution until the changed operation receives fresh approval. Local TypeScript, focused formatting, 50 approval/runner/daemon-chat/ACP tests across 8 files, 5 strict-type/core-boundary/layout tests across 3 files, Web TypeScript, and 8 focused Web tests passed. Splitting two oversized Web test surfaces returned the exact staged source-size gate to the same three legacy advisory files. Queue validation and staged-diff hygiene passed. The sandbox's read-only host index required the documented workspace-local index/object-store replay; the workflow host must replay `git add -A` before commit.
- Post-check repair attempt 16 closes the remaining descriptor-redaction gaps. Executable-aware projection now masks `sshpass -p`, attached MySQL/MariaDB `-pPASSWORD`, Mongo password flags, and Redis/Valkey authentication flags in both shell text and structured argv without hiding later commands or non-credential flags such as MySQL `-P`. Authorization redaction preserves the operation after comma and sentence boundaries while still consuming complete SigV4/Digest parameter lists. Local TypeScript, focused formatting, 48 descriptor/queue/receipt-binding/ACP tests across 10 files, 10 strict-type/core-boundary/layout/task tests across 4 files, queue validation, and worktree diff hygiene passed. The exact staged source-size gate remained advisory-only for the same three legacy files. The host worktree index is read-only, so exact commit-set validation used the prescribed workspace-local index/object-store and the workflow host must replay `git add -A`.
- Post-check repair attempt 18 recognizes conventional process descriptors using `executable`/`program` with `args`/`argv` (plus the corresponding common aliases), so executable-specific credential flags cannot bypass the safe projection. Natural-language credential and authorization clauses now stop at an unpunctuated `then`, preserving later destructive operations and paths for operator review. Local TypeScript, focused formatting, 31 descriptor/lease/receipt/ACP tests across 8 files, 10 strict-type/core-boundary/layout/task tests across 4 files, queue validation, and staged-diff hygiene passed. The exact staged source-size gate remains advisory-only for the same three legacy files. The host worktree index is read-only, so exact commit-set validation used the prescribed workspace-local index/object-store and the workflow host must replay `git add -A`.
- Post-check repair attempt 20 makes sensitive `name`/`key` records fail closed across every sibling payload shape, including list and default-value containers, while preserving the credential discriminator and unrelated reviewed operation fields. Natural-language credential clauses now preserve destructive operations introduced by an ordinary `and`, while unquoted passphrases containing non-operation conjunctions remain fully redacted. Local TypeScript, focused formatting, 32 descriptor/lease/receipt/ACP tests across 8 files, 10 strict-type/core-boundary/layout/task tests across 4 files, the local queue validator, and staged-diff hygiene passed. The severe source-size gate remains advisory-only for the same three legacy files. The outer `pnpm validate-tasks` launcher failed closed because its signed-release registry lookup was unreachable; the already-installed local validator passed without bypassing package-manager policy. The host index became read-only during final staging, so exact commit-set validation used the prescribed workspace-local index/object store and the workflow host must replay `git add -A`.
- Post-check repair attempt 21 redacts conventional `PGPASSWORD` and `MYSQL_PWD` credentials in structured environments and command text, recognizes `cmd` as an executable alias for command-aware argv redaction, and preserves authorization/token destinations such as URLs and endpoints for operator review. Local TypeScript, focused formatting, 36 descriptor/lease/receipt/ACP tests across 9 files, 10 strict-type/core-boundary/layout/task tests across 4 files, the local queue validator, exact staged-diff hygiene, and commit-stageability passed. Extracting sensitive-key classification returned the source-size gate to advisory-only warnings for the same three legacy files.
- Post-check repair attempt 23 staged the extracted sensitive-key classifier that the prior repair left untracked. Local TypeScript, focused formatting, the 36-test descriptor/lease/receipt/ACP set, queue validation, and strict-type/core-boundary/layout/task invariants passed. The complete direct suite passed 1,159 files and 12,278 tests with 16 skips in 191.68 seconds, below the 300-second repair limit. The exact pnpm launcher still failed closed while verifying the pinned package-manager signature because the registry is unreachable; the installed local toolchain found no TypeScript or test failure.
- Post-check repair attempt 25 closes the three remaining critic findings. Redis and Valkey `--pass` values are redacted in shell text and structured argv. Sensitive `name`/`key` records still fail closed for arbitrary payload siblings while preserving explicit operation, action, path, and target metadata. The local approval namespace now performs the same preflight, execution-lease validation, scoped dispatch, and redacted execution projection as the daemon route, so Slack and Telegram callbacks created before daemon control publication execute the reviewed tool against the later-registered daemon runtime. Both channels distinguish successful execution from approved-but-failed execution. Local TypeScript and focused formatting passed, as did 181 approval, descriptor, channel, strict-type, core-boundary, layout, and task tests across 45 files; the complete Slack and Telegram module suite passed another 329 tests across 42 files. The host-owned worktree index rejected `git add -A`; the prescribed workspace-local index/object-store replay staged the complete worktree and passed `git diff --cached --check`, so the workflow host must replay `git add -A` into the real index before commit.
- Operator transcript: `.kota/runs/2026-07-29T15-20-51-974Z-builder-mqlo2r/evidence/artifacts/transcript.txt`.
