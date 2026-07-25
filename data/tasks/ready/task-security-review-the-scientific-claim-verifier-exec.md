---
id: task-security-review-the-scientific-claim-verifier-exec
title: Security review: The scientific-claim verifier executes agent-produced JavaScript without a network isolation boundary. On supported Node 22 runtimes, --permission does not restrict network APIs, allowing a malicious or prompt-injected analyzer to access loopback services, cloud metadata, or exfiltrate verifier-only data. Container isolation selected for workflow execution does not contain this post-run predicate.
status: ready
priority: p1
area: security
task_class: Safety
summary: The scientific-claim verifier executes agent-produced JavaScript without a network isolation boundary. On supported Node 22 runtimes, --permission does not restrict network APIs, allowing a malicious or prompt-injected analyzer to access loopback services, cloud metadata, or exfiltrate verifier-only data. Container isolation selected for workflow execution does not contain this post-run predicate.
created_at: 2026-07-25T13:40:27.052Z
updated_at: 2026-07-25T13:40:27.052Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/scientific-claim-predicate.ts
claim:

> The scientific-claim verifier executes agent-produced JavaScript without a network isolation boundary. On supported Node 22 runtimes, --permission does not restrict network APIs, allowing a malicious or prompt-injected analyzer to access loopback services, cloud metadata, or exfiltrate verifier-only data. Container isolation selected for workflow execution does not contain this post-run predicate.

## Desired Outcome

> Run candidate analyzers inside a fail-closed OS or container sandbox with networking disabled, including post-run predicate execution. Alternatively require a Node version whose permission model denies network access and verify that capability before execution. Add a regression with a loopback listener proving the analyzer cannot connect or send verifier data.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T12-37-16-948Z-security-review-qo295e.

finding id: security-review-scientific-claim-network-egress
candidate id: auth-approval-boundary:src/modules/eval-harness/scientific-claim-predicate.ts:26
verdict: confirmed
rationale:

> The predicate copies agent-produced analyzer code and verifier-only CSV data into a temporary directory, grants the analyzer read access to that CSV, and executes it with Node's --permission flag. On the repository's Node 22.19 runtime, the permission model exposes no network permission scope and permits DNS operations; a TCP attempt reaches the OS sandbox instead of producing Node's ERR_ACCESS_DENIED. The runner evaluates predicates in the host process after the configured workflow executor returns, so an offline container used for workflow execution does not contain this analyzer subprocess. Without a separate host or container network boundary, the analyzer can attempt loopback, metadata-service, or external egress with verifier data.

Evidence:

Evidence 1:



path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 76

excerpt:



> The analyzer submitted in the fixture working directory is read as executable candidate content.

Evidence 2:



path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 109

excerpt:



> A verifier-only CSV is materialized and supplied to the candidate analyzer.

Evidence 3:



path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 137

excerpt:



> spawnSync(process.execPath, ["--permission", fs-read grants, fs-write grant, ANALYZER_PATH, ...]) provides filesystem restrictions but no independent network sandbox.

Evidence 4:



path: src/modules/eval-harness/runner-single-fixture.ts

line: 185

excerpt:



> evaluatePredicates runs after the configured workflow executor returns, in the eval-harness parent process.

Evidence 5:



path: src/modules/eval-harness/scientific-claim-reproduction-fixture.test.ts

line: 268

excerpt:



> The isolation regression covers host filesystem denial only; it does not verify denial of network connections.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
