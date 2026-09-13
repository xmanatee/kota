---
status: done
---
# Security review: The request analyzer treats a string prefix as filesystem containment and follows symlinks with statSync. Crafted prompt paths can therefore disclose outside-scope file existence, type, and approximate size through automatically loaded model context. Synthetic probes confirmed both a similarly prefixed sibling and an in-scope symlink escape. This finding concerns metadata disclosure, not file-content access.

security family: 75353263f04e8de692b784b24df7b1118a4d2cbdf91f9c38a075b00c5840c7d3


## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/core/loop/request-analyzer.ts
claim:

> The request analyzer treats a string prefix as filesystem containment and follows symlinks with statSync. Crafted prompt paths can therefore disclose outside-scope file existence, type, and approximate size through automatically loaded model context. Synthetic probes confirmed both a similarly prefixed sibling and an in-scope symlink escape. This finding concerns metadata disclosure, not file-content access.

## Desired Outcome

> Perform metadata lookup through a filesystem boundary that enforces component-aware scope containment and safely handles symlinks before exposing stat results. Apply the effective session read restrictions. One owning lookup boundary should reject both similarly prefixed sibling directories and links escaping the scope.

> Reject outside-scope metadata probes while retaining authorized in-scope hints. Cover sibling-prefix and symlink escapes at the lookup boundary. The run artifact request-analyzer-boundary-probe.json records both synthetic cases returning a two-kilobyte outside file's metadata.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-12T22-02-48-322Z-security-review-ijuovl.

Confirmed by security-review workflow runs:

- 2026-09-12T22-02-48-322Z-security-review-ijuovl

security evidence: 91b17ef52061b12115bb0bc8306874b559a6d4d22640188d37e8d7ddcefa037c
evidence identity: request-context-prefix-and-symlink-stat-escape-v1
production owner: src/core/loop/request-analyzer
violated invariant: scope-contained-context-metadata
Common repair:
> Perform metadata lookup through a filesystem boundary that enforces component-aware scope containment and safely handles symlinks before exposing stat results. Apply the effective session read restrictions. One owning lookup boundary should reject both similarly prefixed sibling directories and links escaping the scope.
Exploit preconditions:
> An attacker can submit a prompt to a hosted session whose process can stat files outside its scope. The prefix variant requires a known or guessed sibling directory whose absolute name begins with the scope path. The symlink variant additionally requires an existing or attacker-placeable link inside the scope targeting an outside directory. No file-reading tool invocation is required.
finding id: request-context-outside-scope-metadata-disclosure
candidate id: external-fetch:src/core/loop/request-analyzer.ts:68
verdict: confirmed
rationale:

> resolveExistingPaths uses startsWith(cwd) and follows symlinks through statSync. runSend invokes this lookup before tool execution and appends its results to model context without applying session read restrictions. Independent synthetic probes through analyzeRequest and formatContextHint disclosed outside-scope file metadata through both a similarly prefixed sibling and an in-scope symlink. Exploitation requires prompt submission and host stat access; the symlink variant additionally requires an available escaping link. The demonstrated impact is metadata disclosure, not file-content access. Both variants violate the same containment invariant and require one authorized filesystem lookup boundary covering path components and symlinks. No matching predecessor evidence was found.

Evidence:

Evidence 1:



path: src/core/loop/request-analyzer.ts

line: 92

excerpt:



> const resolved = isAbsolute(p) ? p : resolve(cwd, p);
>     // Security: reject paths outside the working directory
>     if (!resolved.startsWith(cwd)) continue;
>     try {
>       const stat = statSync(resolved);

Evidence 2:



path: src/core/loop/request-analyzer.ts

line: 99

excerpt:



> results.push({
>           path: p,
>           type: "file",
>           sizeKB,
>           estimatedLines: Math.max(1, Math.round(stat.size / 45)),
>         });

Evidence 3:



path: src/core/loop/loop-send.ts

line: 60

excerpt:



> const analysis = analyzeRequest(
>       prompt,
>       state.scopeRoot,
>       state.moduleLoader.getProviderRegistry(),
>     );

Evidence 4:



path: src/core/loop/loop-send.ts

line: 67

excerpt:



> if (analysis) augmentedPrompt += formatContextHint(analysis);


## Resolution and verification

The request-analyzer lookup now checks lexical path components and the shared
canonical containment boundary before returning metadata. It inspects the
canonical target with lstat instead of following the submitted symlink alias.
Both the similarly prefixed sibling and the escaping link are omitted, while
ordinary scoped files, directories and internal symlinks retain their hints.
The same lookup excludes protected scope paths and requires the current session's
file-read guardrail policy to allow automatic reads; deny, confirm and queue
produce no metadata hints. runSend supplies the current session policy on every
request.

Verification: pnpm check:fast completed typechecking, lint, task validation,
generated client binding checks and admission of 90 bundled modules. Focused
request-analyzer, AgentSession, MCP send and protected-path suites passed. These
exercise both reported escapes through analyzeRequest/formatContextHint, positive
in-scope metadata, protected aliases, read-policy denial, and policy refresh at
the model-input boundary. The combined five-suite run reported 58 passing tests
and three failures in unchanged path-containment tests, all EPERM during fixture
cleanup under .kota/test-tmp after their assertions. The analyzer's isolated
temporary-tree regressions passed without that restriction. Full pnpm check,
live model evaluation and deployment observation were not run.

Run evidence: boundary-tests.log and check-fast.log in the builder run directory.
Original finding, exploit preconditions and evidence above remain preserved.
